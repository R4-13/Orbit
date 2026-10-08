'use client';

import { PLATFORM_SCOPES, backlogAttention } from '@orbit/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { formatDateTime } from '../../lib/format';
import { usePlatformAuth } from '../../lib/platform/platform-auth';
import { platformErrorMessage } from '../../lib/platform/platform-client';
import { tenantStatusLabel } from '../../lib/platform/tenant-labels';
import { useRuntimeHealth, usePlatformOverview, useWorkBacklog } from '../../lib/platform/use-platform-data';


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

/** Arbeitsstand: Warten und Wiederholen sind Normalbetrieb und stehen nur als Zahl da; Aufmerksamkeit braucht, was nicht von selbst weitergeht. */
function WorkBacklogCard() {
  const { hasScope } = usePlatformAuth();
  const allowed = hasScope(PLATFORM_SCOPES.RUNTIME_READ);
  const work = useWorkBacklog(allowed);
  if (!allowed) return null;
  const attention = work.data ? backlogAttention(work.data) : [];
  const rows: Array<[string, number, string]> = work.data
    ? [
        ['Erwartungen offen', work.data.openWaits, `${work.data.overdueWaits} mit überschrittener Frist`],
        ['Wiederholungen geplant', work.data.scheduledRetries, `${work.data.dueRetries} fällig`],
        ['Vorgänge in manueller Prüfung', work.data.casesInReview, ''],
        ['Fehlgeschlagene Schritte (24 h)', work.data.failedSteps24h, ''],
      ]
    : [];
  return (
    <Card data-testid="work-backlog">
      <CardHeader>
        <CardTitle>
          Arbeitsstand {work.data ? <Badge tone={attention.length > 0 ? 'warning' : 'success'}>{attention.length > 0 ? 'Braucht Aufmerksamkeit' : 'Nichts hängt'}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {work.isLoading ? <p className="text-sm text-slate-600">Wird gemessen …</p> : null}
        {work.isError ? <p role="alert" className="text-sm text-red-700">{platformErrorMessage(work.error, 'Der Arbeitsstand konnte nicht gemessen werden.')}</p> : null}
        {work.data ? (
          <>
            {attention.length > 0 ? (
              <ul role="alert" className="mb-3 space-y-1 text-sm text-amber-900">
                {attention.map((a) => (
                  <li key={a.code}>{a.message}</li>
                ))}
              </ul>
            ) : null}
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {rows.map(([label, value, hint]) => (
                <div key={label}>
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="text-xl font-semibold text-slate-900">{value}</dd>
                  {hint ? <dd className="text-xs text-slate-500">{hint}</dd> : null}
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-slate-500">Nur Zähler über alle Mandanten; Einzelfälle finden Sie über die Kennungssuche in der Diagnose. Gemessen {formatDateTime(work.data.checkedAt)}.</p>
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
      <WorkBacklogCard />
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
