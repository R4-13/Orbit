'use client';

import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { formatDateTime } from '../../lib/format';
import { usePlatformAuth } from '../../lib/platform/platform-auth';
import { platformErrorMessage } from '../../lib/platform/platform-client';
import { tenantStatusLabel } from '../../lib/platform/tenant-labels';
import { useRuntimeHealth, usePlatformOverview } from '../../lib/platform/use-platform-data';


const QUEUE_LABELS: Record<string, string> = { 'workflow-runs': 'Abläufe und Vorgänge', 'channel-sync': 'Postfach-Abgleich' };
const STATUS_TONE = { OK: 'success', DEGRADED: 'warning', DOWN: 'danger' } as const;
const STATUS_LABEL = { OK: 'In Ordnung', DEGRADED: 'Eingeschränkt', DOWN: 'Steht still' } as const;

/** Hintergrundverarbeitung: ohne verbundenen Worker wird nichts bearbeitet – das steht ganz oben und nicht erst in einer Tabelle. */
function RuntimeCard() {
  const { hasScope } = usePlatformAuth();
  const allowed = hasScope(PLATFORM_SCOPES.RUNTIME_READ);
  const runtime = useRuntimeHealth(allowed);
  if (!allowed) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Hintergrundverarbeitung {runtime.data ? <Badge tone={STATUS_TONE[runtime.data.status]}>{STATUS_LABEL[runtime.data.status]}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {runtime.isLoading ? <p className="text-sm text-slate-600">Wird gemessen …</p> : null}
        {runtime.isError ? <p role="alert" className="text-sm text-red-700">{platformErrorMessage(runtime.error, 'Der Zustand der Hintergrundverarbeitung konnte nicht gemessen werden.')}</p> : null}
        {runtime.data ? (
          <>
            <ul className="divide-y divide-slate-100 text-sm">
              {runtime.data.queues.map((q) => (
                <li key={q.name} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium text-slate-900">{QUEUE_LABELS[q.name] ?? 'Weitere Warteschlange'}</div>
                    <div className="text-xs text-slate-500">
                      {q.workers} {q.workers === 1 ? 'Worker' : 'Worker'} verbunden · {q.waiting} wartend · {q.active} in Arbeit · {q.delayed} zeitversetzt · {q.failed} fehlgeschlagen im Verlauf
                    </div>
                    {q.note ? <div className="mt-1 text-xs text-slate-700">{q.note}</div> : null}
                  </div>
                  <Badge tone={STATUS_TONE[q.status]}>{STATUS_LABEL[q.status]}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Gemessen {formatDateTime(runtime.data.checkedAt)}; aktualisiert sich alle 15 Sekunden.</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

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
      <RuntimeCard />
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
