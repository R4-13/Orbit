import { describe, expect, it } from 'vitest';
import type { EvalContext } from './expressions';
import type { NodeState } from './graph';
import { PlanNodeSchema } from './plan';
import { bindInputs, nextActions, type RuntimeEdge, type RuntimeNode } from './plan-runtime';

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  facts: {},
  stepOutputs: {},
  config: {},
  sourceRefs: {},
  requirements: {},
  capabilities: new Set(),
  receipts: new Set(),
  ...over,
});
const node = (key: string, state: NodeState, extra: Record<string, unknown> = {}): RuntimeNode => ({
  key,
  state,
  definition: PlanNodeSchema.parse({ id: key, type: 'PREPARE', title: key, ...extra }),
});
const edge = (key: string, source: string, target: string, condition?: RuntimeEdge['condition']): RuntimeEdge => ({ key, source, target, condition });
const actions = (nodes: RuntimeNode[], edges: RuntimeEdge[], c = ctx()) => nextActions(nodes, edges, c).map((a) => `${a.nodeKey}:${a.action}`);

describe('nextActions', () => {
  it('starts entry nodes and waits for open upstream nodes', () => {
    expect(actions([node('a', 'PLANNED'), node('b', 'PLANNED')], [edge('e', 'a', 'b')])).toEqual(['a:EXECUTE']);
    expect(actions([node('a', 'RUNNING'), node('b', 'PLANNED')], [edge('e', 'a', 'b')])).toEqual([]);
    expect(actions([node('a', 'WAITING'), node('b', 'PLANNED')], [edge('e', 'a', 'b')])).toEqual([]);
  });

  it('runs a node once its predecessor succeeded or was skipped', () => {
    expect(actions([node('a', 'SUCCEEDED'), node('b', 'PLANNED')], [edge('e', 'a', 'b')])).toEqual(['b:EXECUTE']);
    expect(actions([node('a', 'SKIPPED'), node('b', 'PLANNED')], [edge('e', 'a', 'b')])).toEqual(['b:EXECUTE']);
  });

  it('keeps the successors of a failed predecessor open (no dead-branch skip) so a later retry can still reach them', () => {
    expect(actions([node('a', 'FAILED'), node('b', 'PLANNED')], [edge('e', 'a', 'b')])).toEqual([]);
    expect(actions([node('a', 'CANCELLED'), node('b', 'PLANNED')], [edge('e', 'a', 'b')])).toEqual(['b:SKIP']);
  });

  it('follows conditional edges and skips the branch not taken', () => {
    const nodes = [node('a', 'SUCCEEDED'), node('yes', 'PLANNED'), node('no', 'PLANNED')];
    const edges = [
      edge('e1', 'a', 'yes', { factEquals: { key: 'complete', value: true } }),
      edge('e2', 'a', 'no', { not: { factEquals: { key: 'complete', value: true } } }),
    ];
    expect(actions(nodes, edges, ctx({ facts: { complete: true } }))).toEqual(['yes:EXECUTE', 'no:SKIP']);
    expect(actions(nodes, edges, ctx({ facts: { complete: false } }))).toEqual(['yes:SKIP', 'no:EXECUTE']);
  });

  it('skips a node whose precondition is false and blocks on an invalid expression', () => {
    const guarded = node('g', 'PLANNED', { preconditions: [{ requirementSatisfied: 'r' }] });
    expect(actions([guarded], [], ctx({ requirements: { r: 'MISSING' } }))).toEqual(['g:SKIP']);
    expect(actions([guarded], [], ctx({ requirements: { r: 'SATISFIED' } }))).toEqual(['g:EXECUTE']);
    const invalid = node('i', 'PLANNED', { preconditions: [{ gt: [{ fact: 'x' }, { literal: 1 }] }] });
    expect(actions([invalid], [], ctx({ facts: { x: 'text' } }))).toEqual(['i:BLOCK']);
  });

  it('needs every incoming edge to be decidable (join)', () => {
    const nodes = [node('a', 'SUCCEEDED'), node('b', 'WAITING'), node('j', 'PLANNED')];
    const edges = [edge('e1', 'a', 'j'), edge('e2', 'b', 'j')];
    expect(actions(nodes, edges)).toEqual([]);
  });

  it('never re-runs finished or running nodes', () => {
    expect(actions([node('a', 'SUCCEEDED'), node('b', 'RUNNING'), node('c', 'OUTCOME_UNKNOWN')], [])).toEqual([]);
  });
});

describe('bindInputs', () => {
  const n = node('x', 'PLANNED', { inputs: { to: { fact: 'sender.email' }, draft: { stepOutput: { node: 'd', path: 'draft.id' } }, mode: { literal: 'x' }, absent: { fact: 'nope' } } }).definition;

  it('resolves facts, step outputs and literals and reports what is missing', () => {
    const bound = bindInputs(n, ctx({ facts: { 'sender.email': 'a@b.example' }, stepOutputs: { d: { draft: { id: 'D1' } } } }));
    expect(bound.values).toEqual({ to: 'a@b.example', draft: 'D1', mode: 'x' });
    expect(bound.missing).toEqual(['absent']);
  });
});
