'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { PERMISSIONS, greeting, type DashboardMetric, type DashboardMetricKey } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { HomeCustomizeDialog } from '../../../components/home/home-customize-dialog';
import {
  AttentionRow,
  CardMessage,
  CompletedLine,
  FinanceBody,
  HomeCard,
  InboxRow,
  KpiCard,
  SalesBody,
  SeeAll,
  SkeletonRows,
  TaskLine,
} from '../../../components/home/home-cards';
import { useAuth } from '../../../lib/auth-context';
import { useDashboardSnapshot } from '../../../lib/hooks/use-dashboard-snapshot';
import { useElementSize } from '../../../lib/hooks/use-element-size';
import { useProfile } from '../../../lib/hooks/use-profile';
import { PERIOD_LABELS, formatClock, formatShortDate } from '../../../lib/home-format';
import { errorMessage } from '../../../lib/api-client';
import { homeFitsOneScreen, homeLimitsFor } from '../../../lib/shell-layout';
import { useUiPreferences } from '../../../lib/ui-preferences';
import type { HomeOptionalZone, HomePeriod, HomeView } from '../../../lib/ui-preferences-model';

const KPI_ORDER: DashboardMetricKey[] = ['processed', 'automated', 'approvalsOpen', 'problems', 'timeSaved'];

/**
 * UI/UX v2 §6: Home ist eine Arbeitsübersicht auf EINER Bildschirmseite – Aufmerksamkeit vor Datenlisten, begrenzte Vorschauen,
 * jede Zeile ein echter Link in das fachliche Detail. Die Menge der Einträge folgt der gemessenen Höhe (§6.3); mehr Daten
 * ändern Zähler und „Alle anzeigen“, nie die Seitenhöhe. Auf schmalen oder niedrigen Flächen (Tablet, Mobil, Zoom) darf die
 * Seite stattdessen vertikal scrollen (HOME-03) – nichts wird abgeschnitten.
 */
export default function DashboardPage() {
  const { hasPermission } = useAuth();
  const { data: profile } = useProfile();
  const { preferences, updateHome, resetHome } = useUiPreferences();
  const home = preferences.home;
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const [customizing, setCustomizing] = useState(false);

  const measured = size.width > 0 && size.height > 0;
  const fits = measured && homeFitsOneScreen(size.width, size.height);
  const limits = homeLimitsFor(measured ? size.height : 700);
  const roomy = measured && size.height >= 900;
  const twoUp = size.width >= 720;

  const snapshotQuery = useDashboardSnapshot({
    view: home.view,
    period: home.period,
    limits: { attention: limits.attention, inbox: limits.inbox, tasks: limits.tasks, completed: limits.completed },
  });
  const snapshot = snapshotQuery.data;
  const loading = snapshotQuery.isLoading;
  const loadFailed = snapshotQuery.isError && !snapshot;

  const now = useMemo(() => (snapshot ? new Date(snapshot.generatedAt) : new Date()), [snapshot]);

  const allowed: HomeOptionalZone[] = [
    ...(hasPermission(PERMISSIONS.EMAIL_READ) || hasPermission(PERMISSIONS.CASE_READ) ? (['inbox'] as const) : []),
    ...(hasPermission(PERMISSIONS.INVOICE_READ) ? (['finance'] as const) : []),
    ...(hasPermission(PERMISSIONS.CRM_CONTACT_READ) ? (['sales'] as const) : []),
    ...(hasPermission(PERMISSIONS.TASK_READ) ? (['tasks'] as const) : []),
    ...(hasPermission(PERMISSIONS.CASE_READ) ? (['completed'] as const) : []),
  ];
  const shown = (zone: HomeOptionalZone) => allowed.includes(zone) && !home.hidden.includes(zone);
  const showInbox = shown('inbox');
  const domainCards = home.domainOrder.filter((zone): zone is 'finance' | 'sales' => shown(zone));
  const showTasks = shown('tasks');
  const showCompleted = shown('completed');
  const nextCards = Number(showTasks) + Number(showCompleted);

  const metric = (key: DashboardMetricKey): DashboardMetric | undefined => snapshot?.metrics.find((m) => m.key === key);

  // Zeilenplan der Einbildschirm-Geometrie (§6.2): Kopf 44, KPI 80–92, Arbeit flexibel, Fachbereiche 144–160, Abschluss nach Inhalt.
  const nextLines = limits.compact ? 1 : Math.max(limits.tasks, limits.completed);
  const nextHeight = limits.compact ? 80 : Math.max(80, 48 + nextLines * 24);
  const kpiHeight = roomy ? 92 : 80;
  const domainHeight = limits.compact ? 112 : roomy ? 160 : 144;
  // Ist mehr Höhe da, werden die Listenzeilen etwas luftiger (44–64 px) statt leer zu bleiben (§6.2: der Raum bleibt geordnet).
  const fixedRows = 44 + kpiHeight + (domainCards.length > 0 ? domainHeight : 0) + (nextCards > 0 ? nextHeight : 0);
  const gapCount = 2 + Number(domainCards.length > 0) + Number(nextCards > 0);
  const workHeight = size.height - fixedRows - gapCount * 12;
  const rowHeight = fits ? Math.max(44, Math.min(64, Math.floor((workHeight - 48) / Math.max(1, limits.attention)))) : 44;
  const rowVars = { '--home-row': `${rowHeight}px` } as CSSProperties;
  const rows = [
    '44px',
    `${kpiHeight}px`,
    'minmax(176px, 1fr)',
    ...(domainCards.length > 0 ? [`${domainHeight}px`] : []),
    ...(nextCards > 0 ? [`${nextHeight}px`] : []),
  ].join(' ');

  const attentionTotal = snapshot?.attentionTotal ?? 0;
  const attentionShown = snapshot?.attentionPreview.length ?? 0;
  const stale = snapshot ? Date.now() - new Date(snapshot.generatedAt).getTime() > 3 * 60 * 1000 : false;

  const greetingText = greeting(new Date().getHours(), profile?.firstName);
  const standText = snapshot ? `Stand ${formatClock(snapshot.generatedAt)}${snapshotQuery.isFetching ? ' – wird aktualisiert' : stale ? ' – wird aktualisiert' : ''}` : loadFailed ? 'Stand unbekannt' : 'Wird geladen …';

  const workCols = showInbox && twoUp ? 'grid-cols-2' : 'grid-cols-1';
  const domainCols = domainCards.length > 1 && twoUp ? 'grid-cols-2' : 'grid-cols-1';
  const nextCols = nextCards > 1 && twoUp ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div ref={measureRef} className="h-full overflow-y-auto overflow-x-hidden" data-home-layout={fits ? 'one-screen' : 'reflow'}>
      <div style={fits ? { ...rowVars, gridTemplateRows: rows } : rowVars} className={`grid gap-3 ${fits ? 'h-full' : ''}`}>
        {/* Kompakter Seitenkopf */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-8 text-slate-900">{greetingText}</h1>
            <p className="truncate text-[13px] leading-4 text-slate-600">
              {formatShortDate(now)} · {standText}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="home-period">
              Zeitraum
            </label>
            <select
              id="home-period"
              value={home.period}
              onChange={(event) => updateHome({ period: event.target.value as HomePeriod })}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              {(Object.keys(PERIOD_LABELS) as HomePeriod[]).map((period) => (
                <option key={period} value={period}>
                  {PERIOD_LABELS[period]}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="home-view">
              Ansicht
            </label>
            <select id="home-view" value={home.view} onChange={(event) => updateHome({ view: event.target.value as HomeView })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900">
              <option value="MINE">Meine</option>
              <option value="TEAM">Team</option>
            </select>
            <button type="button" onClick={() => setCustomizing(true)} className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200/60">
              <SlidersHorizontal size={15} aria-hidden="true" /> Ansicht anpassen
            </button>
          </div>
        </div>

        {/* Fünf KPIs */}
        <div className={`grid min-w-0 gap-3 ${size.width >= 720 ? 'grid-cols-5' : size.width >= 480 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {KPI_ORDER.map((key) => (
            <div key={key} className={fits ? 'h-full min-h-0' : 'min-h-[84px]'}>
              <KpiCard metric={metric(key)} period={home.period} isLoading={loading} />
            </div>
          ))}
        </div>

        {/* Arbeit jetzt: Aufmerksamkeit + Neu im Posteingang */}
        <div className={`grid min-h-0 min-w-0 gap-3 ${workCols}`}>
          <HomeCard
            title="Benötigt Ihre Aufmerksamkeit"
            titleId="home-attention"
            action={attentionTotal > attentionShown ? <SeeAll href="/dashboard/attention">Alle {attentionTotal} anzeigen</SeeAll> : attentionTotal > 0 ? <SeeAll href="/dashboard/attention">Alle anzeigen</SeeAll> : null}
          >
            {loading ? (
              <SkeletonRows rows={Math.min(limits.attention, 3)} />
            ) : loadFailed ? (
              <div className="px-3 pb-3">
                <ErrorState message={errorMessage(snapshotQuery.error, 'Die Übersicht konnte nicht geladen werden.')} onRetry={() => void snapshotQuery.refetch()} />
              </div>
            ) : attentionShown === 0 ? (
              <CardMessage>Nichts wartet auf Sie. ORBIT meldet sich, sobald eine Entscheidung gebraucht wird.</CardMessage>
            ) : (
              <ul className="divide-y divide-slate-100">
                {snapshot?.attentionPreview.map((item) => (
                  <AttentionRow key={item.id} item={item} now={now} />
                ))}
              </ul>
            )}
          </HomeCard>

          {showInbox ? (
            <HomeCard
              title="Neu im Posteingang"
              titleId="home-inbox"
              action={snapshot && snapshot.inboxTotal > 0 ? <SeeAll href="/inbox">Alle {snapshot.inboxTotal} anzeigen</SeeAll> : <SeeAll href="/inbox">Posteingang</SeeAll>}
            >
              {loading ? (
                <SkeletonRows rows={Math.min(limits.inbox, 3)} />
              ) : loadFailed ? (
                <CardMessage tone="error">Der Posteingang konnte nicht geladen werden.</CardMessage>
              ) : (snapshot?.inboxPreview.length ?? 0) === 0 ? (
                <CardMessage>
                  Keine neuen Eingänge in den letzten {snapshot?.inboxWindowDays ?? 7} Tagen.
                  {hasPermission(PERMISSIONS.INTEGRATION_CONFIGURE) ? (
                    <>
                      {' '}
                      <Link href="/integrations" className="font-medium text-brand hover:underline">
                        Postfach verbinden
                      </Link>
                    </>
                  ) : null}
                </CardMessage>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {snapshot?.inboxPreview.map((item) => (
                    <InboxRow key={item.id} item={item} now={now} />
                  ))}
                </ul>
              )}
            </HomeCard>
          ) : null}
        </div>

        {/* Fachbereiche */}
        {domainCards.length > 0 ? (
          <div className={`grid min-h-0 min-w-0 gap-3 ${domainCols}`}>
            {domainCards.map((zone) =>
              zone === 'finance' ? (
                <HomeCard key="finance" title="Finanzen" titleId="home-finance" action={<SeeAll href="/finance/invoices">Alle Rechnungen</SeeAll>}>
                  {loading ? <SkeletonRows rows={1} rowHeight={56} /> : snapshot?.finance ? <FinanceBody data={snapshot.finance} /> : <CardMessage>Keine Daten.</CardMessage>}
                </HomeCard>
              ) : (
                <HomeCard key="sales" title="Vertrieb" titleId="home-sales" action={<SeeAll href="/sales/leads">Alle Interessenten</SeeAll>}>
                  {loading ? <SkeletonRows rows={1} rowHeight={56} /> : snapshot?.sales ? <SalesBody data={snapshot.sales} /> : <CardMessage>Keine Daten.</CardMessage>}
                </HomeCard>
              ),
            )}
          </div>
        ) : null}

        {/* Abschlusszeile */}
        {nextCards > 0 ? (
          <div className={`grid min-h-0 min-w-0 gap-3 ${nextCols}`}>
            {showTasks ? (
              <HomeCard title="Ihre nächsten Aufgaben" titleId="home-tasks" action={<SeeAll href="/tasks">{snapshot ? `Alle ${snapshot.tasksTotal}` : 'Alle'} anzeigen</SeeAll>}>
                {loading ? (
                  <SkeletonRows rows={1} rowHeight={24} />
                ) : limits.compact ? (
                  <CardMessage>{snapshot?.tasksTotal ?? 0} offene Aufgaben</CardMessage>
                ) : (snapshot?.tasksPreview.length ?? 0) === 0 ? (
                  <CardMessage>Keine offenen Aufgaben.</CardMessage>
                ) : (
                  <ul>
                    {snapshot?.tasksPreview.map((task) => (
                      <TaskLine key={task.id} task={task} now={now} />
                    ))}
                  </ul>
                )}
              </HomeCard>
            ) : null}
            {showCompleted ? (
              <HomeCard title="Zuletzt erledigt" titleId="home-completed" action={<SeeAll href="/activity">Aktivitäten</SeeAll>}>
                {loading ? (
                  <SkeletonRows rows={1} rowHeight={24} />
                ) : limits.compact ? (
                  <CardMessage>{snapshot?.completedPreview.length ?? 0} bestätigte Ergebnisse</CardMessage>
                ) : (snapshot?.completedPreview.length ?? 0) === 0 ? (
                  <CardMessage>Noch nichts mit bestätigtem Ergebnis.</CardMessage>
                ) : (
                  <ul>
                    {snapshot?.completedPreview.map((entry) => (
                      <CompletedLine key={entry.id} item={entry} now={now} />
                    ))}
                  </ul>
                )}
              </HomeCard>
            ) : null}
          </div>
        ) : null}
      </div>

      {customizing ? (
        <HomeCustomizeDialog
          value={home}
          allowed={allowed}
          onChange={updateHome}
          onReset={resetHome}
          onClose={() => setCustomizing(false)}
        />
      ) : null}
    </div>
  );
}
