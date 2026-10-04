import { z } from 'zod';
import { factValuesEqual } from './fact-types';

/**
 * Amendment 02 §8.4 — the bounded, typed expression grammar that Blueprints
 * and plans may use for conditions and completion criteria. It is data, not
 * code: no `eval`, no JavaScript, no shell, no SQL, no HTTP, and no operator a
 * planner could invent — every object has exactly one known key and the
 * schema is strict. Evaluation is pure and deterministic.
 */

const literal = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Literal = z.infer<typeof literal>;

export type Operand =
  | { fact: string }
  | { stepOutput: { node: string; path: string } }
  | { config: string }
  | { sourceRef: string }
  | { literal: Literal };

export const OperandSchema: z.ZodType<Operand> = z.union([
  z.object({ fact: z.string().min(1).max(120) }).strict(),
  z.object({ stepOutput: z.object({ node: z.string().min(1).max(64), path: z.string().min(1).max(200) }).strict() }).strict(),
  z.object({ config: z.string().min(1).max(120) }).strict(),
  z.object({ sourceRef: z.string().min(1).max(200) }).strict(),
  z.object({ literal }).strict(),
]);

export type Expr =
  | { all: Expr[] }
  | { any: Expr[] }
  | { not: Expr }
  | { eq: [Operand, Operand] }
  | { gt: [Operand, Operand] }
  | { exists: Operand }
  | { requirementSatisfied: string }
  | { capabilityAvailable: string }
  | { receiptConfirmed: { purpose: string } }
  /** Declarative short form of a typed `eq` on a fact (§8.6); normalized, never interpreted as code. */
  | { factEquals: { key: string; value: Literal } };

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ExprSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(ExprSchema).min(1).max(20) }).strict(),
    z.object({ not: ExprSchema }).strict(),
    z.object({ eq: z.tuple([OperandSchema, OperandSchema]) }).strict(),
    z.object({ gt: z.tuple([OperandSchema, OperandSchema]) }).strict(),
    z.object({ exists: OperandSchema }).strict(),
    z.object({ requirementSatisfied: z.string().min(1).max(120) }).strict(),
    z.object({ capabilityAvailable: z.string().min(1).max(120) }).strict(),
    z.object({ receiptConfirmed: z.object({ purpose: z.string().min(1).max(80) }).strict() }).strict(),
    z.object({ factEquals: z.object({ key: z.string().min(1).max(120), value: literal }).strict() }).strict(),
  ]),
);

export const MAX_EXPRESSION_DEPTH = 8;

export type RequirementState = 'SATISFIED' | 'MISSING' | 'INVALID' | 'CONFLICTED' | 'SOURCE_UNAVAILABLE';

/** Everything an expression may look at. Nothing else is reachable from a definition. */
export interface EvalContext {
  facts: Record<string, unknown>;
  stepOutputs: Record<string, unknown>;
  config: Record<string, unknown>;
  sourceRefs: Record<string, unknown>;
  requirements: Record<string, RequirementState>;
  capabilities: ReadonlySet<string>;
  /** Purposes of persisted, confirmed execution receipts, e.g. `QUOTE_DELIVERY`. */
  receipts: ReadonlySet<string>;
}

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/** Rewrites the declarative short forms into the canonical grammar. Pure. */
export function normalizeExpr(expr: Expr): Expr {
  if ('factEquals' in expr) return { eq: [{ fact: expr.factEquals.key }, { literal: expr.factEquals.value }] };
  if ('all' in expr) return { all: expr.all.map(normalizeExpr) };
  if ('any' in expr) return { any: expr.any.map(normalizeExpr) };
  if ('not' in expr) return { not: normalizeExpr(expr.not) };
  return expr;
}

export function expressionDepth(expr: Expr): number {
  if ('all' in expr) return 1 + Math.max(...expr.all.map(expressionDepth));
  if ('any' in expr) return 1 + Math.max(...expr.any.map(expressionDepth));
  if ('not' in expr) return 1 + expressionDepth(expr.not);
  return 1;
}

export interface ExpressionReferences {
  facts: Set<string>;
  stepNodes: Set<string>;
  requirements: Set<string>;
  capabilities: Set<string>;
  receiptPurposes: Set<string>;
  configKeys: Set<string>;
}

/** Collects everything an expression refers to, so a validator can check each reference exists before activation. */
export function collectReferences(expr: Expr, into: ExpressionReferences = emptyReferences()): ExpressionReferences {
  const visitOperand = (operand: Operand): void => {
    if ('fact' in operand) into.facts.add(operand.fact);
    else if ('stepOutput' in operand) into.stepNodes.add(operand.stepOutput.node);
    else if ('config' in operand) into.configKeys.add(operand.config);
  };
  if ('all' in expr) expr.all.forEach((e) => collectReferences(e, into));
  else if ('any' in expr) expr.any.forEach((e) => collectReferences(e, into));
  else if ('not' in expr) collectReferences(expr.not, into);
  else if ('eq' in expr) expr.eq.forEach(visitOperand);
  else if ('gt' in expr) expr.gt.forEach(visitOperand);
  else if ('exists' in expr) visitOperand(expr.exists);
  else if ('requirementSatisfied' in expr) into.requirements.add(expr.requirementSatisfied);
  else if ('capabilityAvailable' in expr) into.capabilities.add(expr.capabilityAvailable);
  else if ('receiptConfirmed' in expr) into.receiptPurposes.add(expr.receiptConfirmed.purpose);
  else if ('factEquals' in expr) into.facts.add(expr.factEquals.key);
  return into;
}

export function emptyReferences(): ExpressionReferences {
  return {
    facts: new Set(),
    stepNodes: new Set(),
    requirements: new Set(),
    capabilities: new Set(),
    receiptPurposes: new Set(),
    configKeys: new Set(),
  };
}

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const SEGMENT = /^[A-Za-z0-9_]+$/;

/** Reads `a.b.c` from plain data. Rejects anything that could reach prototypes or functions. */
export function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (!SEGMENT.test(segment) || FORBIDDEN_PATH_SEGMENTS.has(segment)) throw new ExpressionError(`Ungültiges Pfadsegment "${segment}".`);
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveOperand(operand: Operand, ctx: EvalContext): unknown {
  if ('literal' in operand) return operand.literal;
  if ('fact' in operand) return ctx.facts[operand.fact];
  if ('config' in operand) return ctx.config[operand.config];
  if ('sourceRef' in operand) return ctx.sourceRefs[operand.sourceRef];
  return readPath(ctx.stepOutputs[operand.stepOutput.node], operand.stepOutput.path);
}

/**
 * Evaluates a (normalized or short-form) expression. A type mismatch in `gt`
 * throws instead of answering `false`: silently treating "price is a string"
 * as "not greater" would let a bad value pass a guard.
 */
export function evaluateExpr(expr: Expr, ctx: EvalContext): boolean {
  if ('factEquals' in expr) return evaluateExpr(normalizeExpr(expr), ctx);
  if ('all' in expr) return expr.all.every((e) => evaluateExpr(e, ctx));
  if ('any' in expr) return expr.any.some((e) => evaluateExpr(e, ctx));
  if ('not' in expr) return !evaluateExpr(expr.not, ctx);
  if ('eq' in expr) return factValuesEqual(resolveOperand(expr.eq[0], ctx), resolveOperand(expr.eq[1], ctx));
  if ('gt' in expr) {
    const left = resolveOperand(expr.gt[0], ctx);
    const right = resolveOperand(expr.gt[1], ctx);
    if (typeof left !== 'number' || typeof right !== 'number') throw new ExpressionError('"gt" erwartet zwei Zahlen.');
    return left > right;
  }
  if ('exists' in expr) {
    const value = resolveOperand(expr.exists, ctx);
    return value !== undefined && value !== null;
  }
  if ('requirementSatisfied' in expr) return ctx.requirements[expr.requirementSatisfied] === 'SATISFIED';
  if ('capabilityAvailable' in expr) return ctx.capabilities.has(expr.capabilityAvailable);
  return ctx.receipts.has(expr.receiptConfirmed.purpose);
}

export interface ExpressionValidation {
  valid: boolean;
  errors: string[];
}

/** Structural validation: schema, nesting depth. Reference existence is checked by the blueprint/plan validators. */
export function validateExpressionShape(input: unknown): ExpressionValidation {
  const parsed = ExprSchema.safeParse(input);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).slice(0, 5) };
  if (expressionDepth(parsed.data) > MAX_EXPRESSION_DEPTH) return { valid: false, errors: [`Der Ausdruck ist tiefer als ${MAX_EXPRESSION_DEPTH} Ebenen verschachtelt.`] };
  return { valid: true, errors: [] };
}
