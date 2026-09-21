import type { z } from 'zod';
import type { PolicyActionKey } from '@orbit/shared';

export interface ToolExecutionContext {
  tenantId: string;
  agentRunId: string;
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
