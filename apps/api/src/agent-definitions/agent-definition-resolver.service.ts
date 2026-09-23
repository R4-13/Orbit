import { Inject, Injectable } from '@nestjs/common';
import { AgentRuntime, type LLMProvider, type ToolRegistry } from '@orbit/agent-core';
import { IntegrationUnavailableError } from '@orbit/shared';
import { LLM_PROVIDER, TOOL_REGISTRY } from '../agent/agent.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedAgent {
  systemPrompt: string;
  runtime: AgentRuntime;
}

/**
 * The runtime counterpart to AgentDefinitionsService (admin CRUD): looks
 * up an ACTIVE AgentDefinition by its stable `key` and builds a *scoped*
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

  async resolve(tenantId: string, key: string): Promise<ResolvedAgent> {
    const definition = await this.prisma
      .forTenantId(tenantId)
      .agentDefinition.findUnique({ where: { tenantId_key: { tenantId, key } } });

    if (!definition || definition.status !== 'ACTIVE') {
      // Not a NotFoundError: an inactive/missing AgentDefinition for a
      // built-in flow (communication-intake/finance-intake/sales-intake)
      // means the tenant's configuration is in a state the live intake
      // pipeline genuinely cannot run in — same "environment isn't ready"
      // category as a missing provider credential, not a client mistake.
      throw new IntegrationUnavailableError(
        `No ACTIVE AgentDefinition "${key}" configured for this tenant — see /admin/agents.`,
        { key },
      );
    }

    const scopedTools = this.toolRegistry.subset(definition.allowedTools);
    const runtime = new AgentRuntime(this.llm, scopedTools, (action, context) =>
      this.policy.resolveMode(context.tenantId, action),
    );

    return { systemPrompt: definition.systemPrompt, runtime };
  }
}
