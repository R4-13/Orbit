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
}
