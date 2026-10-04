import { evaluateExpr, ExpressionError, readPath, type EvalContext, type Expr, type Operand } from './expressions';
import type { NodeState } from './graph';
import type { PlanNode } from './plan';

/**
 * Amendment 02 §12 — the pure scheduling rules of the orchestrator. Given the
 * persisted node states and the plan's edges it answers, deterministically,
 * which node may run next, which one is a dead branch and which one is
 * blocked by an invalid expression. No I/O: the same rules drive execution,
 * the graph projection's "possible" edges and the tests.
 */
export interface RuntimeNode {
  key: string;
  state: NodeState;
  definition: PlanNode;
}

export interface RuntimeEdge {
  key: string;
  source: string;
  target: string;
  condition?: Expr;
}

export type NextAction =
  | { nodeKey: string; action: 'EXECUTE' }
  | { nodeKey: string; action: 'SKIP'; reason: string }
  | { nodeKey: string; action: 'BLOCK'; reason: string };

const FINISHED: ReadonlySet<NodeState> = new Set<NodeState>(['SUCCEEDED', 'SKIPPED', 'FAILED', 'CANCELLED', 'SUPERSEDED']);
/**
 * States in which an edge out of the node is decided. A FAILED node is deliberately NOT decided: its successors stay open
 * until a person retries, reconciles or replans — skipping them as a "dead branch" would make a later successful retry
 * unable to reach the completion step.
 */
const DECIDES_EDGES: ReadonlySet<NodeState> = new Set<NodeState>(['SUCCEEDED', 'SKIPPED', 'CANCELLED', 'SUPERSEDED']);
/** A finished node whose outgoing edges may be taken: it did its job or was legitimately not needed. */
const PASSES_CONTROL: ReadonlySet<NodeState> = new Set<NodeState>(['SUCCEEDED', 'SKIPPED']);

export function isFinished(state: NodeState): boolean {
  return FINISHED.has(state);
}

export function nextActions(nodes: readonly RuntimeNode[], edges: readonly RuntimeEdge[], ctx: EvalContext): NextAction[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const actions: NextAction[] = [];

  for (const node of nodes) {
    if (node.state !== 'PLANNED' && node.state !== 'READY') continue;
    const incoming = edges.filter((e) => e.target === node.key);

    if (incoming.length > 0) {
      const sources = incoming.map((e) => byKey.get(e.source));
      if (sources.some((s) => !s || !DECIDES_EDGES.has(s.state))) continue; // upstream still open (or failed, awaiting a human) → not yet decidable
      try {
        const taken = incoming.filter((e) => {
          const source = byKey.get(e.source);
          return source !== undefined && PASSES_CONTROL.has(source.state) && (!e.condition || evaluateExpr(e.condition, ctx));
        });
        if (taken.length === 0) {
          actions.push({ nodeKey: node.key, action: 'SKIP', reason: 'Kein Pfad führt zu diesem Schritt.' });
          continue;
        }
      } catch (error) {
        if (error instanceof ExpressionError) {
          actions.push({ nodeKey: node.key, action: 'BLOCK', reason: `Kantenbedingung nicht auswertbar: ${error.message}` });
          continue;
        }
        throw error;
      }
    }

    // A terminal node's preconditions are the completion criteria and are judged by the completion step itself.
    if (node.definition.type !== 'COMPLETE') {
      try {
        if (!node.definition.preconditions.every((p) => evaluateExpr(p, ctx))) {
          actions.push({ nodeKey: node.key, action: 'SKIP', reason: 'Vorbedingung nicht erfüllt.' });
          continue;
        }
      } catch (error) {
        if (error instanceof ExpressionError) {
          actions.push({ nodeKey: node.key, action: 'BLOCK', reason: `Vorbedingung nicht auswertbar: ${error.message}` });
          continue;
        }
        throw error;
      }
    }
    actions.push({ nodeKey: node.key, action: 'EXECUTE' });
  }
  return actions;
}

export interface BoundInputs {
  values: Record<string, unknown>;
  /** Input names whose operand resolved to nothing (undefined/null). */
  missing: string[];
}

function resolveOperand(operand: Operand, ctx: EvalContext): unknown {
  if ('literal' in operand) return operand.literal;
  if ('fact' in operand) return ctx.facts[operand.fact];
  if ('config' in operand) return ctx.config[operand.config];
  if ('sourceRef' in operand) return ctx.sourceRefs[operand.sourceRef];
  return readPath(ctx.stepOutputs[operand.stepOutput.node], operand.stepOutput.path);
}

/** Resolves a node's typed input bindings against facts / step outputs / config. Never evaluates anything else. */
export function bindInputs(node: PlanNode, ctx: EvalContext): BoundInputs {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const [name, operand] of Object.entries(node.inputs)) {
    const value = resolveOperand(operand, ctx);
    if (value === undefined || value === null) missing.push(name);
    else values[name] = value;
  }
  return { values, missing };
}
