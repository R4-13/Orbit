'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { CASE_ORCHESTRATION_LABELS, type CaseGraphView } from '@orbit/shared';
import { Badge, ErrorState, type BadgeTone } from '@orbit/ui';
import { errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { useCaseEventStream, useOrchestration, type OrchestrationMode, type StreamStatus } from '../../lib/hooks/use-case-orchestration';
import { useMainWidth } from '../../lib/hooks/use-element-size';
import { useSondeCaseContext } from '../../lib/sonde-context';
import { ActionButtons } from './action-controls';
import { NodeDetailPanel } from './node-detail-panel';
import { SimulateReply } from './simulate-reply';
import { OrchestrationTimeline } from './timeline';

// The graph library is only needed on this tab; load it on demand so the rest of the app stays light.
const OrchestrationGraph = dynamic(() => import('./orchestration-graph').then((m) => m.OrchestrationGraph), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-slate-500">Graph wird geladen …</p>,
});

const STATUS_TONES: Record<string, BadgeTone> = {
  COMPLETED: 'success',
  IN_PROGRESS: 'info',
  READY: 'info',
  RECEIVED: 'neutral',
  WAITING_FOR_INFORMATION: 'warning',
  WAITING_FOR_APPROVAL: 'warning',
  WAITING_FOR_EXTERNAL_SYSTEM: 'warning',
  PAUSED: 'neutral',
  MANUAL_REVIEW: 'warning',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

const STREAM_LABELS: Record<StreamStatus, { label: string; dot: string }> = {
  connecting: { label: 'Verbindung wird aufgebaut …', dot: 'bg-slate-400' },
  live: { label: 'Live aktualisiert', dot: 'bg-emerald-500' },
  reconnecting: { label: 'Verbindung unterbrochen – nicht live', dot: 'bg-amber-500' },
  offline: { label: 'Keine Live-Aktualisierung', dot: 'bg-red-500' },
};

const MODES: Array<{ id: OrchestrationMode; label: string; hint: string }> = [
  { id: 'COMBINED', label: 'Gesamt', hint: 'Erledigtes und Geplantes' },
  { id: 'ACTUAL', label: 'Tatsächlich', hint: 'Nur was passiert ist' },
  { id: 'DEFINITION', label: 'Prozessdefinition', hint: 'Der Standardablauf' },
];

/** Der Graph braucht Platz: maßgeblich ist die tatsächlich verfügbare Breite der Arbeitsfläche, nicht der Viewport (UI v2 SHELL-04). */
function useIsWide(): boolean {
  const width = useMainWidth();
  return width === 0 ? true : width >= 900;
}

/** The interactive orchestration of one case (Amendment 02 §16–§17): graph or list, node details, server-provided actions. */
export function OrchestrationPanel({ caseId }: { caseId: string }) {
  const [mode, setMode] = useState<OrchestrationMode>('COMBINED');
  const [planRevision, setPlanRevision] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'GRAPH' | 'LIST' | null>(null);
  const wide = useIsWide();
  const effectiveView = view ?? (wide ? 'GRAPH' : 'LIST');

  const { data: graph, isLoading, isError, error, refetch } = useOrchestration(caseId, { mode, planRevision });
  // Sonde sees what the user sees: the case, the selected step and the revision (the server re-validates this hint).
  const { setContext } = useSondeCaseContext();
  const selectedTitle = selected ? graph?.nodes.find((node) => node.id === selected)?.title : undefined;
  useEffect(() => {
    setContext({ caseId, nodeId: selected ?? undefined, planRevision, label: selectedTitle ? `Dieser Vorgang · Schritt „${selectedTitle}“` : 'Dieser Vorgang' });
    return () => setContext(null);
  }, [caseId, selected, selectedTitle, planRevision, setContext]);
  const stream = useCaseEventStream(caseId, mode !== 'DEFINITION');

  if (isLoading) return <p className="text-sm text-slate-500">Orchestrierung wird geladen …</p>;
  if (isError) return <ErrorState message={errorMessage(error, 'Die Orchestrierung konnte nicht geladen werden.')} onRetry={() => void refetch()} />;
  if (!graph) return null;

  const viewingHistory = planRevision !== undefined && planRevision !== graph.revisions.at(-1)?.revision;
  const statusLabel = CASE_ORCHESTRATION_LABELS[graph.overallStatus] ?? graph.overallStatus;
  const streamInfo = STREAM_LABELS[stream.status];
  const revision = graph.revisions.find((r) => r.revision === graph.planRevision);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONES[graph.overallStatus] ?? 'neutral'}>{statusLabel}</Badge>
          {graph.blueprint ? (
            <span className="text-xs text-slate-500">
              {graph.blueprint.title} · {graph.blueprint.key} {graph.blueprint.version}
            </span>
          ) : (
            <span className="text-xs text-slate-500">Ad-hoc-Plan</span>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-slate-600" role="status" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${streamInfo.dot}`} aria-hidden="true" />
          {streamInfo.label}
        </span>
      </div>

      {graph.attentionReasons.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" aria-label="Was jetzt Aufmerksamkeit braucht">
          {graph.attentionReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      <ActionButtons caseId={caseId} actions={graph.availableActions} />
      {graph.overallStatus === 'WAITING_FOR_INFORMATION' ? <SimulateReply caseId={caseId} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Ebene" className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id);
                setSelected(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${mode === m.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Darstellung" className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {(['GRAPH', 'LIST'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={effectiveView === v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${effectiveView === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {v === 'GRAPH' ? 'Graph' : 'Liste'}
            </button>
          ))}
        </div>
        {graph.revisions.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Planrevision
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              value={planRevision ?? graph.revisions.at(-1)?.revision}
              onChange={(e) => setPlanRevision(Number(e.target.value))}
            >
              {graph.revisions.map((r) => (
                <option key={r.revision} value={r.revision}>
                  Revision {r.revision} · {r.status === 'ACTIVE' ? 'aktiv' : r.status === 'SUPERSEDED' ? 'ersetzt' : r.status.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {viewingHistory ? <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">Sie sehen eine frühere Planrevision. Aktionen sind nur in der aktuellen Revision möglich.</p> : null}
      {revision?.diff && (revision.diff.added.length > 0 || revision.diff.removed.length > 0 || revision.diff.changed.length > 0) ? (
        <p className="text-xs text-slate-600">
          Änderung gegenüber der Vorrevision: {revision.diff.added.length} neu, {revision.diff.changed.length} geändert, {revision.diff.removed.length} entfallen, {revision.diff.kept.length} unverändert.
        </p>
      ) : null}
      {revision ? <p className="text-xs text-slate-500">{revision.explanation} · erstellt {formatDateTime(revision.createdAt)}</p> : null}

      {graph.nodes.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-600">Für diesen Vorgang gibt es noch keinen Plan. Sobald einer erstellt wurde, erscheint er hier.</p>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            {effectiveView === 'GRAPH' ? <OrchestrationGraph graph={graph as CaseGraphView} selectedId={selected} onSelect={setSelected} /> : <OrchestrationTimeline graph={graph} selectedId={selected} onSelect={setSelected} />}
          </div>
          {selected && mode !== 'DEFINITION' ? (
            <NodeDetailPanel caseId={caseId} nodeId={selected} planRevision={graph.planRevision} onClose={() => setSelected(null)} />
          ) : (
            <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              {mode === 'DEFINITION' ? 'Die Prozessdefinition zeigt den Standardablauf. Wählen Sie „Gesamt“ für den tatsächlichen Verlauf dieses Vorgangs.' : 'Wählen Sie einen Schritt, um Details, Nachweise und mögliche Aktionen zu sehen.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
