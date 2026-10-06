import type { NodeState } from './graph';

/**
 * Diagnostic Projection (Amendment 02 v1.2 §35.3, Amendment 03 §17): technische Sicht auf einen Case für die Plattformdomäne. Metadaten, keine
 * Fachinhalte: keine Mailtexte, keine Entwurfs-/Angebotsinhalte, keine Roh-Payloads/-Outputs, keine Secrets, keine Chain-of-Thought.
 * Fehlermeldungen sind geschwärzt und gekürzt. Tiefere Payload-Einsicht ist ausschließlich über eine Support-Session möglich (Phase OPS-5).
 */
export interface OrchestrationDiagnosticProjection {
  caseId: string;
  tenantId: string;
  caseStatus: string;
  caseRevision: number;
  generatedAt: string;
  planRevisions: Array<{ planId: string; revision: number; status: string; source: string; blueprintKey?: string; blueprintVersion?: string; planHash: string; createdAt: string; activatedAt?: string }>;
  nodes: Array<{
    planRevision: number;
    nodeKey: string;
    type: string;
    state: NodeState | string;
    attempts: number;
    executionMode?: string;
    errorCode?: string;
    errorMessage?: string;
    agentRunId?: string;
    startedAt?: string;
    completedAt?: string;
    retryAt?: string;
  }>;
  actions: Array<{
    intentId: string;
    nodeKey: string;
    capabilityKey: string;
    purpose?: string;
    status: string;
    planRevision: number;
    payloadHash: string;
    idempotencyKey: string;
    errorCode?: string;
    receipts: Array<{ status: string; executionMode: string; providerRef?: string; at: string }>;
  }>;
  agentRuns: Array<{ id: string; agentType: string; status: string; startedAt: string; completedAt?: string; errorMessage?: string; toolInvocations: Array<{ toolName: string; status: string; policyAction?: string; policyMode?: string; at: string }> }>;
  correlations: Array<{ emailMessageId: string; status: string; rule: string; at: string }>;
  /** Provider-/Modelllauf-Metadaten werden mit der AI-Plattform (Phase OPS-2, `AIUsageRecord`) ergänzt. */
  providerRuns: Array<{ providerKey: string; modelProfile: string; modelId?: string; latencyMs?: number; usageUnits?: number; status: string }>;
}
