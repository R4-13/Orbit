'use client';

import { useMemo, useState } from 'react';
import { Badge, Card, CardContent, ErrorState, Input, Label } from '@orbit/ui';
import { formatDateTime } from '../../../lib/format';
import { platformErrorMessage } from '../../../lib/platform/platform-client';
import { usePlatformTenants } from '../../../lib/platform/use-platform-data';

const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Aktiv', SUSPENDED: 'Gesperrt', PENDING: 'In Einrichtung', CLOSED: 'Geschlossen' };
const SCOPE_LABELS: Record<string, string> = {
  LOGIN: 'Anmeldung',
  AUTOMATION: 'Automatisierung',
  CONNECTORS: 'Anbindungen',
  BILLING: 'Abrechnung',
  SECURITY_QUARANTINE: 'Sicherheitsquarantäne',
};

export default function PlatformTenantsPage() {
  const { data, isLoading, isError, error, refetch } = usePlatformTenants();
  const [query, setQuery] = useState('');

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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600">Keine Mandanten gefunden.</td>
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.tenantId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900">{t.displayName}</div>
                      <div className="text-xs text-slate-500">{t.slug}</div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={t.lifecycleStatus === 'ACTIVE' ? 'success' : t.lifecycleStatus === 'SUSPENDED' ? 'danger' : 'neutral'}>{STATUS_LABELS[t.lifecycleStatus] ?? t.lifecycleStatus}</Badge>
                      {t.deletionRequested ? <Badge tone="warning" className="ml-1">Löschung angefragt</Badge> : null}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{t.suspensionScopes.length > 0 ? t.suspensionScopes.map((s) => SCOPE_LABELS[s] ?? s).join(', ') : '–'}</td>
                    <td className="px-4 py-2 text-slate-700">{t.userCount}</td>
                    <td className="px-4 py-2 text-slate-700">{formatDateTime(t.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-slate-500">Zustandsänderungen eines Mandanten (Sperren, Kohorten) erfolgen derzeit über die Plattform-API mit Vorschau und Bestätigung; die Oberfläche zeigt sie an.</p>
    </>
  );
}
