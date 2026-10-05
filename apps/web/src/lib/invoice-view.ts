import type { InvoiceStatus } from '@orbit/domain';

export type InvoiceFilter = 'TODO' | 'ALL' | 'APPROVAL' | 'TRANSFERRED' | 'EXCEPTIONS';

export const INVOICE_FILTER_LABELS: Record<InvoiceFilter, string> = {
  TODO: 'Zu bearbeiten',
  ALL: 'Alle Rechnungen',
  APPROVAL: 'Freigabe offen',
  TRANSFERRED: 'Übertragen',
  EXCEPTIONS: 'Ausnahmen',
};

/** Welche Rechnungen gehören zu welchem Filter? Eine zentrale Tabelle statt verteilter Statusvergleiche (UI v2 §12.1). */
const FILTER_STATUSES: Record<Exclude<InvoiceFilter, 'ALL'>, readonly InvoiceStatus[]> = {
  TODO: ['RECEIVED', 'EXTRACTED', 'PENDING_APPROVAL', 'APPROVED', 'DUPLICATE_SUSPECTED', 'BANK_CHANGE_SUSPECTED', 'TRANSFER_FAILED'],
  APPROVAL: ['PENDING_APPROVAL'],
  TRANSFERRED: ['TRANSFERRED'],
  EXCEPTIONS: ['DUPLICATE_SUSPECTED', 'BANK_CHANGE_SUSPECTED', 'TRANSFER_FAILED', 'REJECTED'],
};

export function matchesInvoiceFilter(status: InvoiceStatus, filter: InvoiceFilter): boolean {
  return filter === 'ALL' || FILTER_STATUSES[filter].includes(status);
}

/** Die nächste Handlung je Status in Klartext (Verb zuerst, UI v2 §3.2). */
export function invoiceNextAction(status: InvoiceStatus): string {
  switch (status) {
    case 'RECEIVED':
      return 'Wird ausgelesen';
    case 'EXTRACTED':
      return 'Angaben prüfen';
    case 'PENDING_APPROVAL':
      return 'Prüfen und freigeben';
    case 'APPROVED':
      return 'Zur Buchhaltung übertragen';
    case 'DUPLICATE_SUSPECTED':
      return 'Dublette prüfen';
    case 'BANK_CHANGE_SUSPECTED':
      return 'Bankverbindung prüfen';
    case 'TRANSFER_FAILED':
      return 'Übertragung erneut anstoßen';
    case 'TRANSFERRED':
      return 'Keine – abgeschlossen';
    case 'REJECTED':
      return 'Keine – abgelehnt';
    default:
      return '–';
  }
}

/** Ausnahmen mit Handlungsbedarf, die nicht in eingeklappten Details versteckt werden dürfen (UI v2 §12.2). */
export function isInvoiceException(status: InvoiceStatus): boolean {
  return status === 'BANK_CHANGE_SUSPECTED' || status === 'DUPLICATE_SUSPECTED' || status === 'TRANSFER_FAILED';
}
