'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { InvoiceStatus } from '@orbit/domain';
import { Badge, Card } from '@orbit/ui';
import { formatAmount } from '../../../../lib/format';
import { useInvoices } from '../../../../lib/hooks/use-invoices';
import { statusLabel } from '../../../../lib/status-labels';

export default function InvoicesPage() {
  const statusFilter = useSearchParams().get('status') as InvoiceStatus | null;
  const { data: invoices, isLoading } = useInvoices(statusFilter ?? undefined);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Rechnungen</h1>
      <p className="mt-1 text-sm text-slate-500">
        Eingehende Rechnungen, automatisch ausgelesen und auf Dubletten geprüft.
      </p>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Rechnungsnummer</th>
              <th className="px-4 py-3 font-medium">Betrag</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : invoices && invoices.length > 0 ? (
              invoices.map((invoice) => {
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
    </div>
  );
}
