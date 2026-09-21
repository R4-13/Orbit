'use client';

import Link from 'next/link';
import { Badge, Card } from '@orbit/ui';
import { useApprovals } from '../../../lib/hooks/use-approvals';
import { statusLabel } from '../../../lib/status-labels';

const ENTITY_LABELS: Record<string, string> = {
  INVOICE: 'Rechnung',
  BOOKING_PROPOSAL: 'Buchungsvorschlag',
  SUPPLIER: 'Lieferant',
  FOLLOW_UP: 'Folgeaktion',
  MEETING: 'Termin',
};

function detailLink(entityType: string, entityId: string): string | null {
  if (entityType === 'INVOICE') return `/finance/invoices/${entityId}`;
  if (entityType === 'SUPPLIER') return '/finance/suppliers';
  return null;
}

export default function ApprovalsPage() {
  const { data: approvals, isLoading } = useApprovals();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900">Freigaben</h1>
      <p className="mt-1 text-sm text-slate-500">
        Übersicht aller Vorgänge, die eine menschliche Entscheidung benötigen.
      </p>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Art</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Angefragt am</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : approvals && approvals.length > 0 ? (
              approvals.map((approval) => {
                const status = statusLabel(approval.status);
                const link = detailLink(approval.entityType, approval.entityId);
                const label = ENTITY_LABELS[approval.entityType] ?? approval.entityType;
                return (
                  <tr key={approval.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {link ? (
                        <Link href={link} className="text-brand hover:underline">
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(
                        new Date(approval.requestedAt),
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Keine ausstehenden Freigaben.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
