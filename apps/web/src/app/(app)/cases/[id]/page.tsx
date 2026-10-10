'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { PERMISSIONS, categoryLabel, internalHref, type CaseTab } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { CaseAttentionNotice } from '../../../../components/common/case-attention';
import { CaseHistory } from '../../../../components/orchestration/case-history';
import { OrchestrationPanel } from '../../../../components/orchestration/orchestration-panel';
import { EmptyState, ExecutionModeBadge, LastUpdated, Notice, PageHeader, RelatedObjects, StatusBadge } from '../../../../components/common/primitives';
import { apiFetch, errorMessage } from '../../../../lib/api-client';
import { useAuth } from '../../../../lib/auth-context';
import { formatAmount, formatDateTime } from '../../../../lib/format';
import { useCase, useUpdateCaseStatus } from '../../../../lib/hooks/use-cases';
import { useOrchestration } from '../../../../lib/hooks/use-case-orchestration';
import { useActivityFeed, useCaseSummary } from '../../../../lib/hooks/use-ui-projections';
import { formatListTime } from '../../../../lib/home-format';
import { statusLabel } from '../../../../lib/status-labels';
import type { CaseStatus } from '@orbit/domain';

const STATUS_OPTIONS: CaseStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'DONE', 'CANCELLED'];
const TAB_LABELS: Record<CaseTab, string> = { overview: 'Überblick', orchestration: 'Orchestrierung', communication: 'Kommunikation', documents: 'Dokumente', history: 'Historie' };

function Card({ title, children, ariaLabel }: { title: string; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <section aria-label={ariaLabel ?? title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 text-sm text-slate-800">{children}</div>
    </section>
  );
}

/** Überblick (UI v2 §16.2): Ziel, aktueller Stand, fehlende Information, letzte bestätigte Aktion, nächste Handlung und Verknüpftes. */
function OverviewTab({ caseId, description }: { caseId: string; description: string | null }) {
  const summary = useCaseSummary(caseId);
  const graph = useOrchestration(caseId, { mode: 'COMBINED' });
  const feed = useActivityFeed({ area: 'ALL', days: 90, results: true, page: 1, caseId });
  const detail = useCase(caseId);

  const waitingNodes = graph.data?.nodes.filter((node) => node.state === 'WAITING' || node.state === 'BLOCKED') ?? [];
  const lastConfirmed = feed.data?.entries.find((entry) => entry.evidence?.confirmed || entry.kind === 'RESULT');
  const c = detail.data;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-4">
        <Card title="Worum geht es – und wo stehen wir?">
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-slate-600">Ziel</dt>
            <dd>{description ?? graph.data?.blueprint?.title ?? 'Die Anfrage wird bearbeitet.'}</dd>
            <dt className="text-slate-600">Aktueller Stand</dt>
            <dd>{summary.data ? <StatusBadge tone={summary.data.statusTone}>{summary.data.statusLabel}</StatusBadge> : '–'}</dd>
            <dt className="text-slate-600">Nächste Handlung</dt>
            <dd className="font-medium text-slate-900">{summary.data?.nextStep ?? '–'}</dd>
            <dt className="text-slate-600">Fehlende Information</dt>
            <dd>
              {waitingNodes.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4">
                  {waitingNodes.map((node) => (
                    <li key={node.id}>
                      {node.title}
                      {node.conciseReason ? ` – ${node.conciseReason}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                'Nichts fehlt.'
              )}
            </dd>
            <dt className="text-slate-600">Letzte bestätigte Aktion</dt>
            <dd>
              {lastConfirmed ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {lastConfirmed.title} · {formatListTime(lastConfirmed.at)}
                  {lastConfirmed.evidence ? <ExecutionModeBadge mode={lastConfirmed.evidence.executionMode} /> : null}
                </span>
              ) : (
                'Noch keine.'
              )}
            </dd>
          </dl>
        </Card>
        {graph.data && graph.data.attentionReasons.length > 0 ? (
          <Notice tone="warning">
            <ul className="space-y-0.5">
              {graph.data.attentionReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </div>
      <div className="min-w-0 space-y-4">
        {c ? (
          <RelatedObjects
            items={[
              ...c.invoices.map((invoice) => ({ label: 'Rechnung', entity: { type: 'INVOICE' as const, id: invoice.id, label: `${invoice.invoiceNumber ?? 'Ohne Nummer'} · ${formatAmount(invoice.amountGross, invoice.currency)}`, href: internalHref('INVOICE', invoice.id) } })),
              ...c.leads.map((lead) => ({ label: 'Interessent', entity: { type: 'LEAD' as const, id: lead.id, label: lead.notes?.split('\n')[0] ?? 'Interessent', href: internalHref('LEAD', lead.id) } })),
              ...(c.tasks.length > 0 ? [{ label: 'Aufgaben', text: `${c.tasks.filter((task) => task.status === 'OPEN').length} offen von ${c.tasks.length}` }] : []),
              ...(c.emailMessages.length > 0 ? [{ label: 'Nachrichten', text: `${c.emailMessages.length}` }] : []),
              ...(c.documents.length > 0 ? [{ label: 'Dokumente', text: `${c.documents.length}` }] : []),
            ]}
          />
        ) : null}
        {c && c.tasks.length > 0 ? (
          <Card title="Aufgaben zu diesem Vorgang">
            <ul className="space-y-1.5">
              {c.tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{task.title}</span>
                  <StatusBadge tone={task.status === 'OPEN' ? 'warning' : 'success'}>{task.status === 'OPEN' ? 'Offen' : 'Erledigt'}</StatusBadge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function CommunicationTab({ caseId }: { caseId: string }) {
  const { data: c, isLoading } = useCase(caseId);
  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (!c || c.emailMessages.length === 0) return <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><EmptyState title="Noch keine Nachrichten">Eingehende und ausgehende Nachrichten zu diesem Vorgang erscheinen hier.</EmptyState></div>;
  const sorted = [...c.emailMessages].sort((a, b) => new Date(b.receivedAt ?? b.sentAt ?? b.createdAt).getTime() - new Date(a.receivedAt ?? a.sentAt ?? a.createdAt).getTime());
  return (
    <ul className="space-y-3">
      {sorted.map((email) => (
        <li key={email.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-900">{email.subject ?? 'Ohne Betreff'}</p>
            <div className="flex items-center gap-2">
              <StatusBadge tone={email.direction === 'INBOUND' ? 'info' : email.sentAt ? 'success' : 'neutral'}>{email.direction === 'INBOUND' ? 'Eingegangen' : email.sentAt ? 'Versandt' : 'Entwurf'}</StatusBadge>
              <span className="text-xs text-slate-600">{formatDateTime(email.receivedAt ?? email.sentAt ?? email.createdAt)}</span>
            </div>
          </div>
          <p className="mt-0.5 text-xs text-slate-600">
            {email.direction === 'INBOUND' ? 'Von' : 'An'}: <span className="break-all">{email.direction === 'INBOUND' ? email.fromAddress : email.toAddresses.join(', ')}</span>
            {email.classification ? ` · ${categoryLabel(email.classification)}` : ''}
          </p>
          {email.bodyPreview ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{email.bodyPreview}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function DocumentsTab({ caseId }: { caseId: string }) {
  const { data: c, isLoading } = useCase(caseId);
  const [error, setError] = useState<string | null>(null);
  async function open(id: string) {
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/v1/documents/${id}/download-url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(errorMessage(err, 'Das Dokument konnte nicht geöffnet werden.'));
    }
  }
  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (!c || c.documents.length === 0) return <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><EmptyState title="Noch keine Dokumente">Anhänge und erzeugte Unterlagen (z. B. ein Angebot) erscheinen hier.</EmptyState></div>;
  return (
    <div className="space-y-3">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {c.documents.map((doc) => (
          <li key={doc.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-slate-900" title={doc.fileName}>
              {doc.fileName}
            </span>
            <span className="shrink-0 text-xs text-slate-600">
              {(doc.sizeBytes / 1024).toFixed(1)} KB · {formatDateTime(doc.createdAt)}
            </span>
            <button type="button" onClick={() => void open(doc.id)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-[13px] font-medium text-slate-900 hover:bg-slate-50">
              <Download size={14} aria-hidden="true" /> Öffnen
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryTab({ caseId, orchestrated }: { caseId: string; orchestrated: boolean }) {
  const { hasPermission } = useAuth();
  const { data: c } = useCase(caseId);
  const feed = useActivityFeed({ area: 'ALL', days: 90, results: false, page: 1, caseId });
  return (
    <div className="space-y-4">
      {orchestrated ? (
        <CaseHistory caseId={caseId} />
      ) : (
        <section aria-label="Ablauf" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-[15px] font-semibold text-slate-900">Ablauf</h2>
          {feed.data && feed.data.entries.length > 0 ? (
            <ol className="mt-2 divide-y divide-slate-100">
              {feed.data.entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-x-3 py-2 text-sm">
                  <span className="w-28 shrink-0 text-xs text-slate-600">{formatDateTime(entry.at)}</span>
                  <span className="min-w-0 flex-1 text-slate-900">{entry.title}</span>
                  <span className="text-xs text-slate-600">{entry.actorLabel}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Noch keine Ereignisse.</p>
          )}
        </section>
      )}
      {c && c.agentRuns.length > 0 && hasPermission(PERMISSIONS.AGENT_MANAGE) ? (
        <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Technische Diagnose ({c.agentRuns.length} Assistentenläufe)</summary>
          <ul className="mt-3 space-y-2 text-xs text-slate-700">
            {c.agentRuns.map((run) => (
              <li key={run.id} className="rounded-md border border-slate-100 p-2">
                <span className="font-medium">{run.agentType}</span> · {run.status} · {formatDateTime(run.startedAt)}
                {run.toolInvocations.length > 0 ? <span className="ml-2 text-slate-600">{run.toolInvocations.map((inv) => `${inv.toolName} (${inv.status})`).join(', ')}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { hasPermission } = useAuth();
  const { data: c, isLoading, isError, error, refetch, dataUpdatedAt } = useCase(id);
  const updateStatus = useUpdateCaseStatus(id);
  const summary = useCaseSummary(id);

  const back = (
    <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      <ArrowLeft size={14} aria-hidden="true" /> Zurück zu den Vorgängen
    </button>
  );

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !c) {
    return (
      <div className="space-y-3">
        {back}
        <ErrorState message={errorMessage(error, 'Der Vorgang konnte nicht geladen werden – er existiert nicht mehr oder Sie haben keinen Zugriff.')} onRetry={() => void refetch()} />
        <Link href="/cases" className="text-sm font-medium text-brand hover:underline">
          Zur Liste
        </Link>
      </div>
    );
  }

  const status = statusLabel(c.status);
  // Ein Vorgang auf einem Prozess wird vom Prozess gesteuert: sein Stand wird gezeigt, nie von Hand gesetzt.
  const orchestrated = Boolean(c.blueprintKey) || c.orchestrationStatus !== 'RECEIVED';
  const tabs: CaseTab[] = ['overview', ...(orchestrated ? (['orchestration'] as const) : []), 'communication', 'documents', 'history'];
  const requested = search.get('tab') as CaseTab | null;
  const activeTab: CaseTab = requested && tabs.includes(requested) ? requested : 'overview';
  const select = (tab: CaseTab) => router.replace(tab === 'overview' ? `/cases/${id}` : `/cases/${id}?tab=${tab}`, { scroll: false });

  return (
    <div className="space-y-4">
      {back}
      <PageHeader title={c.title} description={`${summary.data?.typeLabel ?? ''}${summary.data?.counterparty ? ` · ${summary.data.counterparty.label}` : ''} · angelegt ${formatDateTime(c.createdAt)}`}>
        <div className="flex flex-wrap items-center gap-3">
          {summary.data ? <StatusBadge tone={summary.data.statusTone}>{summary.data.statusLabel}</StatusBadge> : <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
          {summary.data ? <span className="text-sm text-slate-800">Nächster Schritt: {summary.data.nextStep}</span> : null}
          {summary.data?.ownerLabel ? <span className="text-sm text-slate-700">Verantwortlich: {summary.data.ownerLabel}</span> : null}
          <LastUpdated at={new Date(dataUpdatedAt).toISOString()} />
          {!orchestrated && hasPermission(PERMISSIONS.CASE_MANAGE) ? (
            <label className="flex items-center gap-2 text-sm text-slate-800">
              Status ändern
              <select
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                value={c.status}
                disabled={updateStatus.isPending}
                onChange={(event) => updateStatus.mutate(event.target.value as CaseStatus)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {statusLabel(option).label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </PageHeader>

      <CaseAttentionNotice caseId={id} />

      <div role="tablist" aria-label="Bereiche des Vorgangs" className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab}
            id={`case-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`case-panel-${tab}`}
            onClick={() => select(tab)}
            className={`-mb-px h-11 border-b-2 px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${activeTab === tab ? 'border-brand text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {TAB_LABELS[tab]}
            {tab === 'orchestration' ? <span className="sr-only"> – Ablauf und nächste Schritte</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`case-panel-${activeTab}`} aria-labelledby={`case-tab-${activeTab}`}>
        {activeTab === 'overview' ? <OverviewTab caseId={id} description={c.description} /> : null}
        {activeTab === 'orchestration' ? <OrchestrationPanel caseId={id} /> : null}
        {activeTab === 'communication' ? <CommunicationTab caseId={id} /> : null}
        {activeTab === 'documents' ? <DocumentsTab caseId={id} /> : null}
        {activeTab === 'history' ? <HistoryTab caseId={id} orchestrated={orchestrated} /> : null}
      </div>
    </div>
  );
}

export default function CaseDetailPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-600">Wird geladen …</p>}>
      <CaseDetail />
    </Suspense>
  );
}
