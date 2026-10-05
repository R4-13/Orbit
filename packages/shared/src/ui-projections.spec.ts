import { describe, expect, it } from 'vitest';
import { compareAttention, deduplicateAttention, internalHref, isInternalHref, type AttentionItem } from './ui-projections';
import { categoryLabel, greeting, policyActionLabel, UNMAPPED_LABEL } from './ui-labels';

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    id: 'a',
    deduplicationKey: 'case:1',
    title: 'Titel',
    reason: 'Grund',
    priority: 'NORMAL',
    rank: 3,
    statusLabel: 'Freigabe erforderlich',
    primaryEntity: { type: 'CASE', id: '1', label: 'Vorgang 1', href: '/cases/1' },
    relatedEntities: [],
    availableActions: [{ key: 'review', label: 'Prüfen' }],
    underlyingCount: 1,
    createdAt: '2026-10-05T08:00:00.000Z',
    ...overrides,
  };
}

describe('attention ordering', () => {
  it('sorts critical, overdue, due today, then the rest; newest first inside a rank; stable by id', () => {
    const items = [
      item({ id: 'd', rank: 3, createdAt: '2026-10-05T07:00:00.000Z' }),
      item({ id: 'c', rank: 2 }),
      item({ id: 'b', rank: 1 }),
      item({ id: 'a', rank: 0 }),
      item({ id: 'e', rank: 3, createdAt: '2026-10-05T09:00:00.000Z' }),
      item({ id: 'f', rank: 3, createdAt: '2026-10-05T09:00:00.000Z' }),
    ];
    expect([...items].sort(compareAttention).map((i) => i.id)).toEqual(['a', 'b', 'c', 'e', 'f', 'd']);
  });
});

describe('attention deduplication', () => {
  it('merges an approval and a task for the same case into one entry that keeps both objects reachable', () => {
    const approval = item({ id: 'approval', rank: 3, primaryEntity: { type: 'APPROVAL', id: 'x', label: 'Freigabe', href: '/approvals?focus=x' } });
    const task = item({
      id: 'task',
      rank: 2,
      primaryEntity: { type: 'TASK', id: 't', label: 'Aufgabe', href: '/tasks?focus=t' },
      availableActions: [{ key: 'open-task', label: 'Aufgabe öffnen' }],
    });
    const merged = deduplicateAttention([approval, task]);
    expect(merged).toHaveLength(1);
    const first = merged[0]!;
    expect(first.id).toBe('task');
    expect(first.underlyingCount).toBe(2);
    expect(first.relatedEntities.map((e) => e.type)).toEqual(['APPROVAL']);
    expect(first.availableActions.map((a) => a.key).sort()).toEqual(['open-task', 'review']);
  });

  it('keeps items with different keys apart', () => {
    expect(deduplicateAttention([item({ id: 'a' }), item({ id: 'b', deduplicationKey: 'case:2' })])).toHaveLength(2);
  });
});

describe('internal links', () => {
  it('accepts only internal absolute paths', () => {
    expect(isInternalHref('/cases/123')).toBe(true);
    expect(isInternalHref('/approvals?focus=abc')).toBe(true);
    expect(isInternalHref('//evil.example/x')).toBe(false);
    expect(isInternalHref('https://evil.example')).toBe(false);
    expect(isInternalHref('javascript:alert(1)')).toBe(false);
  });

  it('builds the central object routes and encodes ids', () => {
    expect(internalHref('CASE', 'a/b')).toBe('/cases/a%2Fb');
    expect(internalHref('INVOICE', '1')).toBe('/finance/invoices/1');
    expect(internalHref('DOCUMENT', '1')).toBeUndefined();
  });
});

describe('label registry', () => {
  it('maps registry keys to business language and never invents a label for an unknown key', () => {
    expect(categoryLabel('REQUEST_FOR_QUOTE')).toBe('Angebotsanfrage');
    expect(categoryLabel('INVOICE_RECEIVED')).toBe('Rechnungseingang');
    expect(categoryLabel('SOMETHING_NEW')).toBe(UNMAPPED_LABEL);
    expect(categoryLabel(null)).toBe(UNMAPPED_LABEL);
    expect(policyActionLabel('email.send.quote_delivery')).toBe('Angebot an den Kunden senden');
  });

  it('greets with the first name when there is one, never with an e-mail address', () => {
    expect(greeting(8, 'Anna')).toBe('Guten Morgen, Anna');
    expect(greeting(8, undefined)).toBe('Guten Morgen');
    expect(greeting(8, '  ')).toBe('Guten Morgen');
    expect(greeting(14, 'Anna')).toBe('Guten Tag, Anna');
    expect(greeting(20, null)).toBe('Guten Abend');
  });
});
