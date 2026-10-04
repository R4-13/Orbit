export interface LayoutNodeInput {
  id: string;
}

export interface LayoutEdgeInput {
  source: string;
  target: string;
}

export interface NodePosition {
  x: number;
  y: number;
  layer: number;
}

export const LAYOUT = { columnWidth: 300, rowHeight: 128 } as const;

/**
 * Layered left-to-right layout for a directed acyclic process graph. A node sits in the layer of its longest path from
 * an entry node, so every edge points to the right and a join always lies right of all its predecessors; within a layer
 * nodes are ordered by the average row of their predecessors (a simple barycentre pass) to keep edges short and mostly
 * uncrossed. Pure and deterministic — the same graph always yields the same picture, which the user relies on when the
 * view updates live.
 */
export function layoutGraph(nodes: readonly LayoutNodeInput[], edges: readonly LayoutEdgeInput[]): Map<string, NodePosition> {
  const ids = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of validEdges) incoming.get(e.target)?.push(e.source);

  // Longest-path layering with cycle protection (a cycle would otherwise recurse forever).
  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const layerFor = (id: string): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const layer = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(layerFor));
    visiting.delete(id);
    layerOf.set(id, layer);
    return layer;
  };
  for (const n of nodes) layerFor(n.id);

  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const layer = layerOf.get(n.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), n.id]);
  }

  const row = new Map<string, number>();
  const positions = new Map<string, NodePosition>();
  for (const layer of [...layers.keys()].sort((a, b) => a - b)) {
    const members = layers.get(layer) ?? [];
    const barycentre = (id: string): number => {
      const parents = incoming.get(id) ?? [];
      const rows = parents.map((p) => row.get(p)).filter((r): r is number => r !== undefined);
      return rows.length === 0 ? Number.MAX_SAFE_INTEGER : rows.reduce((a, b) => a + b, 0) / rows.length;
    };
    const ordered = [...members].sort((a, b) => barycentre(a) - barycentre(b) || nodes.findIndex((n) => n.id === a) - nodes.findIndex((n) => n.id === b));
    ordered.forEach((id, index) => {
      row.set(id, index);
      positions.set(id, { x: layer * LAYOUT.columnWidth, y: index * LAYOUT.rowHeight, layer });
    });
  }
  return positions;
}

/** Nodes in a stable reading order (by layer, then row): the order of the linear timeline alternative. */
export function readingOrder(nodes: readonly LayoutNodeInput[], edges: readonly LayoutEdgeInput[]): string[] {
  const positions = layoutGraph(nodes, edges);
  return [...positions.entries()].sort(([, a], [, b]) => a.layer - b.layer || a.y - b.y).map(([id]) => id);
}
