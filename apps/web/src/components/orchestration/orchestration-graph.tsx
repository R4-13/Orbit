'use client';

import '@xyflow/react/dist/style.css';
import { useEffect, useMemo } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { NODE_STATE_PRESENTATION, type CaseGraphView } from '@orbit/shared';
import { layoutGraph } from '../../lib/graph-layout';
import { ExecutionModeTag, TONE_STYLES } from './state-chip';

type ProcessNodeData = {
  title: string;
  type: string;
  state: CaseGraphView['nodes'][number]['state'];
  executionMode?: 'LIVE' | 'SIMULATED';
  selected: boolean;
  hasActions: boolean;
  current: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  INTERPRET: 'Verstehen',
  RESOLVE_CONTEXT: 'Kontext',
  EVALUATE_REQUIREMENTS: 'Anforderungen',
  DECISION: 'Entscheidung',
  PREPARE: 'Vorbereiten',
  ACTION: 'Aktion',
  APPROVAL: 'Freigabe',
  WAIT_EVENT: 'Warten',
  REASSESS: 'Neu bewerten',
  MANUAL_TASK: 'Manuell',
  COMPLETE: 'Abschluss',
};

function ProcessNode({ data }: NodeProps<Node<ProcessNodeData>>) {
  const presentation = NODE_STATE_PRESENTATION[data.state];
  const style = TONE_STYLES[presentation.tone];
  const dashed = data.state === 'PLANNED' || data.state === 'SKIPPED' || data.state === 'SUPERSEDED' || data.state === 'CANCELLED';
  return (
    <div
      className={`w-56 rounded-lg border-2 px-3 py-2 text-left shadow-sm ${style.node} ${dashed ? 'border-dashed' : ''} ${data.selected ? 'ring-2 ring-brand ring-offset-2' : ''} ${data.current ? 'shadow-md' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-slate-400" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{TYPE_LABELS[data.type] ?? data.type}</span>
        <ExecutionModeTag mode={data.executionMode} />
      </div>
      <p className="mt-0.5 line-clamp-2 text-sm font-medium text-slate-900">{data.title}</p>
      <p className="mt-1 flex items-center gap-1 text-xs font-medium text-slate-700">
        <span aria-hidden="true">{presentation.symbol}</span>
        {presentation.label}
        {data.hasActions ? <span className="ml-auto rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-foreground">Aktion</span> : null}
      </p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-slate-400" />
    </div>
  );
}

const NODE_TYPES = { process: ProcessNode };

function FocusButton({ currentIds, positions }: { currentIds: string[]; positions: Map<string, { x: number; y: number }> }) {
  const { setCenter, fitView } = useReactFlow();
  const target = currentIds.map((id) => positions.get(id)).find(Boolean);
  return (
    <div className="absolute right-3 top-3 z-10 flex gap-2">
      <button
        type="button"
        onClick={() => (target ? setCenter(target.x + 112, target.y + 40, { zoom: 1, duration: 400 }) : fitView({ duration: 400 }))}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        Zum aktuellen Schritt
      </button>
      <button
        type="button"
        onClick={() => fitView({ duration: 400, padding: 0.15 })}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        Alles anzeigen
      </button>
    </div>
  );
}

function Canvas({ graph, selectedId, onSelect }: { graph: CaseGraphView; selectedId: string | null; onSelect: (id: string) => void }) {
  const positions = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes, graph.edges]);
  const nodes: Node<ProcessNodeData>[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'process',
        position: { x: positions.get(n.id)?.x ?? 0, y: positions.get(n.id)?.y ?? 0 },
        data: { title: n.title, type: n.type, state: n.state, executionMode: n.executionMode, selected: n.id === selectedId, hasActions: n.availableActions.length > 0, current: graph.currentNodeIds.includes(n.id) },
        ariaLabel: `${n.title}: ${NODE_STATE_PRESENTATION[n.state].label}`,
        draggable: false,
        connectable: false,
      })),
    [graph.nodes, graph.currentNodeIds, positions, selectedId],
  );
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style:
          e.disposition === 'TAKEN'
            ? { stroke: '#0f172a', strokeWidth: 2.2 }
            : e.disposition === 'POSSIBLE'
              ? { stroke: '#64748b', strokeWidth: 1.5, strokeDasharray: '6 4' }
              : { stroke: '#cbd5e1', strokeWidth: 1.2, strokeDasharray: '2 5' },
        ariaLabel: `${e.source} → ${e.target}: ${e.disposition === 'TAKEN' ? 'genommen' : e.disposition === 'POSSIBLE' ? 'möglich' : 'nicht genommen'}`,
      })),
    [graph.edges],
  );

  const { fitView, setCenter } = useReactFlow();
  // The step to open on: the one needing attention; for a finished case the last step that actually ran.
  const lastExecuted = [...graph.nodes].filter((n) => n.state === 'SUCCEEDED').sort((a, b) => (positions.get(b.id)?.x ?? 0) - (positions.get(a.id)?.x ?? 0))[0];
  const currentId = graph.currentNodeIds[0] ?? lastExecuted?.id;
  const currentPosition = currentId ? positions.get(currentId) : undefined;
  useEffect(() => {
    // Initial view: a small graph is shown whole; a long process opens on the step that needs attention at a readable zoom
    // ("Alles anzeigen" gives the overview). Re-run only when the plan or the set of nodes changes, not on every state update.
    const handle = setTimeout(() => {
      if (graph.nodes.length > 7 && currentPosition) void setCenter(currentPosition.x + 112, currentPosition.y + 40, { zoom: 0.9 });
      else void fitView({ padding: 0.15 });
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.planId, graph.mode, graph.nodes.length, fitView, setCenter]);

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50" role="group" aria-label="Prozessgraph des Vorgangs">
      <FocusButton currentIds={graph.currentNodeIds.length > 0 ? graph.currentNodeIds : graph.nodes.filter((n) => n.state === "SUCCEEDED").sort((a, b) => (positions.get(b.id)?.x ?? 0) - (positions.get(a.id)?.x ?? 0)).slice(0, 1).map((n) => n.id)} positions={positions} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView={graph.nodes.length <= 7}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <p className="pointer-events-none absolute bottom-2 left-3 hidden text-[11px] text-slate-500 sm:block">
        Durchgezogen = genommen · gestrichelt = möglich · gepunktet = nicht genommen
      </p>
    </div>
  );
}

export function OrchestrationGraph(props: { graph: CaseGraphView; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
