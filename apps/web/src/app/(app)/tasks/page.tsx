'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TaskListItem, TaskSection } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { SavedViewsMenu } from '../../../components/common/saved-views-menu';
import { EmptyState, EntityLink, FilterTabs, FocusNotice, LastUpdated, Notice, PageHeader, StatusBadge } from '../../../components/common/primitives';
import { ApiError, errorMessage } from '../../../lib/api-client';
import { useFocusParam } from '../../../lib/hooks/use-focus-param';
import { usePersistentState } from '../../../lib/hooks/use-persistent-state';
import { useCompleteTask } from '../../../lib/hooks/use-tasks';
import { useTaskList } from '../../../lib/hooks/use-ui-projections';
import { formatDue, formatListDateTime } from '../../../lib/home-format';

type TaskSort = 'due' | 'newest' | 'oldest' | 'title';

interface TaskViewState {
  scope: 'MINE' | 'TEAM';
  done: boolean;
  sort: TaskSort;
}

const SORT_LABELS: Record<TaskSort, string> = { due: 'Fälligkeit', newest: 'Angelegt: neueste zuerst', oldest: 'Angelegt: älteste zuerst', title: 'Titel (A–Z)' };

/** Sortiert innerhalb eines Abschnitts; Aufgaben ohne Frist stehen bei „Fälligkeit“ zuletzt. */
function sortTasks(items: TaskListItem[], sort: TaskSort): TaskListItem[] {
  const copy = [...items];
  copy.sort((a, b) => {
    switch (sort) {
      case 'newest':
        return b.createdAt.localeCompare(a.createdAt);
      case 'oldest':
        return a.createdAt.localeCompare(b.createdAt);
      case 'title':
        return a.title.localeCompare(b.title, 'de', { numeric: true });
      default:
        return (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9');
    }
  });
  return copy;
}

const SECTION_META: Record<TaskSection, { title: string; tone: 'danger' | 'warning' | 'info' | 'neutral' | 'success' }> = {
  OVERDUE: { title: 'Überfällig', tone: 'danger' },
  TODAY: { title: 'Heute fällig', tone: 'warning' },
  LATER: { title: 'Später', tone: 'info' },
  NO_DUE_DATE: { title: 'Ohne Frist', tone: 'neutral' },
  DONE: { title: 'Erledigt', tone: 'success' },
};
const SECTION_ORDER: TaskSection[] = ['OVERDUE', 'TODAY', 'LATER', 'NO_DUE_DATE', 'DONE'];

function TaskRow({ task, onComplete, busy }: { task: TaskListItem; onComplete: (id: string) => void; busy: boolean }) {
  // §15: kein loses „Erledigt“ für Aufgaben, deren Vorgang über einen Prozess läuft – dort entscheidet der Vorgang, nicht ein Klick.
  const completable = task.status === 'OPEN' && !task.caseHasProcess;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="truncate font-medium text-slate-900" title={task.title}>
          {task.title}
        </p>
        {task.expectedResult ? <p className="line-clamp-2 text-[13px] text-slate-700">Benötigtes Ergebnis: {task.expectedResult}</p> : null}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-600">
          {task.dueAt ? <span className={task.section === 'OVERDUE' ? 'font-medium text-red-700' : ''}>{formatDue(task.dueAt)}</span> : null}
          <span>angelegt {formatListDateTime(task.createdAt)}</span>
          {task.areaLabel ? <span>{task.areaLabel}</span> : null}
          {task.fromAssistant ? <span>Vom Assistenten angelegt</span> : null}
          {task.assigneeLabel ? <span>Zuständig: {task.assigneeLabel}</span> : <span>Nicht zugewiesen</span>}
        </p>
      </div>
      <div className="min-w-0 max-w-[16rem] basis-48">{task.relatedCase ? <EntityLink entity={task.relatedCase} /> : <span className="text-sm text-slate-600">Kein Vorgang</span>}</div>
      <div className="flex shrink-0 items-center gap-2">
        {task.status === 'DONE' ? <StatusBadge tone="success">Erledigt</StatusBadge> : null}
        {task.status === 'OPEN' && task.caseHasProcess && task.relatedCase?.href ? (
          <Link href={task.relatedCase.href} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-[13px] font-medium text-brand-foreground hover:bg-brand/90">
            Vorgang öffnen
          </Link>
        ) : null}
        {completable ? (
          <button type="button" onClick={() => onComplete(task.id)} disabled={busy} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50">
            Als erledigt markieren
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * UI/UX v2 §15: „Meine Arbeit zuerst“ – überfällig, heute, später. Eine Aufgabe nennt das konkrete Ergebnis und verlinkt ihren Vorgang;
 * ein Prozess-Vorgang wird im Vorgang bearbeitet, nicht durch ein loses „Erledigt“.
 */
export default function TasksPage() {
  const [view, setView, resetView] = usePersistentState<TaskViewState>('tasks', { scope: 'MINE', done: false, sort: 'due' });
  // Absprung aus der Suche: genau diese Aufgabe, unabhängig davon, wem sie gehört und ob sie erledigt ist.
  const focus = useFocusParam('focus');
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useTaskList(focus.value ? { scope: 'TEAM', done: true } : view);
  const completeTask = useCompleteTask();
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleComplete(id: string) {
    setActionError(null);
    try {
      await completeTask.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Die Aufgabe konnte nicht abgeschlossen werden.');
    }
  }

  const visibleItems = data?.items.filter((item) => (focus.value ? item.id === focus.value : true)) ?? [];
  const grouped = SECTION_ORDER.map((section) => ({ section, items: sortTasks(visibleItems.filter((item) => item.section === section), view.sort) })).filter((group) => group.items.length > 0);
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Aufgaben"
        description="Was Sie bis wann erledigen müssen – mit dem Ergebnis, das gebraucht wird."
        stats={counts ? [{ label: 'Überfällig', value: counts.OVERDUE }, { label: 'Heute fällig', value: counts.TODAY }, { label: 'Später', value: counts.LATER + counts.NO_DUE_DATE }] : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterTabs
            label="Aufgaben auswählen"
            value={view.scope}
            onChange={(scope) => setView({ ...view, scope })}
            items={[
              { value: 'MINE', label: 'Meine Aufgaben' },
              { value: 'TEAM', label: 'Team: alle Aufgaben' },
            ]}
          />
          <label className="flex items-center gap-2 text-sm text-slate-800">
            Sortieren nach
            <select value={view.sort} onChange={(event) => setView({ ...view, sort: event.target.value as TaskSort })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900">
              {(Object.keys(SORT_LABELS) as TaskSort[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={view.done} onChange={(event) => setView({ ...view, done: event.target.checked })} className="h-4 w-4" />
            Erledigte anzeigen
          </label>
        </div>
        <div className="flex items-center gap-3">
          <SavedViewsMenu listKey="tasks" current={view} onApply={setView} onReset={resetView} />
          <LastUpdated at={data ? new Date(dataUpdatedAt).toISOString() : null} fetching={isFetching} />
        </div>
      </div>

      {focus.value ? <FocusNotice what="eine Aufgabe" onClear={focus.clear} /> : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

      {isError ? (
        <ErrorState message={errorMessage(error, 'Die Aufgaben konnten nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="text-sm text-slate-600">Wird geladen …</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState title={view.scope === 'MINE' ? 'Keine offenen Aufgaben' : 'Keine Aufgaben im Team'}>Neue Aufgaben entstehen, wenn ORBIT etwas Ihre Mitwirkung braucht – sie erscheinen dann hier.</EmptyState>
        </div>
      ) : (
        grouped.map(({ section, items }) => (
          <section key={section} aria-label={SECTION_META[section].title} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900">
              {SECTION_META[section].title} <StatusBadge tone={SECTION_META[section].tone}>{items.length}</StatusBadge>
            </h2>
            <ul className="divide-y divide-slate-100">
              {items.map((task) => (
                <TaskRow key={task.id} task={task} onComplete={handleComplete} busy={completeTask.isPending} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
