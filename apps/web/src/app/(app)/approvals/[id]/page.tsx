'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { ErrorState } from '@orbit/ui';
import { NodeDetailPanel } from '../../../../components/orchestration/node-detail-panel';
import { EntityLink, LastUpdated, Notice, PageHeader, RelatedObjects, StatusBadge } from '../../../../components/common/primitives';
import { ApiError, apiFetch, errorMessage } from '../../../../lib/api-client';
import { useApprovalDetail } from '../../../../lib/hooks/use-ui-projections';
import { formatDateTime } from '../../../../lib/format';

function Block({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={question}>
      <h2 className="text-[15px] font-semibold text-slate-900">{question}</h2>
      <div className="mt-2 text-sm text-slate-800">{children}</div>
    </section>
  );
}

/**
 * Entscheidungsdetail (UI v2 §14.2): Was wird getan? Für wen? Mit welchen Daten? In welches System? Warum braucht es meine
 * Freigabe? Was passiert danach? Erst dann die Entscheidung – und „Genehmigt“ wird erst nach der Bestätigung des Servers
 * gemeldet. Bei vorbereiteten externen Wirkungen läuft die Entscheidung über die Orchestrierung des Vorgangs mit der an die
 * Nutzlast gebundenen Freigabe; eine ersetzte Freigabe ist nicht mehr entscheidbar.
 */
export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useApprovalDetail(id);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [result, setResult] = useState<{ tone: 'info' | 'warning' | 'danger'; text: string } | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: 'approve' | 'reject') => {
      const path = data?.decision.endpoints?.[decision];
      if (!path) throw new Error('Für diese Freigabe ist keine Entscheidung in dieser Ansicht vorgesehen.');
      await apiFetch(path, { method: 'PATCH' });
      return decision;
    },
    onSuccess: async (decision) => {
      setConfirmingReject(false);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['approvals'] }), queryClient.invalidateQueries({ queryKey: ['invoices'] }), queryClient.invalidateQueries({ queryKey: ['suppliers'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
      setResult({ tone: 'info', text: decision === 'approve' ? 'Genehmigt. Die Ausführung folgt; den Nachweis sehen Sie am Objekt.' : 'Abgelehnt. Es wurde nichts ausgeführt.' });
    },
    onError: (err) => setResult({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Die Entscheidung konnte nicht gespeichert werden. Es wurde nichts verändert.' }),
  });

  const back = (
    <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      <ArrowLeft size={14} aria-hidden="true" /> Zurück zu den Freigaben
    </button>
  );

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-3">
        {back}
        {notFound ? <Notice tone="warning">Diese Freigabe existiert nicht mehr oder Sie haben keinen Zugriff darauf.</Notice> : <ErrorState message={errorMessage(error, 'Die Freigabe konnte nicht geladen werden.')} onRetry={() => void refetch()} />}
        <Link href="/approvals" className="text-sm font-medium text-brand hover:underline">
          Zur Liste
        </Link>
      </div>
    );
  }

  const pending = data.status === 'PENDING';
  const entityDecision = data.decision.mode === 'ENTITY' || data.decision.mode === 'FOLLOW_UP';

  return (
    <div className="space-y-4">
      {back}
      <PageHeader title={data.actionLabel} description={data.subtitle}>
        <div className="flex flex-wrap items-center gap-3">
          {data.status === 'PENDING' ? <StatusBadge tone={data.risk === 'CRITICAL' ? 'danger' : 'warning'}>{data.risk === 'CRITICAL' ? 'Kritisch prüfen' : 'Freigabe erforderlich'}</StatusBadge> : <StatusBadge tone={data.status === 'APPROVED' ? 'success' : 'danger'}>{data.status === 'APPROVED' ? 'Genehmigt' : 'Abgelehnt'}</StatusBadge>}
          <span className="text-sm text-slate-700">Angefordert {formatDateTime(data.requestedAt)}{data.decidedAt ? ` · Entschieden ${formatDateTime(data.decidedAt)}` : ''}</span>
          <LastUpdated at={new Date(dataUpdatedAt).toISOString()} />
        </div>
      </PageHeader>

      {data.risk === 'CRITICAL' && pending ? <Notice tone="danger">{data.reason}</Notice> : null}
      {data.stale || data.cannotDecideReason ? <Notice tone="warning">{data.cannotDecideReason ?? 'Diese Freigabe wurde durch eine Änderung ersetzt. Bitte aktuelle Version prüfen.'}</Notice> : null}
      {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          <Block question="Was wird getan – mit welchen Angaben?">
            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
              {data.fields.map((field) => (
                <div key={field.label} className="contents">
                  <dt className="text-slate-600">{field.label}</dt>
                  <dd className={`min-w-0 whitespace-pre-wrap break-words ${field.emphasis ? 'font-semibold text-red-800' : 'text-slate-900'}`}>{field.value}</dd>
                </div>
              ))}
            </dl>
          </Block>

          {data.processAction ? (
            <Block question="Genau diese Fassung wird freigegeben">
              <p className="mb-3 text-slate-700">Die Freigabe ist an den hier gezeigten Inhalt gebunden. Wird er geändert, braucht es eine neue Freigabe.</p>
              <NodeDetailPanel caseId={data.processAction.caseId} nodeId={data.processAction.nodeId} />
            </Block>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {data.forWhom ? (
            <Block question="Für wen?">
              <EntityLink entity={data.forWhom} />
            </Block>
          ) : null}
          <Block question="In welches System?">{data.targetSystem}</Block>
          <Block question="Warum ist Ihre Freigabe nötig?">{data.whyRequired}</Block>
          <Block question="Was passiert danach?">{data.afterwards}</Block>
          <RelatedObjects items={data.related.map((entity) => ({ label: entity.type === 'CASE' ? 'Vorgang' : entity.type === 'INVOICE' ? 'Rechnung' : entity.type === 'SUPPLIER' ? 'Lieferant' : 'Objekt', entity }))} />
        </div>
      </div>

      {pending && entityDecision ? (
        <div className="sticky bottom-0 -mx-1 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {confirmingReject ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-800">Wirklich ablehnen? Es wird nichts ausgeführt.</p>
              <button type="button" onClick={() => decide.mutate('reject')} disabled={decide.isPending} className="h-10 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                Ja, ablehnen
              </button>
              <button type="button" onClick={() => setConfirmingReject(false)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
                Abbrechen
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => decide.mutate('approve')}
                disabled={!data.canDecide || decide.isPending}
                className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
              >
                {decide.isPending ? 'Wird gespeichert …' : data.decision.approveLabel}
              </button>
              <button type="button" onClick={() => setConfirmingReject(true)} disabled={!data.canDecide || decide.isPending} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                {data.decision.rejectLabel}
              </button>
              {!data.canDecide ? <span className="text-sm text-slate-700">Sie haben für diese Entscheidung keine Berechtigung.</span> : null}
            </div>
          )}
        </div>
      ) : null}
      {pending && data.decision.mode === 'PROCESS_ACTION' ? (
        <Notice tone="info">Die Entscheidung treffen Sie im Block „Genau diese Fassung wird freigegeben“ – dort stehen nur die Aktionen, die der Server für Sie zulässt.</Notice>
      ) : null}
    </div>
  );
}
