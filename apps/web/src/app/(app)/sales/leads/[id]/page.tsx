'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { LeadStatus } from '@orbit/domain';
import { PERMISSIONS, internalHref } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { LastUpdated, Notice, PageHeader, RelatedObjects, StatusBadge } from '../../../../../components/common/primitives';
import { apiFetch, errorMessage } from '../../../../../lib/api-client';
import { useAuth } from '../../../../../lib/auth-context';
import { formatAmount, formatDateTime } from '../../../../../lib/format';
import { useLead } from '../../../../../lib/hooks/use-leads';
import { statusLabel } from '../../../../../lib/status-labels';

const STATUS_OPTIONS: LeadStatus[] = ['NEW', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'];
const SOURCE_LABELS: Record<string, string> = { EMAIL: 'E-Mail', PHONE: 'Telefon', WEB: 'Web', MANUAL: 'Manuell' };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 text-sm text-slate-800">{children}</div>
    </section>
  );
}

/**
 * Detail eines Interessenten (UI v2 §13.2): Kontakt/Unternehmen, Anliegen, Quelle, nächste Handlung, Status und CRM-Stand.
 * Kommunikation und Vorgang sind direkt verlinkt. Der CRM-Stand ist nur „bestätigt“, wenn der Kontakt tatsächlich im CRM geführt wird.
 */
export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { data: lead, isLoading, isError, error, refetch, dataUpdatedAt } = useLead(id);
  const queryClient = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: (status: LeadStatus) => apiFetch(`/v1/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const back = (
    <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      <ArrowLeft size={14} aria-hidden="true" /> Zurück zu den Interessenten
    </button>
  );

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !lead) {
    return (
      <div className="space-y-3">
        {back}
        <ErrorState message={errorMessage(error, 'Der Interessent konnte nicht geladen werden – er existiert nicht mehr oder Sie haben keinen Zugriff.')} onRetry={() => void refetch()} />
        <Link href="/sales/leads" className="text-sm font-medium text-brand hover:underline">
          Zur Liste
        </Link>
      </div>
    );
  }

  const status = statusLabel(lead.status);
  const name = `${lead.contact.firstName} ${lead.contact.lastName}`.trim();
  const crmConfirmed = Boolean(lead.contact.crmExternalId);

  return (
    <div className="space-y-4">
      {back}
      <PageHeader title={name} description={`${lead.company?.name ?? 'Kein Unternehmen'} · Anfrage über ${SOURCE_LABELS[lead.source] ?? lead.source} vom ${formatDateTime(lead.createdAt)}`}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <LastUpdated at={new Date(dataUpdatedAt).toISOString()} />
          {hasPermission(PERMISSIONS.CRM_LEAD_CREATE) ? (
            <label className="flex items-center gap-2 text-sm text-slate-800">
              Status ändern
              <select
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
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
            </label>
          ) : null}
        </div>
      </PageHeader>

      {updateStatus.isError ? <Notice tone="danger">{errorMessage(updateStatus.error, 'Der Status konnte nicht geändert werden.')}</Notice> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          <Card title="Anliegen und Kontakt">
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-slate-600">Anliegen</dt>
              <dd className="whitespace-pre-wrap break-words">{lead.notes ?? 'Kein Text hinterlegt.'}</dd>
              <dt className="text-slate-600">E-Mail</dt>
              <dd className="break-all">{lead.contact.email ?? '–'}</dd>
              <dt className="text-slate-600">Telefon</dt>
              <dd>{lead.contact.phone ?? '–'}</dd>
              <dt className="text-slate-600">CRM-Stand</dt>
              <dd>
                <StatusBadge tone={crmConfirmed ? 'success' : 'warning'}>{crmConfirmed ? 'Im CRM bestätigt' : 'Noch nicht abgeglichen'}</StatusBadge>
                {!crmConfirmed ? <span className="ml-2 text-xs text-slate-600">ORBIT legt keinen neuen Kunden ungeprüft an und ersetzt keinen vorhandenen.</span> : null}
              </dd>
            </dl>
          </Card>

          {lead.opportunities.length > 0 ? (
            <Card title="Verkaufschancen">
              <ul className="divide-y divide-slate-100">
                {lead.opportunities.map((opportunity) => {
                  const stage = statusLabel(opportunity.stage);
                  return (
                    <li key={opportunity.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <Link href={`/sales/opportunities/${opportunity.id}`} className="min-w-0 truncate font-medium text-brand hover:underline">
                        {opportunity.name}
                      </Link>
                      <span className="text-slate-700">{opportunity.value !== null ? formatAmount(opportunity.value, opportunity.currency) : '–'}</span>
                      <StatusBadge tone={stage.tone}>{stage.label}</StatusBadge>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <RelatedObjects
            items={[
              { label: 'Vorgang', entity: lead.caseId ? { type: 'CASE', id: lead.caseId, label: 'Zugehöriger Vorgang', href: internalHref('CASE', lead.caseId) } : undefined },
              { label: 'Kontakt', text: name },
              { label: 'Unternehmen', text: lead.company?.name },
              { label: 'Verkaufschancen', text: lead.opportunities.length > 0 ? `${lead.opportunities.length}` : undefined },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
