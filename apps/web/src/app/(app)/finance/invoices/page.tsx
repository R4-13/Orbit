'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Invoice } from '@orbit/domain';
import { ErrorState } from '@orbit/ui';
import { EmptyState, EntityLink, FilterTabs, LastUpdated, PageHeader, SearchField, StatusBadge } from '../../../../components/common/primitives';
import { errorMessage } from '../../../../lib/api-client';
import { formatAmount } from '../../../../lib/format';
import { useMainWidth } from '../../../../lib/hooks/use-element-size';
import { useInvoices } from '../../../../lib/hooks/use-invoices';
import { usePersistentState } from '../../../../lib/hooks/use-persistent-state';
import { INVOICE_FILTER_LABELS, invoiceNextAction, matchesInvoiceFilter, type InvoiceFilter } from '../../../../lib/invoice-view';
import { statusLabel } from '../../../../lib/status-labels';

type InvoiceRow = Invoice & { supplier?: { id: string; name: string } | null };

interface InvoiceViewState {
  filter: InvoiceFilter;
  q: string;
}

const dueText = (value: Date | string | null | undefined) => (value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(value)) : '–');

/**
 * UI/UX v2 §12.1: Standard „Zu bearbeiten“; die Tabelle zeigt Lieferant und Rechnungsnummer, Betrag, Fälligkeit, Status und die
 * nächste Aktion. Der Lieferant ist ein Link in den Lieferantenkontext, kein zweiter Stammdatenpflege-Ort.
 */
export default function InvoicesPage() {
  const [view, setView, resetView] = usePersistentState<InvoiceViewState>('invoices', { filter: 'TODO', q: '' });
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useInvoices();
  const width = useMainWidth();
  const compact = width > 0 && width < 900;

  const invoices = data as InvoiceRow[] | undefined;
  const counts = useMemo(() => {
    const result: Record<InvoiceFilter, number> = { TODO: 0, ALL: 0, APPROVAL: 0, TRANSFERRED: 0, EXCEPTIONS: 0 };
    for (const invoice of invoices ?? []) for (const key of Object.keys(result) as InvoiceFilter[]) if (matchesInvoiceFilter(invoice.status, key)) result[key] += 1;
    return result;
  }, [invoices]);
  const q = view.q.trim().toLowerCase();
  const rows = (invoices ?? []).filter(
    (invoice) => matchesInvoiceFilter(invoice.status, view.filter) && (q === '' || `${invoice.supplier?.name ?? ''} ${invoice.invoiceNumber ?? ''}`.toLowerCase().includes(q)),
  );
  const filtered = view.filter !== 'TODO' || q !== '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rechnungen"
        description="Welche Eingangsrechnungen Ihre Prüfung brauchen – automatisch ausgelesen und auf Dubletten und geänderte Bankverbindungen geprüft."
        stats={invoices ? [{ label: 'Zu bearbeiten', value: counts.TODO }, { label: 'Freigabe offen', value: counts.APPROVAL }, { label: 'Ausnahmen', value: counts.EXCEPTIONS }] : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          label="Rechnungen filtern"
          value={view.filter}
          onChange={(filter) => setView({ ...view, filter })}
          items={(['TODO', 'ALL', 'APPROVAL', 'TRANSFERRED', 'EXCEPTIONS'] as InvoiceFilter[]).map((value) => ({ value, label: INVOICE_FILTER_LABELS[value], count: invoices ? counts[value] : undefined }))}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SearchField label="Rechnungen" value={view.q} onChange={(value) => setView({ ...view, q: value })} placeholder="Lieferant oder Nummer …" />
          {filtered ? (
            <button type="button" onClick={resetView} className="text-sm font-medium text-brand hover:underline">
              Filter zurücksetzen
            </button>
          ) : null}
          <LastUpdated at={invoices ? new Date(dataUpdatedAt).toISOString() : null} fetching={isFetching} />
        </div>
      </div>

      {isError ? (
        <ErrorState message={errorMessage(error, 'Die Rechnungen konnten nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Rechnungen mit Lieferant, Betrag, Fälligkeit, Status und nächster Aktion</caption>
            <thead className="bg-slate-50 text-xs font-medium text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2.5">
                  Lieferant und Rechnungsnummer
                </th>
                <th scope="col" className="w-32 px-3 py-2.5 text-right">
                  Betrag
                </th>
                {compact ? null : (
                  <th scope="col" className="w-32 px-3 py-2.5">
                    Fällig am
                  </th>
                )}
                <th scope="col" className="w-56 px-3 py-2.5">
                  Status und nächste Aktion
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={compact ? 3 : 4} className="px-4 py-8 text-slate-600">
                    Wird geladen …
                  </td>
                </tr>
              ) : rows.length > 0 ? (
                rows.map((invoice) => {
                  const status = statusLabel(invoice.status);
                  return (
                    <tr key={invoice.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 align-top">
                        <Link href={`/finance/invoices/${invoice.id}`} className="block truncate font-medium text-slate-900 hover:underline" title={invoice.invoiceNumber ?? undefined}>
                          {invoice.invoiceNumber ?? '(ohne Nummer)'}
                        </Link>
                        <div className="truncate text-[13px] text-slate-700">
                          {invoice.supplier ? <EntityLink entity={{ type: 'SUPPLIER', id: invoice.supplier.id, label: invoice.supplier.name, href: '/finance/suppliers' }} withPreview={false} /> : <span className="text-slate-500">Lieferant noch nicht zugeordnet</span>}
                          {compact ? ` · fällig ${dueText(invoice.dueDate)}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right align-top tabular-nums text-slate-900">{formatAmount(invoice.amountGross, invoice.currency)}</td>
                      {compact ? null : <td className="px-3 py-3 align-top text-slate-800">{dueText(invoice.dueDate)}</td>}
                      <td className="px-3 py-3 align-top">
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        <p className="mt-1 truncate text-xs text-slate-700">{invoiceNextAction(invoice.status)}</p>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={compact ? 3 : 4}>
                    <EmptyState title={filtered ? 'Keine Rechnungen für diese Auswahl' : 'Keine Rechnungen zu bearbeiten'}>{filtered ? 'Passen Sie den Filter an oder setzen Sie ihn zurück.' : 'Alles erledigt – neue Rechnungen erscheinen hier, sobald sie eingehen.'}</EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
