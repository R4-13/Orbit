import { describe, expect, it } from 'vitest';
import { invoiceNextAction, isInvoiceException, matchesInvoiceFilter } from './invoice-view';

describe('invoice filters', () => {
  it('"Zu bearbeiten" keeps open work and hides finished or rejected invoices', () => {
    expect(matchesInvoiceFilter('PENDING_APPROVAL', 'TODO')).toBe(true);
    expect(matchesInvoiceFilter('APPROVED', 'TODO')).toBe(true); // wartet noch auf die Übertragung
    expect(matchesInvoiceFilter('BANK_CHANGE_SUSPECTED', 'TODO')).toBe(true);
    expect(matchesInvoiceFilter('TRANSFERRED', 'TODO')).toBe(false);
    expect(matchesInvoiceFilter('REJECTED', 'TODO')).toBe(false);
  });

  it('separates approval-open, transferred and exceptions; "Alle" matches everything', () => {
    expect(matchesInvoiceFilter('PENDING_APPROVAL', 'APPROVAL')).toBe(true);
    expect(matchesInvoiceFilter('APPROVED', 'APPROVAL')).toBe(false);
    expect(matchesInvoiceFilter('TRANSFERRED', 'TRANSFERRED')).toBe(true);
    expect(matchesInvoiceFilter('REJECTED', 'EXCEPTIONS')).toBe(true);
    expect(matchesInvoiceFilter('TRANSFER_FAILED', 'EXCEPTIONS')).toBe(true);
    expect(matchesInvoiceFilter('REJECTED', 'ALL')).toBe(true);
  });

  it('names a next action for every status and flags the exceptions that must stay visible', () => {
    for (const status of ['RECEIVED', 'EXTRACTED', 'DUPLICATE_SUSPECTED', 'BANK_CHANGE_SUSPECTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'TRANSFERRED', 'TRANSFER_FAILED'] as const) {
      expect(invoiceNextAction(status)).not.toBe('–');
    }
    expect(isInvoiceException('BANK_CHANGE_SUSPECTED')).toBe(true);
    expect(isInvoiceException('TRANSFERRED')).toBe(false);
  });
});
