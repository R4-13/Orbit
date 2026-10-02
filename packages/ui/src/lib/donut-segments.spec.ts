import { describe, expect, it } from 'vitest';
import { buildDonutArcs } from './donut-segments';

describe('buildDonutArcs', () => {
  it('splits the circumference proportionally to each segment value', () => {
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const arcs = buildDonutArcs(
      [
        { label: 'A', value: 3, colorVar: '--a' },
        { label: 'B', value: 1, colorVar: '--b' },
      ],
      radius,
    );

    expect(arcs).toHaveLength(2);
    const aLength = Number(arcs[0]!.dasharray.split(' ')[0]);
    const bLength = Number(arcs[1]!.dasharray.split(' ')[0]);
    expect(aLength).toBeCloseTo((3 / 4) * circumference);
    expect(bLength).toBeCloseTo((1 / 4) * circumference);
  });

  it('chains dashoffset so each arc continues exactly where the previous one ended', () => {
    const arcs = buildDonutArcs(
      [
        { label: 'A', value: 1, colorVar: '--a' },
        { label: 'B', value: 1, colorVar: '--b' },
        { label: 'C', value: 2, colorVar: '--c' },
      ],
      10,
    );

    expect(arcs[0]!.dashoffset).toBe(-0);
    const firstLength = Number(arcs[0]!.dasharray.split(' ')[0]);
    expect(arcs[1]!.dashoffset).toBeCloseTo(-firstLength);
    const secondLength = Number(arcs[1]!.dasharray.split(' ')[0]);
    expect(arcs[2]!.dashoffset).toBeCloseTo(-(firstLength + secondLength));
  });

  it('drops zero-value segments entirely', () => {
    const arcs = buildDonutArcs(
      [
        { label: 'A', value: 5, colorVar: '--a' },
        { label: 'Empty', value: 0, colorVar: '--b' },
      ],
      10,
    );
    expect(arcs.map((a) => a.label)).toEqual(['A']);
  });

  it('returns an empty array when every segment is zero (no NaN arcs)', () => {
    const arcs = buildDonutArcs(
      [
        { label: 'A', value: 0, colorVar: '--a' },
        { label: 'B', value: 0, colorVar: '--b' },
      ],
      10,
    );
    expect(arcs).toEqual([]);
  });
});
