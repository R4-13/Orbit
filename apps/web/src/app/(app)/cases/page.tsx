'use client';

import Link from 'next/link';
import { caseTabHref, type CaseListFilter, type CaseSortKey, type ListSortDirection } from '@orbit/shared';
import { ErrorState, SortableTh } from '@orbit/ui';
import { SavedViewsMenu } from '../../../components/common/saved-views-menu';
import { EmptyState, EntityLink, FilterTabs, LastUpdated, PageHeader, Pagination, SearchField, StatusBadge } from '../../../components/common/primitives';
import { errorMessage } from '../../../lib/api-client';
import { useMainWidth } from '../../../lib/hooks/use-element-size';
import { usePersistentState } from '../../../lib/hooks/use-persistent-state';
import { useCaseList } from '../../../lib/hooks/use-ui-projections';
import { formatListDateTime } from '../../../lib/home-format';

interface CaseViewState {
  filter: CaseListFilter;
  type: 'ALL' | 'FINANCE' | 'SALES';
  q: string;
  page: number;
  sort: CaseSortKey;
  dir: ListSortDirection;
}

/**
 * UI/UX v2 §16.1: Vorgänge verbinden die Arbeit – fachlicher Titel, Gegenüber, Status, nächster Schritt, Verantwortlicher und
 * Aktualität. Standard ist „Offene Vorgänge“; keine Liste technischer Agentlauf-IDs.
 */
export default function CasesPage() {
  const [view, setView, resetView] = usePersistentState<CaseViewState>('cases', { filter: 'OPEN', type: 'ALL', q: '', page: 1, sort: 'updatedAt', dir: 'desc' });
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useCaseList({ filter: view.filter, type: view.type === 'ALL' ? undefined : view.type, page: view.page, q: view.q, sort: view.sort, dir: view.dir });
  const width = useMainWidth();
  const compact = width > 0 && width < 900;
  const counts = data?.counts;
  // Serverseitig sortiert (die Liste ist seitenweise): ein Klick wechselt die Richtung, eine neue Spalte beginnt bei „neueste zuerst“ bzw. A–Z.
  const sortState = { key: view.sort, direction: view.dir };
  const requestSort = (key: CaseSortKey) => setView({ ...view, page: 1, sort: key, dir: key === view.sort ? (view.dir === 'asc' ? 'desc' : 'asc') : key === 'title' ? 'asc' : 'desc' });
  const filtered = view.filter !== 'OPEN' || view.type !== 'ALL' || view.q.trim() !== '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vorgänge"
        description="Wie die Arbeit zusammenhängt und wo sie steht – von der Anfrage bis zum Ergebnis."
        stats={counts ? [{ label: 'Offen', value: counts.OPEN }, { label: 'Benötigt Aufmerksamkeit', value: counts.ATTENTION }, { label: 'Abgeschlossen', value: counts.DONE }] : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          label="Vorgänge filtern"
          value={view.filter}
          onChange={(filter) => setView({ ...view, filter, page: 1 })}
          items={[
            { value: 'OPEN', label: 'Offene Vorgänge', count: counts?.OPEN },
            { value: 'ATTENTION', label: 'Benötigt Aufmerksamkeit', count: counts?.ATTENTION },
            { value: 'DONE', label: 'Abgeschlossen', count: counts?.DONE },
            { value: 'ALL', label: 'Alle', count: counts?.ALL },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="case-area">
            Bereich
          </label>
          <select id="case-area" value={view.type} onChange={(event) => setView({ ...view, type: event.target.value as CaseViewState['type'], page: 1 })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900">
            <option value="ALL">Alle Bereiche</option>
            <option value="FINANCE">Finanzen</option>
            <option value="SALES">Vertrieb</option>
          </select>
          <SearchField label="Vorgänge" value={view.q} onChange={(q) => setView({ ...view, q, page: 1 })} placeholder="Vorgang suchen …" />
          {filtered ? (
            <button type="button" onClick={resetView} className="text-sm font-medium text-brand hover:underline">
              Filter zurücksetzen
            </button>
          ) : null}
          <SavedViewsMenu listKey="cases" current={view} onApply={setView} onReset={resetView} />
          <LastUpdated at={data ? new Date(dataUpdatedAt).toISOString() : null} fetching={isFetching} />
        </div>
      </div>

      {isError ? (
        <ErrorState message={errorMessage(error, 'Die Vorgänge konnten nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Vorgänge mit Gegenüber, Status, nächstem Schritt und Aktualität</caption>
            <thead className="bg-slate-50 text-xs font-medium text-slate-700">
              <tr>
                <SortableTh label="Vorgang" sortKey="title" sort={sortState} onSort={requestSort} className="px-3 py-2.5" />
                {compact ? null : (
                  <th scope="col" className="w-56 px-3 py-2.5">
                    Gegenüber
                  </th>
                )}
                <th scope="col" className="w-64 px-3 py-2.5">
                  Status und nächster Schritt
                </th>
                {compact ? null : (
                  <th scope="col" className="w-36 px-3 py-2.5">
                    Verantwortlich
                  </th>
                )}
                {compact ? null : <SortableTh label="Eingegangen" sortKey="createdAt" sort={sortState} onSort={requestSort} className="w-40 px-3 py-2.5" />}
                {compact ? null : <SortableTh label="Aktualisiert" sortKey="updatedAt" sort={sortState} onSort={requestSort} className="w-40 px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={compact ? 2 : 6} className="px-4 py-8 text-slate-600">
                    Wird geladen …
                  </td>
                </tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 align-top">
                      <Link href={item.href} className="block truncate font-medium text-slate-900 hover:underline" title={item.title}>
                        {item.title}
                      </Link>
                      <p className="truncate text-xs text-slate-600">
                        {item.typeLabel}
                        {compact && item.counterparty ? ` · ${item.counterparty.label}` : ''}
                        {compact ? ` · eingegangen ${formatListDateTime(item.createdAt)} · aktualisiert ${formatListDateTime(item.updatedAt)}` : ''}
                      </p>
                      {item.hasProcess ? (
                        <Link href={caseTabHref(item.id, 'orchestration')} className="text-xs font-medium text-brand hover:underline" aria-label={`Orchestrierung anzeigen: ${item.title}`}>
                          Orchestrierung anzeigen
                        </Link>
                      ) : null}
                    </td>
                    {compact ? null : <td className="px-3 py-3 align-top">{item.counterparty ? <EntityLink entity={item.counterparty} withPreview={false} /> : <span className="text-slate-600">–</span>}</td>}
                    <td className="px-3 py-3 align-top">
                      <StatusBadge tone={item.statusTone}>{item.statusLabel}</StatusBadge>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-700">{item.nextStep}</p>
                    </td>
                    {compact ? null : <td className="px-3 py-3 align-top text-slate-800">{item.ownerLabel ?? <span className="text-slate-600">Nicht zugewiesen</span>}</td>}
                    {compact ? null : <td className="px-3 py-3 align-top text-slate-700">{formatListDateTime(item.createdAt)}</td>}
                    {compact ? null : <td className="px-3 py-3 align-top text-slate-700">{formatListDateTime(item.updatedAt)}</td>}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={compact ? 2 : 6}>
                    <EmptyState title={filtered ? 'Keine Vorgänge für diese Auswahl' : 'Keine offenen Vorgänge'}>{filtered ? 'Passen Sie den Filter an oder setzen Sie ihn zurück.' : 'Sobald eine Anfrage zu einem Vorgang wird, erscheint sie hier.'}</EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {data ? <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setView({ ...view, page })} /> : null}
        </div>
      )}
    </div>
  );
}
