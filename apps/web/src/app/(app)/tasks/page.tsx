'use client';

import { useState } from 'react';
import { Badge, Button, Card } from '@orbit/ui';
import { ApiError } from '../../../lib/api-client';
import { useCompleteTask, useTasks } from '../../../lib/hooks/use-tasks';
import { statusLabel } from '../../../lib/status-labels';

export default function TasksPage() {
  const { data: tasks, isLoading } = useTasks();
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

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Titel</th>
              <th className="px-4 py-3 font-medium">Status</th>
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
            ) : tasks && tasks.length > 0 ? (
              tasks.map((task) => {
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
    </div>
  );
}
