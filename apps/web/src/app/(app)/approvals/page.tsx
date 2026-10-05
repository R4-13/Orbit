'use client';

import Link from 'next/link';
import { ErrorState } from '@orbit/ui';
import { EmptyState, EntityLink, FilterTabs, LastUpdated, PageHeader, StatusBadge } from '../../../components/common/primitives';
import { errorMessage } from '../../../lib/api-client';
import { useMainWidth } from '../../../lib/hooks/use-element-size';
import { usePersistentState } from '../../../lib/hooks/use-persistent-state';
import { useApprovalQueue } from '../../../lib/hooks/use-ui-projections';
import { formatListTime } from '../../../lib/home-format';

interface QueueState {
  scope: 'MINE' | 'TEAM';
}

const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;
const STATUS_LABEL = { PENDING: 'Offen', APPROVED: 'Genehmigt', REJECTED: 'Abgelehnt' } as const;

/**
 * UI/UX v2 §14.1: Standard „Meine offenen Freigaben“; Team/alle als sichtbare Auswahl. Eine Zeile nennt die konkrete Aktion, das
 * betroffene Objekt, einen Betrag (wenn relevant), Grund/Risiko, Zeitpunkt und Status. Entschieden wird im Detail – nie blind aus der
 * Liste: erst dort sieht man, was genau passiert.
 */
export default function ApprovalsPage() {
  const [state, setState] = usePersistentState<QueueState>('approvals', { scope: 'MINE' });
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useApprovalQueue(state.scope);
  const width = useMainWidth();
  const compact = width > 0 && width < 900;
  const open = data?.filter((item) => item.status === 'PENDING').length ?? 0;
  const critical = data?.filter((item) => item.status === 'PENDING' && item.risk === 'CRITICAL').length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Freigaben"
        description="Entscheidungen, die ORBIT von Ihnen braucht – mit allem, was Sie dafür wissen müssen."
        stats={data ? [{ label: state.scope === 'MINE' ? 'Offen für Sie' : 'Offen im Team', value: open }, { label: 'Davon kritisch', value: critical }] : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          label="Freigaben auswählen"
          value={state.scope}
          onChange={(scope) => setState({ scope })}
          items={[
            { value: 'MINE', label: 'Meine offenen Freigaben' },
            { value: 'TEAM', label: 'Team: alle zugänglichen' },
          ]}
        />
        <LastUpdated at={data ? new Date(dataUpdatedAt).toISOString() : null} fetching={isFetching} />
      </div>

      {isError ? (
        <ErrorState message={errorMessage(error, 'Die Freigaben konnten nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Freigaben mit Aktion, Objekt, Grund und Status</caption>
            <thead className="bg-slate-50 text-xs font-medium text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2.5">
                  Angeforderte Aktion
                </th>
                {compact ? null : (
                  <th scope="col" className="w-56 px-3 py-2.5">
                    Betroffenes Objekt
                  </th>
                )}
                {compact ? null : (
                  <th scope="col" className="w-28 px-3 py-2.5 text-right">
                    Betrag
                  </th>
                )}
                <th scope="col" className="w-40 px-3 py-2.5">
                  Status
                </th>
                <th scope="col" className="w-28 px-3 py-2.5">
                  <span className="sr-only">Entscheidung</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={compact ? 3 : 5} className="px-4 py-8 text-slate-600">
                    Wird geladen …
                  </td>
                </tr>
              ) : data && data.length > 0 ? (
                data.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 align-top">
                      <Link href={item.href} className="block truncate font-medium text-slate-900 hover:underline" title={item.actionLabel}>
                        {item.actionLabel}
                      </Link>
                      <p className="line-clamp-2 text-[13px] text-slate-700">{item.reason}</p>
                      {compact && item.object ? <p className="mt-0.5 truncate text-xs text-slate-600">{item.object.label}{item.amountText ? ` · ${item.amountText}` : ''}</p> : null}
                    </td>
                    {compact ? null : <td className="px-3 py-3 align-top">{item.object ? <EntityLink entity={item.object} /> : <span className="text-slate-500">–</span>}</td>}
                    {compact ? null : <td className="px-3 py-3 text-right align-top tabular-nums text-slate-900">{item.amountText ?? '–'}</td>}
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-col items-start gap-1">
                        {item.risk === 'CRITICAL' && item.status === 'PENDING' ? <StatusBadge tone="danger">Kritisch prüfen</StatusBadge> : <StatusBadge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</StatusBadge>}
                        <span className="text-xs text-slate-600">{formatListTime(item.decidedAt ?? item.requestedAt)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Link href={item.href} className="inline-flex h-9 items-center rounded-md border border-slate-300 px-3 text-[13px] font-medium text-slate-900 hover:bg-slate-50" aria-label={`${item.status === 'PENDING' ? 'Freigabe prüfen' : 'Ansehen'}: ${item.actionLabel}`}>
                        {item.status === 'PENDING' ? 'Prüfen' : 'Ansehen'}
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={compact ? 3 : 5}>
                    <EmptyState title={state.scope === 'MINE' ? 'Keine offenen Freigaben' : 'Keine Freigaben vorhanden'}>
                      {state.scope === 'MINE' ? 'Im Moment wartet nichts auf Ihre Entscheidung. Sobald ORBIT etwas vorbereitet hat, das Ihre Freigabe braucht, erscheint es hier.' : 'Es wurden noch keine Freigaben angefordert.'}
                    </EmptyState>
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
