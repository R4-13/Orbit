'use client';

import { useState } from 'react';
import type { Task } from '@orbit/domain';
import { Badge, Button, Card, ErrorState, SortableTh, useSortableList } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../lib/api-client';
import { useCompleteTask, useTasks } from '../../../lib/hooks/use-tasks';
import { statusLabel } from '../../../lib/status-labels';

const SORT_ACCESSORS = {
  title: (t: Task) => t.title,
  status: (t: Task) => t.status,
};

export default function TasksPage() {
  const { data: tasks, isLoading, isError, error: tasksError, refetch } = useTasks();
  const { sorted, sort, requestSort } = useSortableList(tasks, SORT_ACCESSORS);
  const completeTask = useCompleteTask();
  const [error, setError] = useState<string | null>(null);

  async function handleComplete(id: string) {
    setError(null);
    try {
      await completeTask.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aufgabe konnte nicht abgeschlossen werden.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900">Aufgaben</h1>
      <p className="mt-1 text-sm text-slate-500">Ihre offenen und erledigten Aufgaben.</p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(tasksError, 'Die Aufgaben konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
        <Card className="mt-6 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label="Titel" sortKey="title" sort={sort} onSort={requestSort} />
                <SortableTh label="Status" sortKey="status" sort={sort} onSort={requestSort} />
                <th className="px-4 py-3 font-medium" />
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
                sorted.map((task) => {
                  const status = statusLabel(task.status);
                  return (
                    <tr key={task.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{task.title}</p>
                        {task.description ? (
                          <p className="text-xs text-slate-500">{task.description}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {task.status === 'OPEN' ? (
                          <Button
                            variant="secondary"
                            onClick={() => handleComplete(task.id)}
                            disabled={completeTask.isPending}
                          >
                            Erledigt
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={3}>
                    Keine Aufgaben gefunden.
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
