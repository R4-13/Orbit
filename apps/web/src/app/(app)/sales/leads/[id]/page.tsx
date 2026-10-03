'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LeadStatus } from '@orbit/domain';
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { apiFetch, errorMessage } from '../../../../../lib/api-client';
import { formatAmount, formatDateTime } from '../../../../../lib/format';
import { useLead } from '../../../../../lib/hooks/use-leads';
import { statusLabel } from '../../../../../lib/status-labels';

const STATUS_OPTIONS: LeadStatus[] = ['NEW', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'];

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: lead, isLoading, isError, error, refetch } = useLead(id);
  const queryClient = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: (status: LeadStatus) =>
      apiFetch(`/v1/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500">Wird geladen …</p>;
  }
  if (isError) {
    return <ErrorState message={errorMessage(error, 'Der Lead konnte nicht geladen werden.')} onRetry={() => void refetch()} />;
  }
  if (!lead) {
    return <p className="text-sm text-slate-500">Lead nicht gefunden.</p>;
  }

  const status = statusLabel(lead.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {lead.contact.firstName} {lead.contact.lastName}
          </h1>
          {lead.company ? <p className="mt-1 text-sm text-slate-500">{lead.company.name}</p> : null}
          <p className="mt-1 text-xs text-slate-400">Erstellt {formatDateTime(lead.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            value={lead.status}
            disabled={updateStatus.isPending}
            onChange={(event) => updateStatus.mutate(event.target.value as LeadStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option).label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kontaktdaten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">E-Mail</dt>
            <dd>{lead.contact.email ?? '–'}</dd>
            <dt className="text-slate-500">Telefon</dt>
            <dd>{lead.contact.phone ?? '–'}</dd>
            <dt className="text-slate-500">Quelle</dt>
            <dd>{lead.source}</dd>
            <dt className="text-slate-500">Notizen</dt>
            <dd>{lead.notes ?? '–'}</dd>
          </dl>
        </CardContent>
      </Card>

      {lead.opportunities.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Opportunities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lead.opportunities.map((opportunity) => {
              const stage = statusLabel(opportunity.stage);
              return (
                <div key={opportunity.id} className="flex items-center justify-between text-sm">
                  <Link
                    href={`/sales/opportunities/${opportunity.id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {opportunity.name}
                  </Link>
                  <span className="text-slate-600">
                    {opportunity.value !== null ? formatAmount(opportunity.value, opportunity.currency) : '–'}
                  </span>
                  <Badge tone={stage.tone}>{stage.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
