export interface DonutSegmentInput {
  label: string;
  value: number;
  colorVar: string;
}

export interface DonutArc {
  label: string;
  value: number;
  colorVar: string;
  /** SVG `stroke-dasharray` value — "<arc length> <remaining circumference>". */
  dasharray: string;
  /** SVG `stroke-dashoffset` value — where this arc starts along the circle. */
  dashoffset: number;
}

/**
 * Pure geometry, split out of `DonutChart` so it's testable without a DOM —
 * packages/ui has no jsdom/React-Testing-Library setup (same reasoning as
 * `sortItems`/`nextSortState` behind `useSortableList`, see
 * docs/ASSUMPTIONS.md). Zero-value segments are dropped (a 0-length arc
 * with a visible stroke would otherwise render as a stray dot at the seam).
 */
export function buildDonutArcs(segments: DonutSegmentInput[], radius: number): DonutArc[] {
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let offset = 0;
  const arcs: DonutArc[] = [];
  for (const segment of segments) {
    if (segment.value <= 0) continue;
    const length = total > 0 ? (segment.value / total) * circumference : 0;
    arcs.push({
      label: segment.label,
      value: segment.value,
      colorVar: segment.colorVar,
      dasharray: `${length} ${circumference - length}`,
      // SVG draws dasharray starting at the 3-o'clock point going clockwise;
      // a negative offset shifts the start point further clockwise by that
      // amount, which is what's needed to continue exactly where the
      // previous arc left off.
      dashoffset: -offset,
    });
    offset += length;
  }
  return arcs;
}
