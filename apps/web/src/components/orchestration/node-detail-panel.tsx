'use client';

import type { CaseNodeDetail } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { useNodeDetail } from '../../lib/hooks/use-case-orchestration';
import { ActionButtons, PreviewBlock } from './action-controls';
import { ExecutionModeTag, StateChip } from './state-chip';

const FACT_STATUS_LABELS: Record<string, string> = { CONFIRMED: 'bestätigt', CANDIDATE: 'unbestätigt', CONFLICTED: 'widersprüchlich', STALE: 'veraltet', REJECTED: 'verworfen' };
const SOURCE_LABELS: Record<string, string> = { EMAIL: 'E-Mail', ATTACHMENT: 'Anhang', SYSTEM_OF_RECORD: 'Quellsystem', CONFIGURATION: 'Konfiguration', HUMAN: 'Mensch' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null) return '–';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Node details (§16.6): business wording first — what it is, why it is in this state, what it used, what it produced. */
export function NodeDetailPanel({ caseId, nodeId, planRevision, onClose }: { caseId: string; nodeId: string; planRevision?: number; onClose?: () => void }) {
  const { data, isLoading, isError, error, refetch } = useNodeDetail(caseId, nodeId, planRevision);

  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label="Details zum ausgewählten Schritt">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{data?.title ?? 'Schritt'}</h2>
        {onClose ? (
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" aria-label="Details schließen">
            ✕
          </button>
        ) : null}
      </div>
      {isLoading ? <p className="mt-3 text-sm text-slate-600">Wird geladen …</p> : null}
      {isError ? <ErrorState className="mt-3" message={errorMessage(error, 'Die Details konnten nicht geladen werden.')} onRetry={() => void refetch()} /> : null}
      {data ? <Body detail={data} caseId={caseId} /> : null}
    </aside>
  );
}

function Body({ detail, caseId }: { detail: CaseNodeDetail; caseId: string }) {
  return (
    <div className="mt-3 space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StateChip state={detail.state} />
        <ExecutionModeTag mode={detail.executionMode} />
        {detail.attempts > 1 ? <span className="text-xs text-slate-600">{detail.attempts}. Versuch</span> : null}
      </div>
      <p className="text-slate-700">{detail.stateExplanation}</p>
      {detail.purpose ? <p className="text-slate-600">{detail.purpose}</p> : null}

      <ActionButtons caseId={caseId} actions={detail.availableActions} preview={detail.preview} />

      {detail.preview && !detail.availableActions.some((a) => a.requiresPreview) ? (
        <Section title="Inhalt">
          <PreviewBlock preview={detail.preview} />
        </Section>
      ) : null}

      {detail.capability ? (
        <Section title="Fähigkeit">
          <p className="text-slate-700">{detail.capability.description}</p>
          <p className="mt-0.5 text-xs text-slate-600">{detail.capability.sideEffect === 'EXTERNAL_WRITE' ? 'Wirkt nach außen' : detail.capability.sideEffect === 'INTERNAL_WRITE' ? 'Schreibt intern' : 'Nur lesend'}</p>
        </Section>
      ) : null}

      {detail.error ? (
        <Section title="Fehler">
          <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">
            {detail.error.message || 'Der Schritt konnte nicht abgeschlossen werden.'} <span className="text-xs text-red-600">({detail.error.code})</span>
          </p>
        </Section>
      ) : null}

      {detail.action ? (
        <Section title="Ausführung und Nachweis">
          <p className="text-slate-700">
            Aktion {detail.action.purpose ? `(${detail.action.purpose === 'CLARIFICATION' ? 'Rückfrage' : detail.action.purpose === 'QUOTE_DELIVERY' ? 'Angebotsversand' : detail.action.purpose})` : ''}: {detail.action.status}
          </p>
          {detail.action.receipts.length === 0 ? <p className="text-xs text-slate-600">Noch kein Nachweis – es wurde nichts ausgeführt.</p> : null}
          <ul className="mt-1 space-y-1">
            {detail.action.receipts.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="font-medium">{r.status === 'CONFIRMED' ? 'Bestätigt' : r.status === 'FAILED' ? 'Fehlgeschlagen' : 'Ungewiss'}</span>
                {r.providerRef ? <span>Beleg {r.providerRef}</span> : null}
                <span>{formatDateTime(r.at)}</span>
                <ExecutionModeTag mode={r.executionMode as 'LIVE' | 'SIMULATED'} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.wait ? (
        <Section title="Warten">
          <p className="text-slate-700">
            Wartet auf eine Antwort ({detail.wait.status === 'WAITING' ? 'offen' : detail.wait.status === 'SATISFIED' ? 'eingegangen' : detail.wait.status === 'TIMED_OUT' ? 'Frist abgelaufen' : 'abgebrochen'})
            {detail.wait.deadlineAt ? ` · Frist ${formatDateTime(detail.wait.deadlineAt)}` : ''}
          </p>
        </Section>
      ) : null}

      {detail.facts.length > 0 ? (
        <Section title="Angaben mit Herkunft">
          <ul className="space-y-1">
            {detail.facts.map((f) => (
              <li key={`${f.key}-${f.status}`} className="rounded border border-slate-100 px-2 py-1">
                <span className="font-medium text-slate-800">{f.key}</span>: {renderValue(f.value)}
                <span className="ml-2 text-xs text-slate-600">
                  {FACT_STATUS_LABELS[f.status] ?? f.status} · {SOURCE_LABELS[f.sourceType] ?? f.sourceType}
                </span>
                {f.evidence && f.evidence.length > 0 ? <span className="mt-0.5 block text-xs italic text-slate-600">„{f.evidence[0]}“</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.inputs.length > 0 ? (
        <Section title="Eingaben">
          <ul className="space-y-0.5 text-xs text-slate-600">
            {detail.inputs.map((i) => (
              <li key={i.name}>
                <span className="font-medium text-slate-700">{i.name}</span> ← {i.source}
                {i.value !== undefined ? `: ${renderValue(i.value)}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.output !== undefined ? (
        <Section title="Ergebnis (technisch)">
          <details>
            <summary className="cursor-pointer text-xs text-slate-600">Anzeigen</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(detail.output, null, 2)}</pre>
          </details>
        </Section>
      ) : null}

      <p className="text-xs text-slate-600">
        {detail.startedAt ? `Gestartet ${formatDateTime(detail.startedAt)}` : ''}
        {detail.completedAt ? ` · Beendet ${formatDateTime(detail.completedAt)}` : ''}
      </p>
    </div>
  );
}
