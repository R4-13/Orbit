'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox as InboxIcon,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, DonutChart, TrendBarChart } from '@orbit/ui';
import { useAuth } from '../../../lib/auth-context';
import { formatDateTime } from '../../../lib/format';
import { statusLabel } from '../../../lib/status-labels';
import { useAgentRuns } from '../../../lib/hooks/use-agent-runs';
import { useApprovals } from '../../../lib/hooks/use-approvals';
import { useCases } from '../../../lib/hooks/use-cases';
import { useCompanies } from '../../../lib/hooks/use-companies';
import { useContacts } from '../../../lib/hooks/use-contacts';
import { useEmailMessages } from '../../../lib/hooks/use-email-messages';
import { useInvoices } from '../../../lib/hooks/use-invoices';
import { useLeads } from '../../../lib/hooks/use-leads';
import { useTasks } from '../../../lib/hooks/use-tasks';

/**
 * §8-14 der UI/UX-Spezifikation ("Home dashboard — exact composition").
 * Jede Kennzahl wird aus den bereits vorhandenen, ganz normalen List-
 * Endpunkten client-seitig aggregiert (React Query dedupliziert
 * gleiche Queries automatisch über alle Karten hinweg) — bewusst kein
 * neuer, eigener `/dashboard/summary`-Aggregations-Endpunkt in dieser
 * Phase (siehe docs/ASSUMPTIONS.md). Für größere Datenmengen wäre eine
 * echte Server-Aggregation der nächste Schritt; für die aktuelle
 * Demo-Datengröße ist Client-Aggregation korrekt und einfach.
 */

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition hover:border-brand hover:shadow-md">
        <CardContent className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Icon size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-0.5 text-2xl font-semibold text-slate-900">{value}</p>
            {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: cases } = useCases();
  const { data: agentRuns, isLoading: agentRunsLoading } = useAgentRuns();
  const { data: pendingApprovals, isLoading: approvalsLoading } = useApprovals('PENDING');
  const { data: invoices } = useInvoices();
  const { data: leads } = useLeads();
  const { data: contacts } = useContacts();
  const { data: companies } = useCompanies();
  const { data: tasks } = useTasks();
  const { data: emails, isLoading: emailsLoading } = useEmailMessages();

  const completedRuns = agentRuns?.filter((r) => r.status === 'COMPLETED').length ?? 0;
  const failedRuns = agentRuns?.filter((r) => r.status === 'FAILED').length ?? 0;
  const totalRuns = agentRuns?.length ?? 0;
  const automationRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
  // Grobe, konfigurierbare Schätzung (§9 der UI-Spec erlaubt das ausdrücklich:
  // "Time-saving figures are configurable estimates, not guaranteed savings")
  // — 4 Minuten pro automatisch abgeschlossenem Agent-Lauf, keine gemessene Größe.
  const estimatedHoursSaved = ((completedRuns * 4) / 60).toFixed(1);

  const duplicateInvoices = invoices?.filter((i) => i.status === 'DUPLICATE_SUSPECTED').length ?? 0;
  const bankChangeWarnings = invoices?.filter((i) => i.status === 'BANK_CHANGE_SUSPECTED').length ?? 0;
  const pendingInvoiceApprovals = invoices?.filter((i) => i.status === 'PENDING_APPROVAL').length ?? 0;

  const openTasks = tasks?.filter((t) => t.status === 'OPEN').length ?? 0;

  // Grouped (not raw per-enum-value) so the donut stays readable — four
  // buckets instead of nine raw InvoiceStatus values.
  const invoiceStatusSegments = [
    {
      label: 'Offen',
      value: invoices?.filter((i) => i.status === 'RECEIVED' || i.status === 'EXTRACTED' || i.status === 'PENDING_APPROVAL').length ?? 0,
      colorVar: '--status-info',
    },
    {
      label: 'Prüfung nötig',
      value: invoices?.filter((i) => i.status === 'DUPLICATE_SUSPECTED' || i.status === 'BANK_CHANGE_SUSPECTED').length ?? 0,
      colorVar: '--status-warning',
    },
    {
      label: 'Abgeschlossen',
      value: invoices?.filter((i) => i.status === 'APPROVED' || i.status === 'TRANSFERRED').length ?? 0,
      colorVar: '--status-success',
    },
    {
      label: 'Abgelehnt/Fehler',
      value: invoices?.filter((i) => i.status === 'REJECTED' || i.status === 'TRANSFER_FAILED').length ?? 0,
      colorVar: '--status-error',
    },
  ];

  const leadStatusSegments = [
    { label: 'Neu', value: leads?.filter((l) => l.status === 'NEW').length ?? 0, colorVar: '--status-info' },
    { label: 'Qualifiziert', value: leads?.filter((l) => l.status === 'QUALIFIED').length ?? 0, colorVar: '--status-warning' },
    { label: 'Konvertiert', value: leads?.filter((l) => l.status === 'CONVERTED').length ?? 0, colorVar: '--status-success' },
    { label: 'Disqualifiziert', value: leads?.filter((l) => l.status === 'DISQUALIFIED').length ?? 0, colorVar: '--status-error' },
  ];

  // Last 7 calendar days (oldest first), completed vs. failed agent runs per day.
  const runsPerDay = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const dayKey = date.toISOString().slice(0, 10);
    const label = date.toLocaleDateString('de-DE', { weekday: 'short' });
    const dayRuns = (agentRuns ?? []).filter((r) => new Date(r.startedAt).toISOString().slice(0, 10) === dayKey);
    return {
      label,
      values: {
        completed: dayRuns.filter((r) => r.status === 'COMPLETED').length,
        failed: dayRuns.filter((r) => r.status === 'FAILED').length,
      },
    };
  });

  const recentEmails = [...(emails ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);
  const recentRuns = [...(agentRuns ?? [])]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 6);
  const recentLeads = [...(leads ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Willkommen zurück{user ? `, ${user.email}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Hier ist der aktuelle Stand Ihrer Geschäftsprozesse.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon={CheckCircle2} label="Verarbeitete Posten" value={String(cases?.length ?? '–')} href="/cases" />
        <KpiCard
          icon={Sparkles}
          label="Automatisiert"
          value={String(completedRuns)}
          sub={totalRuns > 0 ? `${automationRate}% der Läufe` : undefined}
          href="/activity"
        />
        <KpiCard
          icon={Clock}
          label="Benötigt Genehmigung"
          value={String(pendingApprovals?.length ?? '–')}
          href="/approvals"
        />
        <KpiCard icon={AlertTriangle} label="Fehlgeschlagen" value={String(failedRuns)} href="/activity" />
        <KpiCard
          icon={Sparkles}
          label="Geschätzte Zeitersparnis"
          value={`${estimatedHoursSaved} h`}
          sub="Schätzung, keine Garantie"
          href="/activity"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Unified Inbox</CardTitle>
          <Link href="/inbox" className="text-sm font-medium text-brand hover:underline">
            Alle anzeigen →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {emailsLoading ? (
            <p className="px-5 py-6 text-sm text-slate-400">Wird geladen …</p>
          ) : recentEmails.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">Keine neuen Vorgänge.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Absender</th>
                  <th className="px-4 py-2.5 font-medium">Betreff</th>
                  <th className="px-4 py-2.5 font-medium">Klassifikation</th>
                  <th className="px-4 py-2.5 font-medium">Zeitpunkt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentEmails.map((email) => (
                  <tr key={email.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700">{email.fromAddress}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-slate-900">{email.subject ?? '–'}</td>
                    <td className="px-4 py-2.5">
                      {email.classification ? <Badge tone="info">{email.classification}</Badge> : <span className="text-slate-300">–</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatDateTime(email.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Finance — Übersicht</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Rechnungen</p>
                <p className="text-xl font-semibold text-slate-900">{invoices?.length ?? '–'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Freigabe offen</p>
                <p className="text-xl font-semibold text-slate-900">{pendingInvoiceApprovals}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Dubletten</p>
                <p className="text-xl font-semibold text-slate-900">{duplicateInvoices}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Bankänderungs-Warnungen</p>
                <p className="text-xl font-semibold text-slate-900">{bankChangeWarnings}</p>
              </div>
            </div>
            {invoices && invoices.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <DonutChart segments={invoiceStatusSegments} size={88} strokeWidth={12} centerLabel={String(invoices.length)} centerSublabel="gesamt" />
              </div>
            ) : null}
            <Link href="/finance/invoices" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
              Alle Rechnungen →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales — Übersicht</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Kontakte</p>
                <p className="text-xl font-semibold text-slate-900">{contacts?.length ?? '–'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Unternehmen</p>
                <p className="text-xl font-semibold text-slate-900">{companies?.length ?? '–'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Leads</p>
                <p className="text-xl font-semibold text-slate-900">{leads?.length ?? '–'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Follow-ups</p>
                <p className="text-xl font-semibold text-slate-900">{openTasks}</p>
              </div>
            </div>
            {leads && leads.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <DonutChart segments={leadStatusSegments} size={88} strokeWidth={12} centerLabel={String(leads.length)} centerSublabel="gesamt" />
              </div>
            ) : null}
            {recentLeads.length > 0 ? (
              <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {recentLeads.map((lead) => {
                  const status = statusLabel(lead.status);
                  return (
                    <li key={lead.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{formatDateTime(lead.createdAt)}</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <Link href="/sales/leads" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
              Alle Leads →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Approvals — benötigt Ihre Aufmerksamkeit</CardTitle>
            <Link href="/approvals" className="text-sm font-medium text-brand hover:underline">
              Alle anzeigen →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {approvalsLoading ? (
              <p className="px-5 py-6 text-sm text-slate-400">Wird geladen …</p>
            ) : !pendingApprovals || pendingApprovals.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">Keine offenen Freigaben.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pendingApprovals.slice(0, 6).map((approval) => (
                  <li key={approval.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{approval.policyAction}</p>
                      {approval.reason ? <p className="truncate text-xs text-slate-500">{approval.reason}</p> : null}
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{formatDateTime(approval.requestedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Activity — zuletzt</CardTitle>
            <Link href="/activity" className="text-sm font-medium text-brand hover:underline">
              Alle anzeigen →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {agentRunsLoading ? (
              <p className="px-5 py-6 text-sm text-slate-400">Wird geladen …</p>
            ) : recentRuns.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">Noch keine Aktivität.</p>
            ) : (
              <>
                <div className="px-5 pb-1 pt-4">
                  <p className="mb-2 text-xs font-medium text-slate-500">Agent-Läufe — letzte 7 Tage</p>
                  <TrendBarChart
                    data={runsPerDay}
                    series={[
                      { key: 'completed', label: 'Abgeschlossen', colorVar: '--status-success' },
                      { key: 'failed', label: 'Fehlgeschlagen', colorVar: '--status-error' },
                    ]}
                    height={64}
                  />
                </div>
                <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
                {recentRuns.map((run) => {
                  const status = statusLabel(run.status);
                  return (
                    <li key={run.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span className="text-slate-700">{run.agentType}</span>
                      <div className="flex items-center gap-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <span className="text-xs text-slate-400">{formatDateTime(run.startedAt)}</span>
                      </div>
                    </li>
                  );
                })}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {emails && emails.length === 0 && cases && cases.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <InboxIcon size={16} /> Noch keine Vorgänge — simulieren Sie eine eingehende E-Mail unter &bdquo;Posteingang&ldquo;.
        </p>
      ) : null}
    </div>
  );
}
