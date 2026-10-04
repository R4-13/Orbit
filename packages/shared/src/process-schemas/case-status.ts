/**
 * Amendment 02 §12.1 — one central status vocabulary and ONE mapping table
 * between the fine-grained orchestration state and the pre-existing simple
 * `CaseStatus` the rest of the app already uses. The frontend never invents
 * its own status machine (§12.1: "Keine unabhängigen Frontend-Statusautomaten").
 */
export const CASE_ORCHESTRATION_STATUSES = [
  'RECEIVED',
  'READY',
  'IN_PROGRESS',
  'WAITING_FOR_INFORMATION',
  'WAITING_FOR_APPROVAL',
  'WAITING_FOR_EXTERNAL_SYSTEM',
  'PAUSED',
  'MANUAL_REVIEW',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
] as const;
export type CaseOrchestrationStatusValue = (typeof CASE_ORCHESTRATION_STATUSES)[number];

export type SimpleCaseStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_APPROVAL' | 'DONE' | 'CANCELLED';

/**
 * A failed or paused case stays "open" in the simple view: it still needs a
 * human or a retry, so it must never look finished (`DONE`) or withdrawn.
 */
export const CASE_STATUS_MAPPING: Record<CaseOrchestrationStatusValue, SimpleCaseStatus> = {
  RECEIVED: 'OPEN',
  READY: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_FOR_INFORMATION: 'IN_PROGRESS',
  WAITING_FOR_APPROVAL: 'WAITING_APPROVAL',
  WAITING_FOR_EXTERNAL_SYSTEM: 'IN_PROGRESS',
  PAUSED: 'IN_PROGRESS',
  MANUAL_REVIEW: 'IN_PROGRESS',
  COMPLETED: 'DONE',
  REJECTED: 'CANCELLED',
  CANCELLED: 'CANCELLED',
  FAILED: 'IN_PROGRESS',
};

export function caseStatusFor(status: CaseOrchestrationStatusValue): SimpleCaseStatus {
  return CASE_STATUS_MAPPING[status];
}

/**
 * The reverse direction, for a PERSON setting the simple status by hand (PATCH /cases/:id/status). It is a human
 * decision, not a verified process completion: a manual DONE closes with the outcome code `MANUALLY_CLOSED`.
 */
export const ORCHESTRATION_STATUS_FOR_SIMPLE: Record<SimpleCaseStatus, CaseOrchestrationStatusValue> = {
  OPEN: 'RECEIVED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_APPROVAL: 'WAITING_FOR_APPROVAL',
  DONE: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

/** Statuses from which no further work happens on its own. */
export const TERMINAL_CASE_STATUSES: ReadonlySet<CaseOrchestrationStatusValue> = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);

/** Business-language labels (Amendment 02 §16.2: "Wartet auf Kundenantwort", "Freigabe erforderlich", …). */
export const CASE_ORCHESTRATION_LABELS: Record<CaseOrchestrationStatusValue, string> = {
  RECEIVED: 'Eingegangen',
  READY: 'Bereit zur Bearbeitung',
  IN_PROGRESS: 'In Bearbeitung',
  WAITING_FOR_INFORMATION: 'Wartet auf Kundenantwort',
  WAITING_FOR_APPROVAL: 'Freigabe erforderlich',
  WAITING_FOR_EXTERNAL_SYSTEM: 'Wartet auf externes System',
  PAUSED: 'Pausiert',
  MANUAL_REVIEW: 'Prüfung erforderlich',
  COMPLETED: 'Abgeschlossen',
  REJECTED: 'Abgelehnt',
  CANCELLED: 'Abgebrochen',
  FAILED: 'Fehlgeschlagen',
};

/** §7.2 fact statuses and the sources a fact can come from — shared so API, worker and UI use the same words. */
export const CASE_FACT_STATUSES = ['CANDIDATE', 'CONFIRMED', 'CONFLICTED', 'STALE', 'REJECTED'] as const;
export type CaseFactStatusValue = (typeof CASE_FACT_STATUSES)[number];
export const CASE_FACT_SOURCE_TYPES = ['EMAIL', 'ATTACHMENT', 'SYSTEM_OF_RECORD', 'CONFIGURATION', 'HUMAN'] as const;
export type CaseFactSourceTypeValue = (typeof CASE_FACT_SOURCE_TYPES)[number];
