'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PERMISSIONS } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { EmptyState, EntityLink, ExecutionModeBadge, FilterTabs, LastUpdated, PageHeader, Pagination, StatusBadge } from '../../../components/common/primitives';
import { errorMessage } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { formatDateTime } from '../../../lib/format';
import { useAgentRuns } from '../../../lib/hooks/use-agent-runs';
import { usePersistentState } from '../../../lib/hooks/use-persistent-state';
import { useActivityFeed } from '../../../lib/hooks/use-ui-projections';
import { statusLabel } from '../../../lib/status-labels';
import type { AgentType } from '@orbit/domain';

interface ActivityState {
  area: 'ALL' | 'FINANCE' | 'SALES';
  days: number;
  results: boolean;
  page: number;
}

const AGENT_TYPE_LABELS: Record<AgentType, string> = { ORCHESTRATOR: 'Koordination', COMMUNICATION: 'Kommunikation', FINANCE: 'Finanzen', SALES: 'Vertrieb' };

/** Admin-Diagnostik (UI v2 §17): die technischen Assistentenläufe stehen bewusst abseits des fachlichen Ablaufs. */
function Diagnostics() {
  const { data: runs, isLoading, isError, error, refetch } = useAgentRuns({});
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Diagnose für die Administration: Assistentenläufe und Werkzeugaufrufe</summary>
      <div className="mt-3 space-y-2">
        {isError ? (
          <ErrorState message={errorMessage(error, 'Die Läufe konnten nicht geladen werden.')} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <p className="text-sm text-slate-600">Wird geladen …</p>
        ) : runs && runs.length > 0 ? (
          runs.slice(0, 50).map((run) => {
            const status = statusLabel(run.status);
            return (
              <div key={run.id} className="rounded-md border border-slate-100 p-3 text-xs text-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {AGENT_TYPE_LABELS[run.agentType]} · {run.triggerType}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    {run.caseId ? (
                      <Link href={`/cases/${run.caseId}`} className="font-medium text-brand hover:underline">
                        Vorgang öffnen
                      </Link>
                    ) : null}
                  </span>
                </div>
                <p className="mt-1">{formatDateTime(run.startedAt)}</p>
                {run.toolInvocations.length > 0 ? <p className="mt-1">{run.toolInvocations.map((inv) => `${inv.toolName} (${inv.status})`).join(', ')}</p> : null}
                {run.errorMessage ? <p className="mt-1 text-red-700">{run.errorMessage}</p> : null}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-slate-600">Noch keine Läufe.</p>
        )}
      </div>
    </details>
  );
}

function Activity() {
  const { hasPermission } = useAuth();
  const caseId = useSearchParams().get('caseId') ?? undefined;
  const [state, setState] = usePersistentState<ActivityState>('activity', { area: 'ALL', days: 7, results: true, page: 1 });
  const { data, isLoading, isError, error, refetch, isFetching } = useActivityFeed({ ...state, caseId });

  return (
    <div className="space-y-4">
      <PageHeader title="Aktivitäten" description="Was tatsächlich passiert ist – mit Zeit, Handelndem, betroffenem Objekt und – bei Wirkungen nach außen – dem Nachweis." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterTabs
            label="Ereignisse"
            value={state.results ? 'RESULTS' : 'ALL'}
            onChange={(value) => setState({ ...state, results: value === 'RESULTS', page: 1 })}
            items={[
              { value: 'RESULTS', label: 'Ergebnisse und Entscheidungen' },
              { value: 'ALL', label: 'Alle Ereignisse' },
            ]}
          />
          <label className="sr-only" htmlFor="activity-area">
            Bereich
          </label>
          <select id="activity-area" value={state.area} onChange={(event) => setState({ ...state, area: event.target.value as ActivityState['area'], page: 1 })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
            <option value="ALL">Alle Bereiche</option>
            <option value="FINANCE">Finanzen</option>
            <option value="SALES">Vertrieb</option>
          </select>
          <label className="sr-only" htmlFor="activity-days">
            Zeitraum
          </label>
          <select id="activity-days" value={state.days} onChange={(event) => setState({ ...state, days: Number(event.target.value), page: 1 })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
            <option value={1}>Letzte 24 Stunden</option>
            <option value={7}>Letzte 7 Tage</option>
            <option value={30}>Letzte 30 Tage</option>
            <option value={90}>Letzte 90 Tage</option>
          </select>
          {caseId ? (
            <Link href="/activity" className="text-sm font-medium text-brand hover:underline">
              Filter „Vorgang“ entfernen
            </Link>
          ) : null}
        </div>
        <LastUpdated at={data?.generatedAt} fetching={isFetching} />
      </div>

      {isError ? (
        <ErrorState message={errorMessage(error, 'Die Aktivitäten konnten nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="text-sm text-slate-600">Wird geladen …</p>
      ) : data && data.entries.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <ol aria-label="Ereignisse in zeitlicher Reihenfolge" className="divide-y divide-slate-100">
            {data.entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <time dateTime={entry.at} className="w-36 shrink-0 text-[13px] text-slate-700">
                  {formatDateTime(entry.at)}
                </time>
                <div className="min-w-0 flex-1 basis-60">
                  <p className="font-medium text-slate-900">{entry.title}</p>
                  <p className="text-xs text-slate-600">{entry.actorLabel}</p>
                </div>
                <div className="min-w-0 max-w-[18rem] basis-40">{entry.entity ? <EntityLink entity={entry.entity} /> : null}</div>
                <div className="flex shrink-0 items-center gap-2">
                  {entry.evidence ? (
                    <>
                      <ExecutionModeBadge mode={entry.evidence.executionMode} />
                      <StatusBadge tone={entry.evidence.confirmed ? 'success' : 'danger'}>{entry.evidence.label}</StatusBadge>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setState({ ...state, page })} />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState title="Keine Ereignisse im gewählten Zeitraum">Wählen Sie einen längeren Zeitraum oder „Alle Ereignisse“.</EmptyState>
        </div>
      )}

      {hasPermission(PERMISSIONS.AGENT_MANAGE) ? <Diagnostics /> : null}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-600">Wird geladen …</p>}>
      <Activity />
    </Suspense>
  );
}
