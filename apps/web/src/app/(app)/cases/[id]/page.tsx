'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { CaseStatus } from '@orbit/domain';
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { CaseHistory } from '../../../../components/orchestration/case-history';
import { OrchestrationPanel } from '../../../../components/orchestration/orchestration-panel';
import { errorMessage } from '../../../../lib/api-client';
import { formatAmount, formatDateTime } from '../../../../lib/format';
import { useCase, useUpdateCaseStatus } from '../../../../lib/hooks/use-cases';
import { caseTypeLabel, statusLabel } from '../../../../lib/status-labels';

const STATUS_OPTIONS: CaseStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'DONE', 'CANCELLED'];

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, isLoading, isError, error, refetch } = useCase(id);
  const updateStatus = useUpdateCaseStatus(id);
  const [tab, setTab] = useState<'orchestration' | 'overview' | 'history' | null>(null);

  if (isLoading) {
    return <p className="text-sm text-slate-500">Wird geladen …</p>;
  }
  if (isError) {
    return <ErrorState message={errorMessage(error, 'Der Vorgang konnte nicht geladen werden.')} onRetry={() => void refetch()} />;
  }
  if (!c) {
    return <p className="text-sm text-slate-500">Vorgang nicht gefunden.</p>;
  }

  const status = statusLabel(c.status);
  // A case that runs on a process is steered by the process: its state is shown, never set by hand.
  const orchestrated = Boolean(c.blueprintKey) || c.orchestrationStatus !== 'RECEIVED';
  const activeTab = tab ?? (orchestrated ? 'orchestration' : 'overview');
  const TABS = [
    ...(orchestrated ? ([['orchestration', 'Orchestrierung']] as const) : []),
    ['overview', 'Übersicht & Dokumente'] as const,
    ...(orchestrated ? ([['history', 'Historie']] as const) : []),
  ];

  return (
    <div className={`mx-auto space-y-6 ${orchestrated ? 'max-w-7xl' : 'max-w-4xl'}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {caseTypeLabel(c.type)}
          </p>
          <h1 className="text-xl font-semibold text-slate-900">{c.title}</h1>
          {c.description ? <p className="mt-1 text-sm text-slate-500">{c.description}</p> : null}
          <p className="mt-1 text-xs text-slate-400">Erstellt {formatDateTime(c.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {orchestrated ? null : <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            value={c.status}
            disabled={updateStatus.isPending}
            onChange={(event) => updateStatus.mutate(event.target.value as CaseStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option).label}
              </option>
            ))}
          </select>}
        </div>
      </div>

      {TABS.length > 1 ? (
        <div role="tablist" aria-label="Bereiche des Vorgangs" className="flex gap-1 border-b border-slate-200">
          {TABS.map(([id2, label]) => (
            <button
              key={id2}
              type="button"
              role="tab"
              aria-selected={activeTab === id2}
              onClick={() => setTab(id2)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${activeTab === id2 ? 'border-brand text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === 'orchestration' ? <OrchestrationPanel caseId={id} /> : null}
      {activeTab === 'history' ? <CaseHistory caseId={id} /> : null}

      {activeTab === 'overview' ? (
        <>

      {c.emailMessages.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>E-Mail-Verlauf</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {c.emailMessages.map((email) => (
              <div key={email.id} className="rounded-md border border-slate-100 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{email.subject ?? '(ohne Betreff)'}</span>
                  <span className="text-xs text-slate-400">{formatDateTime(email.receivedAt ?? email.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {email.direction === 'INBOUND' ? 'Von' : 'An'}: {email.direction === 'INBOUND' ? email.fromAddress : email.toAddresses.join(', ')}
                </p>
                {email.bodyPreview ? <p className="mt-2 text-slate-600">{email.bodyPreview}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {c.invoices.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Rechnungen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.invoices.map((invoice) => {
              const invoiceStatus = statusLabel(invoice.status);
              return (
                <div key={invoice.id} className="flex items-center justify-between text-sm">
                  <Link href={`/finance/invoices/${invoice.id}`} className="font-medium text-brand hover:underline">
                    {invoice.invoiceNumber ?? '(ohne Nummer)'}
                  </Link>
                  <span className="text-slate-600">{formatAmount(invoice.amountGross, invoice.currency)}</span>
                  <Badge tone={invoiceStatus.tone}>{invoiceStatus.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {c.leads.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Leads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.leads.map((lead) => {
              const leadStatus = statusLabel(lead.status);
              return (
                <div key={lead.id} className="flex items-center justify-between text-sm">
                  <Link href={`/sales/leads/${lead.id}`} className="font-medium text-brand hover:underline">
                    {lead.notes ?? lead.id}
                  </Link>
                  <Badge tone={leadStatus.tone}>{leadStatus.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {c.documents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dokumente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{doc.fileName}</span>
                <span className="text-xs text-slate-400">
                  {(doc.sizeBytes / 1024).toFixed(1)} KB · {formatDateTime(doc.createdAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {c.tasks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aufgaben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.tasks.map((task) => {
              const taskStatus = statusLabel(task.status);
              return (
                <div key={task.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{task.title}</span>
                  <Badge tone={taskStatus.tone}>{taskStatus.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {c.agentRuns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Agent-Läufe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {c.agentRuns.map((run) => {
              const runStatus = statusLabel(run.status);
              return (
                <div key={run.id} className="rounded-md border border-slate-100 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">{run.agentType}</span>
                    <Badge tone={runStatus.tone}>{runStatus.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(run.startedAt)}</p>
                  {run.toolInvocations.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {run.toolInvocations.map((inv) => (
                        <li key={inv.id} className="flex items-center justify-between">
                          <span>{inv.toolName}</span>
                          <span className="text-slate-400">{inv.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
        </>
      ) : null}
    </div>
  );
}
