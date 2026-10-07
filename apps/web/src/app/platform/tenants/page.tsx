'use client';

import { Fragment, useMemo, useState } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button, Card, CardContent, ErrorState, Input, Label } from '@orbit/ui';
import { TenantLifecyclePanel } from '../../../components/platform/tenant-lifecycle-panel';
import { formatDateTime } from '../../../lib/format';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { platformErrorMessage } from '../../../lib/platform/platform-client';
import { suspensionScopeLabel, tenantStatusLabel } from '../../../lib/platform/tenant-labels';
import { usePlatformTenants } from '../../../lib/platform/use-platform-data';


export default function PlatformTenantsPage() {
  const { data, isLoading, isError, error, refetch } = usePlatformTenants();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const { hasScope } = usePlatformAuth();
  const canChange = hasScope(PLATFORM_SCOPES.TENANTS_LIFECYCLE_WRITE);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter((t) => !needle || t.displayName.toLowerCase().includes(needle) || t.slug.toLowerCase().includes(needle));
  }, [data, query]);

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) return <ErrorState message={platformErrorMessage(error, 'Die Mandanten konnten nicht geladen werden.')} onRetry={() => refetch()} />;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mandanten</h1>
          <p className="text-sm text-slate-600">
            {rows.length} von {data.length} Mandanten · nur Stammdaten und Zustand, keine Geschäftsdaten
          </p>
        </div>
        <div className="w-full sm:w-72">
          <Label htmlFor="tenant-search">Suche</Label>
          <Input id="tenant-search" type="search" placeholder="Name oder Kennung" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Mandanten der Plattform</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Mandant</th>
                <th scope="col" className="px-4 py-2 font-medium">Zustand</th>
                <th scope="col" className="px-4 py-2 font-medium">Sperren</th>
                <th scope="col" className="px-4 py-2 font-medium">Benutzer</th>
                <th scope="col" className="px-4 py-2 font-medium">Angelegt</th>
                {canChange ? <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Aktion</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={canChange ? 6 : 5} className="px-4 py-6 text-center text-slate-600">Keine Mandanten gefunden.</td>
                </tr>
              ) : (
                rows.map((t) => (
                  <Fragment key={t.tenantId}>
                  <tr className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900">{t.displayName}</div>
                      <div className="text-xs text-slate-500">{t.slug}</div>
                      {t.featureCohorts.length > 0 ? <div className="text-xs text-slate-500">Funktionsgruppen: {t.featureCohorts.join(', ')}</div> : null}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={t.lifecycleStatus === 'ACTIVE' ? 'success' : t.lifecycleStatus === 'SUSPENDED' ? 'danger' : 'neutral'}>{tenantStatusLabel(t.lifecycleStatus)}</Badge>
                      {t.deletionRequested ? <Badge tone="warning" className="ml-1">Löschung angefragt</Badge> : null}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{t.suspensionScopes.length > 0 ? t.suspensionScopes.map(suspensionScopeLabel).join(', ') : '–'}</td>
                    <td className="px-4 py-2 text-slate-700">{t.userCount}</td>
                    <td className="px-4 py-2 text-slate-700">{formatDateTime(t.createdAt)}</td>
                    {canChange ? (
                      <td className="px-4 py-2 text-right">
                        <Button variant="secondary" onClick={() => setEditing(editing === t.tenantId ? null : t.tenantId)} aria-label={`Zustand von ${t.displayName} ändern`}>
                          Zustand ändern
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                  {editing === t.tenantId ? (
                    <tr className="border-b border-slate-100">
                      <td colSpan={canChange ? 6 : 5} className="px-4 pb-4">
                        <TenantLifecyclePanel tenant={t} onClose={() => setEditing(null)} />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-slate-500">Jede Änderung zeigt vorab ihre Wirkung, verlangt eine Begründung und Ihr Passwort erneut und steht danach im Audit.</p>
    </>
  );
}
