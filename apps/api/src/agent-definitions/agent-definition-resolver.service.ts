import { Inject, Injectable } from '@nestjs/common';
import { AgentRuntime, buildLayeredSystemPrompt, type ToolRegistry } from '@orbit/agent-core';
import type { AgentType } from '@orbit/domain';
import { IntegrationUnavailableError, NotFoundError } from '@orbit/shared';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedAgent {
  systemPrompt: string;
  baseType: AgentType;
  runtime: AgentRuntime;
}

export interface AgentCandidate {
  systemPrompt: string;
  allowedTools: string[];
  baseType: AgentType;
}

/**
 * The runtime counterpart to AgentDefinitionsService (admin CRUD): looks
 * up an AgentDefinition by its stable `key` and builds a *scoped*
 * AgentRuntime for it — docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1's
 * "additive, ToolRegistry.subset() is the only new primitive"
 * extension point.
 *
 * Deliberately builds a fresh `AgentRuntime` per call instead of reusing
 * the app-wide AGENT_RUNTIME singleton (agent.module.ts) — that instance
 * is permanently bound to the *full* tool registry at construction time
 * (AgentRuntime's constructor takes ToolRegistry once, `runTurn()` never
 * takes one per call), so per-agent scoping has no other extension point
 * without changing AgentRuntime itself. Constructing one is cheap (three
 * references, no I/O) — see packages/agent-core/src/runtime/agent-runtime.ts.
 *
 * Since Phase 4 (LLM Provider Platform), the LLMProvider itself is also
 * resolved per tenant here (AiProviderResolverService: a tenant's BYOK
 * connection if one is CONNECTED, otherwise the platform-managed default)
 * instead of the single, process-wide LLM_PROVIDER token — this is the
 * one choke point every production/test-run/evaluation path already goes
 * through, so no caller needs to know which provider a given tenant uses.
 */
@Injectable()
export class AgentDefinitionResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProviders: AiProviderResolverService,
    @Inject(TOOL_REGISTRY) private readonly toolRegistry: ToolRegistry,
    private readonly policy: PolicyEnforcementService,
  ) {}

  private async buildRuntime(tenantId: string, allowedTools: string[]): Promise<AgentRuntime> {
    const scopedTools = this.toolRegistry.subset(allowedTools);
    const llm = await this.aiProviders.resolveForTenant(tenantId);
    return new AgentRuntime(llm, scopedTools, (action, context) => this.policy.resolveMode(context.tenantId, action));
  }

  /**
   * Used by production entry points (IntakeService, WorkflowRunnerService)
   * — only an ACTIVE definition is a valid target. Not a NotFoundError: an
   * inactive/missing AgentDefinition for a built-in flow means the
   * tenant's configuration is in a state the live pipeline genuinely
   * cannot run in — same "environment isn't ready" category as a missing
   * provider credential, not a client mistake.
   */
  async resolve(tenantId: string, key: string): Promise<ResolvedAgent> {
    const definition = await this.prisma
      .forTenantId(tenantId)
      .agentDefinition.findUnique({ where: { tenantId_key: { tenantId, key } } });

    if (!definition || definition.status !== 'ACTIVE') {
      throw new IntegrationUnavailableError(
        `No ACTIVE AgentDefinition "${key}" configured for this tenant — see /admin/agents.`,
        { key },
      );
    }

    return {
      systemPrompt: buildLayeredSystemPrompt(definition.systemPrompt),
      baseType: definition.baseType,
      runtime: await this.buildRuntime(tenantId, definition.allowedTools),
    };
  }

  /**
   * Used only by Agent Studio's test-run (docs/AGENT_STUDIO_CONCEPT.md
   * Abschnitt 2) — a DRAFT agent must be runnable *before* it's activated,
   * that's the whole point of testing it first. DISABLED is still
   * rejected (a deliberately turned-off agent shouldn't be testable
   * around that decision). This IS a client mistake (an unknown/disabled
   * key was requested), so NotFoundError (404) is correct here, unlike
   * `resolve()`.
   */
  async resolveForTestRun(tenantId: string, key: string): Promise<ResolvedAgent> {
    const definition = await this.prisma
      .forTenantId(tenantId)
      .agentDefinition.findUnique({ where: { tenantId_key: { tenantId, key } } });

    if (!definition || definition.status === 'DISABLED') {
      throw new NotFoundError('No testable agent definition found for this key.', { key });
    }

    return {
      systemPrompt: buildLayeredSystemPrompt(definition.systemPrompt),
      baseType: definition.baseType,
      runtime: await this.buildRuntime(tenantId, definition.allowedTools),
    };
  }

  /**
   * Builds a runtime directly from an in-memory candidate prompt/tools —
   * no AgentDefinition DB lookup, no status gate (the provider connection
   * lookup inside buildRuntime() is a separate, unrelated read). Used by
   * AgentEvaluationService to test a *pending* edit (the prompt/tools
   * about to be saved by AgentDefinitionsService.update()) before it's
   * ever persisted, so a critical evaluation failure can block the save
   * outright instead of requiring a save-then-rollback (see §17 of the
   * concept doc: "Critical evaluations should run before publishing a new
   * agent version").
   */
  async resolveCandidate(tenantId: string, candidate: AgentCandidate): Promise<ResolvedAgent> {
    return {
      systemPrompt: buildLayeredSystemPrompt(candidate.systemPrompt),
      baseType: candidate.baseType,
      runtime: await this.buildRuntime(tenantId, candidate.allowedTools),
    };
  }
}
