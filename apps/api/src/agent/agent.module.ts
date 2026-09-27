import { Module } from '@nestjs/common';
import { AgentRuntime, AnthropicLLMProvider, MockLLMProvider, OpenAILLMProvider, ToolRegistry } from '@orbit/agent-core';
import type { LLMProvider } from '@orbit/agent-core';
import { IntegrationUnavailableError } from '@orbit/shared';
import type { OrbitEnv } from '@orbit/config';
import { CompaniesModule } from '../companies/companies.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ORBIT_ENV } from '../config/env.token';
import { InvoicesModule } from '../invoices/invoices.module';
import { LeadsModule } from '../leads/leads.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { TasksModule } from '../tasks/tasks.module';
import { AgentRunRecorderService } from './agent-run-recorder.service';
import { AgentRunsController } from './agent-runs.controller';
import { AGENT_RUNTIME, LLM_PROVIDER, TOOL_REGISTRY } from './agent.tokens';
import { CommunicationAgentTools } from './tools/communication.tools';
import { FinanceAgentTools } from './tools/finance.tools';
import { SalesAgentTools } from './tools/sales.tools';

/**
 * Wires the Agent Runtime (§12-17) into apps/api: an LLM_PROVIDER (mock
 * or Anthropic, same env-driven fail-fast pattern as ConnectorsModule —
 * see its own header comment) and a single, shared ToolRegistry
 * populated by every domain's tool group. One shared registry (not one
 * per agent persona) is a deliberate simplification: AgentRuntime always
 * hands the *whole* registry's tool definitions to the LLM in one
 * `complete()` call, so per-persona filtering would need its own
 * mechanism this MVP doesn't need yet — the Policy Engine already gates
 * every individual tool call regardless of which "persona" nominally
 * owns it. See docs/AGENT_ARCHITECTURE.md and docs/ASSUMPTIONS.md
 * Phase 18.
 */
@Module({
  imports: [
    ConnectorsModule,
    InvoicesModule,
    ContactsModule,
    CompaniesModule,
    LeadsModule,
    OpportunitiesModule,
    TasksModule,
    MeetingsModule,
  ],
  controllers: [AgentRunsController],
  providers: [
    FinanceAgentTools,
    SalesAgentTools,
    CommunicationAgentTools,
    AgentRunRecorderService,
    {
      provide: LLM_PROVIDER,
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => {
        if (env.LLM_PROVIDER === 'mock') {
          return new MockLLMProvider();
        }
        if (env.LLM_PROVIDER === 'anthropic') {
          if (!env.ANTHROPIC_API_KEY) {
            throw new IntegrationUnavailableError(
              'LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY — see docs/AGENT_ARCHITECTURE.md.',
            );
          }
          return new AnthropicLLMProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
        }
        if (env.LLM_PROVIDER === 'openai') {
          if (!env.OPENAI_API_KEY) {
            throw new IntegrationUnavailableError(
              'LLM_PROVIDER=openai requires OPENAI_API_KEY — see docs/AGENT_ARCHITECTURE.md.',
            );
          }
          return new OpenAILLMProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
        }
        throw new IntegrationUnavailableError(`LLMProvider "${env.LLM_PROVIDER}" is not implemented yet.`);
      },
    },
    {
      provide: TOOL_REGISTRY,
      inject: [FinanceAgentTools, SalesAgentTools, CommunicationAgentTools],
      useFactory: (finance: FinanceAgentTools, sales: SalesAgentTools, communication: CommunicationAgentTools) => {
        const registry = new ToolRegistry();
        communication.register(registry);
        finance.register(registry);
        sales.register(registry);
        return registry;
      },
    },
    {
      provide: AGENT_RUNTIME,
      inject: [LLM_PROVIDER, TOOL_REGISTRY, PolicyEnforcementService],
      useFactory: (llm: LLMProvider, tools: ToolRegistry, policy: PolicyEnforcementService) =>
        new AgentRuntime(llm, tools, (action, context) => policy.resolveMode(context.tenantId, action)),
    },
  ],
  exports: [LLM_PROVIDER, TOOL_REGISTRY, AGENT_RUNTIME, AgentRunRecorderService],
})
export class AgentModule {}
