'use client';

import { useState } from 'react';
import { Badge, Button, Card, ErrorState, SortableTh, useSortableList } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { useAuth } from '../../../../lib/auth-context';
import { formatDateTime } from '../../../../lib/format';
import { useDeactivateUser, useUsers, type TenantUserSummary } from '../../../../lib/hooks/use-users';

const STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' }> = {
  ACTIVE: { label: 'Aktiv', tone: 'success' },
  INVITED: { label: 'Eingeladen', tone: 'warning' },
  DEACTIVATED: { label: 'Deaktiviert', tone: 'danger' },
};

const SORT_ACCESSORS = {
  name: (u: TenantUserSummary) => `${u.firstName} ${u.lastName}`,
  email: (u: TenantUserSummary) => u.email,
  status: (u: TenantUserSummary) => u.status,
  lastLoginAt: (u: TenantUserSummary) => (u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null),
};

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading, isError, error: loadError, refetch } = useUsers();
  const { sorted, sort, requestSort } = useSortableList(users, SORT_ACCESSORS);
  const deactivate = useDeactivateUser();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900">Nutzerverwaltung</h1>
      <p className="mt-1 text-sm text-slate-500">
        Deaktivierte Nutzer verlieren sofort den Zugriff — auch bereits laufende Sitzungen werden beendet, nicht
        nur künftige Anmeldungen gesperrt.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(loadError, 'Die Nutzer konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh label="Name" sortKey="name" sort={sort} onSort={requestSort} />
              <SortableTh label="E-Mail" sortKey="email" sort={sort} onSort={requestSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={requestSort} />
              <SortableTh label="Letzte Anmeldung" sortKey="lastLoginAt" sort={sort} onSort={requestSort} />
              <th className="px-4 py-3 font-medium">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  Wird geladen …
                </td>
              </tr>
            ) : sorted && sorted.length > 0 ? (
              sorted.map((user) => {
                const status = STATUS_LABELS[user.status] ?? { label: user.status, tone: 'neutral' as const };
                const isSelf = user.id === currentUser?.id;
                const isPendingThis = deactivate.isPending && deactivate.variables === user.id;
                return (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {user.firstName} {user.lastName}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{user.email}</td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(user.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      {user.status === 'DEACTIVATED' ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : isSelf ? (
                        <span className="text-xs text-slate-400">Eigenes Konto</span>
                      ) : (
                        <Button
                          variant="ghost"
                          disabled={isPendingThis}
                          onClick={() => {
                            setError(null);
                            deactivate.mutate(user.id, {
                              onError: (err) => {
                                setError(
                                  err instanceof ApiError ? err.message : 'Die Deaktivierung ist fehlgeschlagen.',
                                );
                              },
                            });
                          }}
                        >
                          Deaktivieren
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  Keine Nutzer gefunden.
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
