'use client';

import { useParams } from 'next/navigation';
import type { OpportunityStage } from '@orbit/domain';
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { errorMessage } from '../../../../../lib/api-client';
import { formatAmount, formatDateTime } from '../../../../../lib/format';
import { useOpportunity, useUpdateOpportunityStage } from '../../../../../lib/hooks/use-opportunities';
import { statusLabel } from '../../../../../lib/status-labels';

const STAGE_OPTIONS: OpportunityStage[] = ['NEW', 'QUALIFICATION', 'PROPOSAL', 'WON', 'LOST'];

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: opportunity, isLoading, isError, error, refetch } = useOpportunity(id);
  const updateStage = useUpdateOpportunityStage(id);

  if (isLoading) {
    return <p className="text-sm text-slate-600">Wird geladen …</p>;
  }
  if (isError) {
    return (
      <ErrorState message={errorMessage(error, 'Die Opportunity konnte nicht geladen werden.')} onRetry={() => void refetch()} />
    );
  }
  if (!opportunity) {
    return <p className="text-sm text-slate-600">Opportunity nicht gefunden.</p>;
  }

  const stage = statusLabel(opportunity.stage);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{opportunity.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {opportunity.value !== null ? formatAmount(opportunity.value, opportunity.currency) : 'Kein Wert hinterlegt'}
          </p>
          <p className="mt-1 text-xs text-slate-600">Erstellt {formatDateTime(opportunity.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={stage.tone}>{stage.label}</Badge>
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            value={opportunity.stage}
            disabled={updateStage.isPending}
            onChange={(event) => updateStage.mutate(event.target.value as OpportunityStage)}
          >
            {STAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option).label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-600">Währung</dt>
            <dd>{opportunity.currency}</dd>
            <dt className="text-slate-600">CRM-Referenz</dt>
            <dd>{opportunity.crmExternalId ?? '–'}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
