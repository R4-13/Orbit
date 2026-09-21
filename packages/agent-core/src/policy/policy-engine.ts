import type { PolicyMode } from '@orbit/shared';

/**
 * What AgentRuntime does with a tool call after this decision:
 * - ALLOW: execute the tool immediately.
 * - SUGGEST_ONLY: never execute; the caller surfaces the proposed action
 *   to a human as a suggestion (no Approval record — nothing is pending).
 * - REQUIRE_APPROVAL: never execute; the caller creates an Approval record
 *   and the action resumes only once a human decides it (Phase 7/8).
 * - DENY: never execute, full stop (POLICY_ACTIONS.PAYMENT_EXECUTE's
 *   default — see DEFAULT_POLICY_CONFIG, @orbit/shared/policy.ts).
 */
export type PolicyDecision = 'ALLOW' | 'SUGGEST_ONLY' | 'REQUIRE_APPROVAL' | 'DENY';

const MODE_TO_DECISION: Record<PolicyMode, PolicyDecision> = {
  DISABLED: 'DENY',
  SUGGEST_ONLY: 'SUGGEST_ONLY',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  AUTONOMOUS: 'ALLOW',
};

/**
 * Pure mapping from a tenant's configured PolicyMode (PolicyConfig.mode,
 * resolved by the caller from the DB — this package stays DB-agnostic,
 * same convention as @orbit/integration-core) to what AgentRuntime should
 * do with the tool call. Kept as its own named function, not inlined,
 * because it *is* the "Policy Engine" step in the architecture diagram
 * (PRODUCT_CONTEXT.md) — the one place this decision is made.
 */
export function decidePolicyAction(mode: PolicyMode): PolicyDecision {
  return MODE_TO_DECISION[mode];
}
