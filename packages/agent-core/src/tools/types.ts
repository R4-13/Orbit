import type { z } from 'zod';
import type { PolicyActionKey } from '@orbit/shared';

export interface ToolExecutionContext {
  tenantId: string;
  agentRunId: string;
  /**
   * The human user this run is acting on behalf of, if any — e.g. a user
   * manually re-triggered a run. Absent for genuinely autonomous runs
   * (an inbound email arriving with no human in the loop yet), which is
   * the normal case; tool implementations should attribute their audit
   * events to `actorType: 'AGENT'` when this is undefined rather than
   * inventing a user.
   */
  actorUserId?: string;
}

/**
 * A capability an agent can invoke. `policyAction` ties every tool to
 * exactly one Policy Engine action key (POLICY_ACTIONS, @orbit/shared) —
 * this is what AgentRuntime checks before ever calling `execute`, per the
 * architecture principle "Agent -> Tool Registry -> Policy Engine ->
 * Authorization Check -> Tool Gateway -> Connector" (PRODUCT_CONTEXT.md).
 */
// TInput/TOutput default to `any` (not `unknown`) so a concretely-typed
// ToolDefinition<X, Y> can be widened to the registry's internal
// ToolDefinition (bare, i.e. <any, any>) storage type — with `unknown`,
// `execute`'s parameter contravariance makes that assignment illegal.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  policyAction: PolicyActionKey;
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}
