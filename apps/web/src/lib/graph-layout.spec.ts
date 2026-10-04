import { describe, expect, it } from 'vitest';
import { layoutGraph, readingOrder } from './graph-layout';

const nodes = (...ids: string[]) => ids.map((id) => ({ id }));

describe('layoutGraph', () => {
  it('places a chain left to right, one layer per step', () => {
    const p = layoutGraph(nodes('a', 'b', 'c'), [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]);
    expect([p.get('a')!.layer, p.get('b')!.layer, p.get('c')!.layer]).toEqual([0, 1, 2]);
    expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    expect(p.get('b')!.x).toBeLessThan(p.get('c')!.x);
  });

  it('puts a join to the right of every predecessor and separates parallel branches vertically', () => {
    const p = layoutGraph(nodes('start', 'x', 'y', 'join'), [
      { source: 'start', target: 'x' },
      { source: 'start', target: 'y' },
      { source: 'x', target: 'join' },
      { source: 'y', target: 'join' },
    ]);
    expect(p.get('x')!.layer).toBe(1);
    expect(p.get('y')!.layer).toBe(1);
    expect(p.get('x')!.y).not.toBe(p.get('y')!.y);
    expect(p.get('join')!.layer).toBe(2);
  });

  it('uses the longest path when a shortcut edge exists', () => {
    const p = layoutGraph(nodes('a', 'b', 'c'), [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'a', target: 'c' },
    ]);
    expect(p.get('c')!.layer).toBe(2);
  });

  it('is deterministic, ignores dangling edges and survives a cycle', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'a', target: 'ghost' },
    ];
    const first = layoutGraph(nodes('a', 'b'), edges);
    const second = layoutGraph(nodes('a', 'b'), edges);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.size).toBe(2);
  });

  it('yields a reading order for the timeline alternative', () => {
    expect(readingOrder(nodes('c', 'a', 'b'), [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }])).toEqual(['a', 'b', 'c']);
  });
});
