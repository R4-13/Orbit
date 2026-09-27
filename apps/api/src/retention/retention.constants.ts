/**
 * Guardrails for tenant-configurable retention windows (Unified Evolution
 * Concept, Retention-Grundlage). A tenant may shorten how long AgentRun /
 * ToolInvocation history is kept, but never below MIN_RETENTION_DAYS —
 * this operational history is also the audit trail an approver or support
 * engineer would need to investigate an incident from the past few weeks,
 * so a same-day or same-week retention window is not offered even to a
 * tenant admin. MAX_RETENTION_DAYS is a sanity ceiling (~10 years) against
 * fat-fingered input; there is no upper bound in the business requirements.
 */
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;
