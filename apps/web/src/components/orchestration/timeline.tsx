'use client';

import { useMemo } from 'react';
import { NODE_STATE_PRESENTATION, type CaseGraphView } from '@orbit/shared';
import { readingOrder } from '../../lib/graph-layout';
import { ExecutionModeTag, StateChip } from './state-chip';

/**
 * The linear alternative to the graph (Amendment 02 §16.4): the same server projection as a reading-order list. It is the
 * default on narrow screens and is fully keyboard- and screen-reader-operable — the graph is never the only way in.
 */
export function OrchestrationTimeline({ graph, selectedId, onSelect }: { graph: CaseGraphView; selectedId: string | null; onSelect: (id: string) => void }) {
  const ordered = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return readingOrder(graph.nodes, graph.edges)
      .map((id) => byId.get(id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
  }, [graph.nodes, graph.edges]);

  if (ordered.length === 0) return <p className="text-sm text-slate-500">Noch kein Plan vorhanden.</p>;
  return (
    <ol className="space-y-2" aria-label="Schritte des Vorgangs in Reihenfolge">
      {ordered.map((node, index) => {
        const current = graph.currentNodeIds.includes(node.id);
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-current={current ? 'step' : undefined}
              aria-label={`${index + 1}. ${node.title}: ${NODE_STATE_PRESENTATION[node.state].label}`}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                selectedId === node.id ? 'border-brand ring-1 ring-brand' : current ? 'border-slate-400' : 'border-slate-200'
              }`}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{node.title}</span>
                  <StateChip state={node.state} />
                  <ExecutionModeTag mode={node.executionMode} />
                  {node.availableActions.length > 0 ? <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-foreground">Aktion möglich</span> : null}
                </span>
                {node.conciseReason ? <span className="mt-1 block text-xs text-slate-500">{node.conciseReason}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
