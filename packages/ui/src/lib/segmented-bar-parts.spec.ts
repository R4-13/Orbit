import { describe, expect, it } from 'vitest';
import { buildSegmentedBarParts } from './segmented-bar-parts';

describe('buildSegmentedBarParts', () => {
  it('computes each segment as a rounded percentage of the total', () => {
    const parts = buildSegmentedBarParts([
      { label: 'A', value: 3, colorVar: '--a' },
      { label: 'B', value: 1, colorVar: '--b' },
    ]);
    expect(parts.map((p) => p.percent)).toEqual([75, 25]);
  });

  it('returns 0% for every segment when the total is zero (no NaN/Infinity)', () => {
    const parts = buildSegmentedBarParts([
      { label: 'A', value: 0, colorVar: '--a' },
      { label: 'B', value: 0, colorVar: '--b' },
    ]);
    expect(parts.map((p) => p.percent)).toEqual([0, 0]);
  });

  it('keeps zero-value segments in the output (unlike buildDonutArcs, which drops them) so the legend can still list them at 0%', () => {
    const parts = buildSegmentedBarParts([
      { label: 'A', value: 5, colorVar: '--a' },
      { label: 'Empty', value: 0, colorVar: '--b' },
    ]);
    expect(parts.map((p) => p.label)).toEqual(['A', 'Empty']);
  });

  it('preserves the original label/value/colorVar alongside the computed percent', () => {
    const parts = buildSegmentedBarParts([{ label: 'Gebucht', value: 83, colorVar: '--status-success' }]);
    expect(parts[0]).toEqual({ label: 'Gebucht', value: 83, colorVar: '--status-success', percent: 100 });
  });
});
