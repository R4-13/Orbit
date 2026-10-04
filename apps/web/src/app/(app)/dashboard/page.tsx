'use client';

import { CASE_ORCHESTRATION_LABELS } from '@orbit/shared';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Inbox as InboxIcon,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, DonutChart, ErrorState, SegmentedBar, TrendBarChart, WorkflowTimeline } from '@orbit/ui';
import type { AgentRun, Meeting, Task } from '@orbit/domain';
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
import { useMeetings } from '../../../lib/hooks/use-meetings';
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
  const casesQuery = useCases();
  const { data: cases } = casesQuery;
  const { data: agentRuns, isLoading: agentRunsLoading, isError: agentRunsIsError, refetch: refetchAgentRuns } = useAgentRuns();
  const { data: pendingApprovals, isLoading: approvalsLoading, isError: approvalsIsError, refetch: refetchApprovals } = useApprovals('PENDING');
  const invoicesQuery = useInvoices();
  const { data: invoices } = invoicesQuery;
  const leadsQuery = useLeads();
  const { data: leads } = leadsQuery;
  const contactsQuery = useContacts();
  const { data: contacts } = contactsQuery;
  const companiesQuery = useCompanies();
  const { data: companies } = companiesQuery;
  const tasksQuery = useTasks();
  const { data: tasks } = tasksQuery;
  const meetingsQuery = useMeetings();
  const { data: meetings } = meetingsQuery;
  const { data: emails, isLoading: emailsLoading, isError: emailsIsError, refetch: refetchEmails } = useEmailMessages();

  // UI-7 ("error states") — the dashboard aggregates nine independent queries into cards that
  // already degrade gracefully per-section (missing data shows "–", not a crash); a single
  // combined banner surfaces that *something* failed without throwing away that per-card
  // resilience by rebuilding every section's own loading/empty branching around nine separate
  // error states.
  const hasLoadError =
    agentRunsIsError ||
    approvalsIsError ||
    emailsIsError ||
    casesQuery.isError ||
    invoicesQuery.isError ||
    leadsQuery.isError ||
    contactsQuery.isError ||
    companiesQuery.isError ||
    tasksQuery.isError ||
    meetingsQuery.isError;

  function retryAll() {
    void refetchAgentRuns();
    void refetchApprovals();
    void refetchEmails();
    void casesQuery.refetch();
    void invoicesQuery.refetch();
    void leadsQuery.refetch();
    void contactsQuery.refetch();
    void companiesQuery.refetch();
    void tasksQuery.refetch();
    void meetingsQuery.refetch();
  }

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

  // Real, cumulative pipeline funnel from Invoice.status — each stage's
  // filter is a strict subset of the previous one's (RECEIVED is the
  // earliest status; every later status implies "progressed past RECEIVED"),
  // so counts are guaranteed non-increasing left to right. DUPLICATE_
  // SUSPECTED/BANK_CHANGE_SUSPECTED invoices are deliberately excluded from
  // "zur Prüfung vorgelegt" — they're flagged and paused *before* reaching
  // PENDING_APPROVAL, not past it. No per-stage transition timestamp exists
  // in the schema (Invoice only has createdAt/updatedAt), so the shown
  // timestamp is honestly the most recent `updatedAt` among the invoices
  // currently counted in that stage — a real aggregate, not a fabricated
  // "exact moment this stage was reached".
  function latestUpdatedAt(list: { updatedAt: Date | string }[]): string | undefined {
    if (list.length === 0) return undefined;
    const latest = list.reduce((max, item) => (new Date(item.updatedAt).getTime() > new Date(max.updatedAt).getTime() ? item : max));
    return formatDateTime(latest.updatedAt);
  }
  const extractedOrLater = invoices?.filter((i) => i.status !== 'RECEIVED') ?? [];
  const reachedReview =
    invoices?.filter(
      (i) =>
        i.status === 'PENDING_APPROVAL' ||
        i.status === 'APPROVED' ||
        i.status === 'REJECTED' ||
        i.status === 'TRANSFERRED' ||
        i.status === 'TRANSFER_FAILED',
    ) ?? [];
  const approvedOrLater = invoices?.filter((i) => i.status === 'APPROVED' || i.status === 'TRANSFERRED' || i.status === 'TRANSFER_FAILED') ?? [];
  const transferredInvoices = invoices?.filter((i) => i.status === 'TRANSFERRED') ?? [];
  const invoicePipelineSteps = [
    { label: 'Eingang', count: invoices?.length ?? 0, timestamp: latestUpdatedAt(invoices ?? []) },
    { label: 'Extrahiert', count: extractedOrLater.length, timestamp: latestUpdatedAt(extractedOrLater) },
    { label: 'Zur Prüfung vorgelegt', count: reachedReview.length, timestamp: latestUpdatedAt(reachedReview) },
    { label: 'Genehmigt', count: approvedOrLater.length, timestamp: latestUpdatedAt(approvedOrLater) },
    { label: 'An ERP übertragen', count: transferredInvoices.length, timestamp: latestUpdatedAt(transferredInvoices) },
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

  // Joined, per-email view for the Unified Inbox table — again client-side
  // over already-loaded lists, no new endpoint. "Quelle" (source icon) is
  // deliberately NOT added as its own column: every current inbox entry
  // comes from the same EmailMessage table (one channel), so a per-row
  // source icon would always show the identical email icon — real data with
  // zero information value, not worth a column. "Zugewiesener Agent" is the
  // most recent AgentRun.agentType for the email's case (real agent-type
  // data, not a fabricated per-row assignment), labeled "Sonde-<Typ>" to
  // match the app's existing Sonde branding. "Menschl. Aktion" is
  // deliberately the simpler "does this case have an open task" signal, not
  // a full cross-entity Approval lookup (Approval links to an Invoice/
  // BookingProposal/etc. via entityType+entityId, not to a Case directly —
  // joining through that chain for a dashboard preview row would be a much
  // larger change for a compact-card use case).
  const caseById = new Map((cases ?? []).map((c) => [c.id, c]));
  const AGENT_TYPE_LABELS: Record<string, string> = {
    ORCHESTRATOR: 'Sonde-Orchestrator',
    COMMUNICATION: 'Sonde-Kommunikation',
    FINANCE: 'Sonde-Finance',
    SALES: 'Sonde-Sales',
  };
  const latestAgentRunByCaseId = new Map<string, AgentRun>();
  for (const run of agentRuns ?? []) {
    if (!run.caseId) continue;
    const existing = latestAgentRunByCaseId.get(run.caseId);
    if (!existing || new Date(run.startedAt).getTime() > new Date(existing.startedAt).getTime()) {
      latestAgentRunByCaseId.set(run.caseId, run);
    }
  }
  const openTaskCaseIds = new Set((tasks ?? []).filter((t) => t.status === 'OPEN' && t.caseId).map((t) => t.caseId as string));
  const inboxTableRows = recentEmails.map((email) => {
    const linkedCase = email.caseId ? caseById.get(email.caseId) : undefined;
    const agentRun = email.caseId ? latestAgentRunByCaseId.get(email.caseId) : undefined;
    return {
      email,
      linkedCase,
      agentLabel: agentRun ? (AGENT_TYPE_LABELS[agentRun.agentType] ?? agentRun.agentType) : '–',
      // A case on a process needs a person when the process says so (approval, review) — not only when a task is open.
      needsHumanAction: linkedCase ? openTaskCaseIds.has(linkedCase.id) || ['WAITING_FOR_APPROVAL', 'MANUAL_REVIEW'].includes(linkedCase.orchestrationStatus) : false,
    };
  });

  const recentRuns = [...(agentRuns ?? [])]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 6);
  const recentLeads = [...(leads ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // Client-side joins across already-loaded lists (same "no new aggregation
  // endpoint for this data size" approach as the rest of this dashboard) —
  // the Lead model itself has no "next action"/"meeting" field, so these are
  // derived from real, already-existing Task/Meeting records rather than
  // invented. A lead's "next action" is its case's earliest open task
  // (Task links to Case, not directly to Lead/Contact); its "meeting" is the
  // contact's soonest non-cancelled Meeting. Both are honestly "–" when none
  // exists, never a fabricated placeholder.
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));
  const nextOpenTaskByCaseId = new Map<string, Task>();
  for (const task of tasks ?? []) {
    if (task.status !== 'OPEN' || !task.caseId) continue;
    const existing = nextOpenTaskByCaseId.get(task.caseId);
    const taskDue = task.dueDate ? new Date(task.dueDate).getTime() : Infinity;
    const existingDue = existing?.dueDate ? new Date(existing.dueDate).getTime() : Infinity;
    if (!existing || taskDue < existingDue) nextOpenTaskByCaseId.set(task.caseId, task);
  }
  const nextMeetingByContactId = new Map<string, Meeting>();
  for (const meeting of meetings ?? []) {
    if (meeting.status === 'CANCELLED' || !meeting.contactId) continue;
    const existing = nextMeetingByContactId.get(meeting.contactId);
    const scheduled = meeting.scheduledAt ? new Date(meeting.scheduledAt).getTime() : Infinity;
    const existingScheduled = existing?.scheduledAt ? new Date(existing.scheduledAt).getTime() : Infinity;
    if (!existing || scheduled < existingScheduled) nextMeetingByContactId.set(meeting.contactId, meeting);
  }
  const salesTableRows = recentLeads.map((lead) => {
    const contact = contactById.get(lead.contactId);
    const company = (lead.companyId ? companyById.get(lead.companyId) : undefined) ?? (contact?.companyId ? companyById.get(contact.companyId) : undefined);
    const nextTask = lead.caseId ? nextOpenTaskByCaseId.get(lead.caseId) : undefined;
    const nextMeeting = nextMeetingByContactId.get(lead.contactId);
    return {
      lead,
      contactName: contact ? `${contact.firstName} ${contact.lastName}` : '–',
      companyName: company?.name ?? '–',
      nextActionLabel: nextTask?.title ?? '–',
      meetingLabel: nextMeeting ? (nextMeeting.scheduledAt ? formatDateTime(nextMeeting.scheduledAt) : 'Terminvorschlag offen') : '–',
      crmSynced: Boolean(contact?.crmExternalId),
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Willkommen zurück{user ? `, ${user.email}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Hier ist der aktuelle Stand Ihrer Geschäftsprozesse.</p>
      </div>

      {hasLoadError ? (
        <ErrorState
          message="Einige Daten konnten nicht geladen werden — einzelne Kacheln zeigen daher möglicherweise unvollständige Werte."
          onRetry={retryAll}
        />
      ) : null}

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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Absender</th>
                    <th className="px-4 py-2.5 font-medium">Betreff</th>
                    <th className="px-4 py-2.5 font-medium">Klassifikation</th>
                    <th className="px-4 py-2.5 font-medium">Fall</th>
                    <th className="px-4 py-2.5 font-medium">Workflow-Status</th>
                    <th className="px-4 py-2.5 font-medium">Orchestrierung</th>
                    <th className="px-4 py-2.5 font-medium">Menschl. Aktion</th>
                    <th className="px-4 py-2.5 font-medium">Zeitpunkt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inboxTableRows.map(({ email, linkedCase, needsHumanAction }) => {
                    const caseStatus = linkedCase ? statusLabel(linkedCase.status) : null;
                    const onProcess = linkedCase ? Boolean(linkedCase.blueprintKey) || linkedCase.orchestrationStatus !== 'RECEIVED' : false;
                    return (
                      <tr key={email.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-700">{email.fromAddress}</td>
                        <td className="max-w-xs truncate px-4 py-2.5 text-slate-900">{email.subject ?? '–'}</td>
                        <td className="px-4 py-2.5">
                          {email.classification ? <Badge tone="info">{email.classification}</Badge> : <span className="text-slate-300">–</span>}
                        </td>
                        <td className="max-w-[10rem] truncate px-4 py-2.5">
                          {linkedCase ? (
                            <Link href={`/cases/${linkedCase.id}`} className="text-brand hover:underline" title={linkedCase.title}>
                              {linkedCase.title}
                            </Link>
                          ) : (
                            <span className="text-slate-300">–</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {linkedCase && onProcess ? (
                            <Badge tone={caseStatus?.tone}>{CASE_ORCHESTRATION_LABELS[linkedCase.orchestrationStatus] ?? caseStatus?.label}</Badge>
                          ) : caseStatus ? (
                            <Badge tone={caseStatus.tone}>{caseStatus.label}</Badge>
                          ) : (
                            <span className="text-slate-300">–</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {linkedCase ? (
                            <Link href={`/cases/${linkedCase.id}`} className="text-brand hover:underline" aria-label={`Orchestrierung des Vorgangs ${linkedCase.title} ansehen`}>
                              {onProcess ? 'Orchestrierung ansehen' : 'Vorgang ansehen'}
                            </Link>
                          ) : (
                            <span className="text-slate-300">–</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={needsHumanAction ? 'warning' : 'neutral'}>{needsHumanAction ? 'Ja' : 'Nein'}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatDateTime(email.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">Genehmigungsstatus</p>
                  <DonutChart segments={invoiceStatusSegments} size={88} strokeWidth={12} centerLabel={String(invoices.length)} centerSublabel="gesamt" />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">Verarbeitungs-Pipeline</p>
                  <WorkflowTimeline steps={invoicePipelineSteps} />
                </div>
              </div>
            ) : null}
            {invoices && invoices.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium text-slate-500">Nach Status</p>
                <SegmentedBar segments={invoiceStatusSegments} />
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
            {salesTableRows.length > 0 ? (
              <div className="-mx-5 mt-3 overflow-x-auto border-t border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Kontakt</th>
                      <th className="px-3 py-2.5 font-medium">Unternehmen</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Nächste Aktion</th>
                      <th className="px-3 py-2.5 font-medium">Termin</th>
                      <th className="px-3 py-2.5 text-center font-medium">CRM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {salesTableRows.map(({ lead, contactName, companyName, nextActionLabel, meetingLabel, crmSynced }) => {
                      const status = statusLabel(lead.status);
                      return (
                        <tr key={lead.id} className="hover:bg-slate-50">
                          <td className="px-5 py-2.5 text-slate-900">{contactName}</td>
                          <td className="px-3 py-2.5 text-slate-500">{companyName}</td>
                          <td className="px-3 py-2.5">
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </td>
                          <td className="max-w-[9rem] truncate px-3 py-2.5 text-slate-500" title={nextActionLabel}>
                            {nextActionLabel}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{meetingLabel}</td>
                          <td className="px-3 py-2.5 text-center" title={crmSynced ? 'Mit CRM synchronisiert' : 'Noch nicht mit CRM synchronisiert'}>
                            {crmSynced ? (
                              <RefreshCw size={14} className="inline text-[var(--status-success)]" />
                            ) : (
                              <CircleDashed size={14} className="inline text-slate-300" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
