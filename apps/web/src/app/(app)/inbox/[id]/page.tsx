'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Paperclip } from 'lucide-react';
import { caseTabHref } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { ExecutionModeBadge, LastUpdated, Notice, PageHeader, RelatedObjects, StatusBadge } from '../../../../components/common/primitives';
import { useInboxItem } from '../../../../lib/hooks/use-ui-projections';
import { formatDateTime } from '../../../../lib/format';

const STAGE_TONE = { ATTENTION: 'warning', NEW: 'info', IN_PROGRESS: 'info', DONE: 'success' } as const;

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * Eingangsdetail (UI v2 §11.2): Quelle und Originalkommunikation, Anhänge, fachliche Einordnung, zugeordneter Vorgang, relevante
 * Fakten mit Herkunft und der aktuelle Bearbeitungsstand. Für Eingänge ohne Vorgang steht „Aktion: Keine“ samt Begründung da –
 * es wird keine Prozessgrafik erfunden.
 */
export default function InboxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useInboxItem(id);

  const back = (
    <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      <ArrowLeft size={14} aria-hidden="true" /> Zurück zum Posteingang
    </button>
  );

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-3">
        {back}
        {notFound ? (
          <Notice tone="warning">Dieser Eingang existiert nicht mehr oder Sie haben keinen Zugriff darauf.</Notice>
        ) : (
          <ErrorState message={errorMessage(error, 'Der Eingang konnte nicht geladen werden.')} onRetry={() => void refetch()} />
        )}
        <Link href="/inbox" className="text-sm font-medium text-brand hover:underline">
          Zur Liste
        </Link>
      </div>
    );
  }

  const nextActionHref = data.caseRef ? (data.hasProcess ? caseTabHref(data.caseRef.id, 'orchestration') : data.caseRef.href) : undefined;
  return (
    <div className="space-y-4">
      {back}
      <PageHeader
        title={data.subject}
        description={`${data.senderLabel} · ${formatDateTime(data.occurredAt)}`}
        actions={
          nextActionHref ? (
            <Link href={nextActionHref} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90">
              {data.hasProcess ? 'Orchestrierung anzeigen' : 'Vorgang ansehen'}
            </Link>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={STAGE_TONE[data.stage]}>{data.statusLabel}</StatusBadge>
          <span className="text-sm text-slate-700">Nächster Schritt: {data.nextActionLabel}</span>
          <LastUpdated at={new Date(dataUpdatedAt).toISOString()} />
        </div>
      </PageHeader>

      {data.actionStatement ? <Notice tone="info">{data.actionStatement}{data.reason ? ` Begründung: ${data.reason}` : ''}</Notice> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          <Card title="Originalkommunikation">
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-600">Quelle</dt>
              <dd>E-Mail</dd>
              <dt className="text-slate-600">Von</dt>
              <dd className="break-all">{data.senderAddress ?? data.senderLabel}</dd>
              {data.recipients.length > 0 ? (
                <>
                  <dt className="text-slate-600">An</dt>
                  <dd className="break-all">{data.recipients.join(', ')}</dd>
                </>
              ) : null}
            </dl>
            {data.bodyPreview ? (
              <div className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-900">{data.bodyPreview}</div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Der Nachrichtentext ist nicht gespeichert oder nicht mehr verfügbar.</p>
            )}
            {data.attachments.length > 0 ? (
              <ul className="mt-3 space-y-1" aria-label="Anhänge">
                {data.attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center gap-2 text-sm text-slate-800">
                    <Paperclip size={14} aria-hidden="true" /> <span className="truncate">{attachment.name}</span>
                    <span className="shrink-0 text-xs text-slate-600">{formatSize(attachment.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {data.facts.length > 0 ? (
            <Card title="Erkannte Angaben">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Aus der Nachricht erkannte Angaben mit Herkunft</caption>
                <thead className="text-xs text-slate-700">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Angabe
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Wert
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Stand
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.facts.map((fact) => (
                    <tr key={fact.key}>
                      <td className="py-2 pr-3 text-slate-800">{fact.label}</td>
                      <td className="py-2 pr-3 font-medium text-slate-900">{fact.valueText}</td>
                      <td className="py-2">
                        <StatusBadge tone={fact.confirmed ? 'success' : 'warning'} title={`Quelle: ${fact.sourceLabel}`}>
                          {fact.confirmed ? 'Bestätigt' : 'Noch zu prüfen'}
                        </StatusBadge>
                        <span className="ml-2 text-xs text-slate-600">{fact.sourceLabel}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <Card title="Fachliche Einordnung">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-slate-600">Typ</dt>
              <dd className="text-slate-900">{data.typeLabel}</dd>
              {data.details.relevanceLabel ? (
                <>
                  <dt className="text-slate-600">Relevanz</dt>
                  <dd className="text-slate-900">{data.details.relevanceLabel}</dd>
                </>
              ) : null}
              {data.reason && !data.actionStatement ? (
                <>
                  <dt className="text-slate-600">Begründung</dt>
                  <dd className="text-slate-900">{data.reason}</dd>
                </>
              ) : null}
              {data.details.executionMode ? (
                <>
                  <dt className="text-slate-600">Einstufung durch</dt>
                  <dd>
                    <ExecutionModeBadge mode={data.details.executionMode} />
                  </dd>
                </>
              ) : null}
            </dl>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-brand">Technische Details</summary>
              <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-slate-700">
                <dt>Eingang-ID</dt>
                <dd className="break-all">{data.id}</dd>
                {data.categoryKey ? (
                  <>
                    <dt>Kategorie</dt>
                    <dd className="break-all">{data.categoryKey}</dd>
                  </>
                ) : null}
                {data.details.agentLabel ? (
                  <>
                    <dt>Assistent</dt>
                    <dd>{data.details.agentLabel}</dd>
                  </>
                ) : null}
                {data.details.confidence !== undefined ? (
                  <>
                    <dt>Sicherheit</dt>
                    <dd>{Math.round(data.details.confidence * 100)} %</dd>
                  </>
                ) : null}
              </dl>
            </details>
          </Card>

          <RelatedObjects items={[{ label: 'Vorgang', entity: data.caseRef }, ...(data.caseRef ? [] : [{ label: 'Vorgang', text: 'Kein Vorgang angelegt' }])]} />
        </div>
      </div>
    </div>
  );
}
