import { Inject, Injectable } from '@nestjs/common';
import { AgentRuntime, type LLMProvider, type ToolRegistry } from '@orbit/agent-core';
import type { AgentType } from '@orbit/domain';
import { IntegrationUnavailableError, NotFoundError } from '@orbit/shared';
import { LLM_PROVIDER, TOOL_REGISTRY } from '../agent/agent.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedAgent {
  systemPrompt: string;
  baseType: AgentType;
  runtime: AgentRuntime;
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
 */
@Injectable()
export class AgentDefinitionResolverService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(TOOL_REGISTRY) private readonly toolRegistry: ToolRegistry,
    private readonly policy: PolicyEnforcementService,
  ) {}

  private buildRuntime(allowedTools: string[]): AgentRuntime {
    const scopedTools = this.toolRegistry.subset(allowedTools);
    return new AgentRuntime(this.llm, scopedTools, (action, context) => this.policy.resolveMode(context.tenantId, action));
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

    return { systemPrompt: definition.systemPrompt, baseType: definition.baseType, runtime: this.buildRuntime(definition.allowedTools) };
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

    return { systemPrompt: definition.systemPrompt, baseType: definition.baseType, runtime: this.buildRuntime(definition.allowedTools) };
  }
}
