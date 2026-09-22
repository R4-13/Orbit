import type { BadgeTone } from '@orbit/ui';

/**
 * Maps backend status enums to business-friendly German labels + a Badge
 * tone — the UI never shows raw enum values like "PENDING_APPROVAL" to
 * end users (§57: kaufmännische Sachbearbeiter, kein Entwicklerjargon).
 */
const STATUS_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  // Invoice
  RECEIVED: { label: 'Eingegangen', tone: 'neutral' },
  EXTRACTED: { label: 'Ausgelesen', tone: 'info' },
  DUPLICATE_SUSPECTED: { label: 'Mögliche Dublette', tone: 'warning' },
  BANK_CHANGE_SUSPECTED: { label: 'Bankverbindung geändert', tone: 'danger' },
  PENDING_APPROVAL: { label: 'Freigabe erforderlich', tone: 'warning' },
  APPROVED: { label: 'Freigegeben', tone: 'success' },
  REJECTED: { label: 'Abgelehnt', tone: 'danger' },
  TRANSFERRED: { label: 'Übertragen', tone: 'success' },
  TRANSFER_FAILED: { label: 'Übertragung fehlgeschlagen', tone: 'danger' },
  // Supplier
  ACTIVE: { label: 'Aktiv', tone: 'success' },
  BLOCKED: { label: 'Gesperrt', tone: 'danger' },
  // Task
  OPEN: { label: 'Offen', tone: 'neutral' },
  DONE: { label: 'Erledigt', tone: 'success' },
  CANCELLED: { label: 'Storniert', tone: 'neutral' },
  // Lead
  NEW: { label: 'Neu', tone: 'info' },
  QUALIFIED: { label: 'Qualifiziert', tone: 'success' },
  DISQUALIFIED: { label: 'Disqualifiziert', tone: 'neutral' },
  CONVERTED: { label: 'Konvertiert', tone: 'success' },
  // Approval
  PENDING: { label: 'Ausstehend', tone: 'warning' },
  // Case (OPEN/DONE/CANCELLED shared with Task above)
  IN_PROGRESS: { label: 'In Bearbeitung', tone: 'info' },
  WAITING_APPROVAL: { label: 'Wartet auf Freigabe', tone: 'warning' },
  // Opportunity (NEW shared with Lead above)
  QUALIFICATION: { label: 'Qualifizierung', tone: 'info' },
  PROPOSAL: { label: 'Angebot', tone: 'info' },
  WON: { label: 'Gewonnen', tone: 'success' },
  LOST: { label: 'Verloren', tone: 'danger' },
  // AgentRun
  RUNNING: { label: 'Läuft', tone: 'info' },
  COMPLETED: { label: 'Abgeschlossen', tone: 'success' },
  FAILED: { label: 'Fehlgeschlagen', tone: 'danger' },
  // Meeting (CONFIRMED shares APPROVED's meaning but not its string)
  PROPOSED: { label: 'Vorgeschlagen', tone: 'info' },
  CONFIRMED: { label: 'Bestätigt', tone: 'success' },
};

/** German labels for CaseType — kept separate since it's not a "status". */
const CASE_TYPE_LABELS: Record<string, string> = {
  FINANCE: 'Finance',
  SALES: 'Sales',
};

export function caseTypeLabel(type: string): string {
  return CASE_TYPE_LABELS[type] ?? type;
}

export function statusLabel(status: string): { label: string; tone: BadgeTone } {
  return STATUS_LABELS[status] ?? { label: status, tone: 'neutral' };
}
