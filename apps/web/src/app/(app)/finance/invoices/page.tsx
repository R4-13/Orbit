'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Invoice, InvoiceStatus } from '@orbit/domain';
import { Badge, Card, ErrorState, SortableTh, useSortableList } from '@orbit/ui';
import { errorMessage } from '../../../../lib/api-client';
import { formatAmount } from '../../../../lib/format';
import { useInvoices } from '../../../../lib/hooks/use-invoices';
import { statusLabel } from '../../../../lib/status-labels';

const SORT_ACCESSORS = {
  invoiceNumber: (i: Invoice) => i.invoiceNumber,
  amount: (i: Invoice) => Number(i.amountGross ?? 0),
  status: (i: Invoice) => i.status,
};

export default function InvoicesPage() {
  const statusFilter = useSearchParams().get('status') as InvoiceStatus | null;
  const { data: invoices, isLoading, isError, error, refetch } = useInvoices(statusFilter ?? undefined);
  const { sorted, sort, requestSort } = useSortableList(invoices, SORT_ACCESSORS);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Rechnungen</h1>
      <p className="mt-1 text-sm text-slate-500">
        Eingehende Rechnungen, automatisch ausgelesen und auf Dubletten geprüft.
      </p>

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(error, 'Die Rechnungen konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh label="Rechnungsnummer" sortKey="invoiceNumber" sort={sort} onSort={requestSort} />
              <SortableTh label="Betrag" sortKey="amount" sort={sort} onSort={requestSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={requestSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : sorted && sorted.length > 0 ? (
              sorted.map((invoice) => {
                const status = statusLabel(invoice.status);
                return (
                  <tr key={invoice.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/finance/invoices/${invoice.id}`} className="font-medium text-brand hover:underline">
                        {invoice.invoiceNumber ?? '(ohne Nummer)'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatAmount(invoice.amountGross, invoice.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Keine Rechnungen gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      )}
    </div>
  );
}
