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
};

export function statusLabel(status: string): { label: string; tone: BadgeTone } {
  return STATUS_LABELS[status] ?? { label: status, tone: 'neutral' };
}
