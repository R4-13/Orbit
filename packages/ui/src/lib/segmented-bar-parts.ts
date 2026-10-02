import type { DonutSegmentInput } from './donut-segments';

export interface SegmentedBarPart extends DonutSegmentInput {
  /** 0-100, rounded to the nearest whole percent — matches how the legend displays it. */
  percent: number;
}

/**
 * Pure percentage calculation, split out of `SegmentedBar` for the same
 * reason as `buildDonutArcs` (packages/ui has no jsdom/React-Testing-Library
 * setup) — this one is simple, but rounding four independently-rounded
 * percentages can visibly fail to sum to 100%, which is exactly the kind of
 * off-by-a-little bug worth proving correct with a test rather than eyeballing.
 */
export function buildSegmentedBarParts(segments: DonutSegmentInput[]): SegmentedBarPart[] {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return segments.map((segment) => ({
    ...segment,
    percent: total > 0 ? Math.round((segment.value / total) * 100) : 0,
  }));
}
