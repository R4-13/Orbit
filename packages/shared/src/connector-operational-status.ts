/**
 * docs/CHANNEL_EVENT_RUNTIME_PLAN.md §8 ("Betriebsstatus-Stufen"): a
 * successful OAuth connect alone must never be presented as a working
 * automatic intake channel. Five levels, each strictly building on real
 * evidence from the next pipeline stage — not on configuration intent.
 */
export const CONNECTOR_OPERATIONAL_STATUS_LEVELS = [
  'AUTHENTICATION_CONNECTED',
  'INPUT_TRIGGER_ACTIVE',
  'INTAKE_PIPELINE_ACTIVE',
  'DOMAIN_WORKFLOW_ACTIVE',
  'LIVE_END_TO_END_TESTED',
] as const;

export type ConnectorOperationalStatus = (typeof CONNECTOR_OPERATIONAL_STATUS_LEVELS)[number];

export interface ConnectorOperationalStatusLevel {
  reached: boolean;
  /** ISO timestamp of the first time this level's evidence appeared, or `null` if never reached. */
  at: string | null;
}

/** Whether a component really talked to its external system or was simulated (Amendment 02 §19.1: three independent settings). */
export type ExecutionMode = 'LIVE' | 'SIMULATED';

export interface ExecutionComponentEvidence {
  mode: ExecutionMode;
  /** Provider/connector name as configured at the time, e.g. `gmail`, `mock-persistent`, `anthropic`. */
  provider: string;
}

/**
 * Amendment 02 §19.4 — what was real and what was simulated when a run
 * happened. Captured at processing time (not derived later from the current
 * environment), so a historic proof keeps the scope it actually had.
 */
export interface ExecutionEvidenceSnapshot {
  capturedAt: string;
  buildCommit: string | null;
  channel: ExecutionComponentEvidence;
  ai: ExecutionComponentEvidence;
  crm: ExecutionComponentEvidence;
  ocr: ExecutionComponentEvidence;
}

const COMPONENT_LABELS: Array<[keyof Omit<ExecutionEvidenceSnapshot, 'capturedAt' | 'buildCommit'>, string]> = [
  ['channel', 'Eingang'],
  ['ai', 'KI'],
  ['crm', 'CRM'],
  ['ocr', 'OCR'],
];

/** e.g. "Eingang live; KI simuliert; CRM simuliert; OCR simuliert" — mixed execution is always stated precisely. */
export function describeExecutionModes(snapshot: ExecutionEvidenceSnapshot): string {
  return COMPONENT_LABELS.map(([key, label]) => `${label} ${snapshot[key].mode === 'LIVE' ? 'live' : 'simuliert'}`).join('; ');
}

/** A concrete run that satisfies every criterion for "business process successfully tested" — see ConnectorStatusService. */
export interface ConnectorVerifiedRun {
  intakeEventId: string;
  workflowRunId: string;
  workflowKey: string | null;
  completedAt: string;
  /** Snapshot taken when the run was processed; `null` for runs that predate evidence capture ("Nicht erfasst"). */
  execution: ExecutionEvidenceSnapshot | null;
  executionSummary: string;
}

/** Current operating state, kept apart from the historical proof (Amendment 02 §19.4). */
export interface ConnectorCurrentHealth {
  connectionStatus: string;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  syncStatus: string | null;
  syncLastErrorCode: string | null;
  /** The newest real run for this connection ended in a failure state (and is therefore not hidden by an older success). */
  latestRunFailed: boolean;
}

export interface ConnectorOperationalStatusResult {
  connectorType: string;
  /**
   * The highest level for which an unbroken chain of evidence exists,
   * starting from `AUTHENTICATION_CONNECTED` — or `null` if the connector
   * was never even authenticated. Deliberately the longest *reached
   * prefix*, not just "the highest individually-true level", so a gap
   * (e.g. real intake events without a successful scheduler poll ever
   * recorded) can never be presented as more advanced than it is.
   */
  highestLevelReached: ConnectorOperationalStatus | null;
  /** `Integration.status === 'CONNECTED'` right now — independent of `highestLevelReached`, which reflects historical evidence and does not regress when a token later expires or is disconnected. */
  currentlyConnected: boolean;
  levels: Record<ConnectorOperationalStatus, ConnectorOperationalStatusLevel>;
  /** Set only when `LIVE_END_TO_END_TESTED` is reached: the concrete run that proves it, with its execution modes. */
  verifiedRun: ConnectorVerifiedRun | null;
  health: ConnectorCurrentHealth | null;
}
