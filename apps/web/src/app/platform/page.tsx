'use client';

import { Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { formatDateTime } from '../../lib/format';
import { platformErrorMessage } from '../../lib/platform/platform-client';
import { tenantStatusLabel } from '../../lib/platform/tenant-labels';
import { usePlatformOverview } from '../../lib/platform/use-platform-data';


function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-slate-600">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function PlatformOverviewPage() {
  const { data, isLoading, isError, error, refetch } = usePlatformOverview();

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) return <ErrorState message={platformErrorMessage(error, 'Die Übersicht konnte nicht geladen werden.')} onRetry={() => refetch()} />;

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Plattformübersicht</h1>
        <p className="text-sm text-slate-600">Stand {formatDateTime(data.generatedAt)} · Umgebung {data.environment}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Mandanten" value={data.tenants.total} hint={Object.entries(data.tenants.byStatus).map(([status, count]) => `${tenantStatusLabel(status)}: ${count}`).join(' · ')} />
        <Figure label="Betreiberzugänge aktiv" value={data.platformIdentities.active} hint={data.platformIdentities.disabled > 0 ? `${data.platformIdentities.disabled} deaktiviert` : undefined} />
        <Figure label="Aktive Betreibersitzungen" value={data.activePlatformSessions} />
        <Figure label="Audit-Ereignisse (24 h)" value={data.platformAuditEventsLast24h} />
      </div>
      {data.notYetAvailable.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Noch nicht verfügbar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-slate-600">Diese Angaben zeigt die Plattform bewusst nicht an, statt Werte zu erfinden:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {data.notYetAvailable.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
