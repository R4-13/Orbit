import { describe, expect, it } from 'vitest';
import {
  ExpressionError,
  evaluateExpr,
  collectReferences,
  normalizeExpr,
  readPath,
  validateExpressionShape,
  type EvalContext,
  type Expr,
} from './expressions';

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

describe('expression grammar', () => {
  it('rejects unknown operators and extra keys (no invented operator, no code)', () => {
    expect(validateExpressionShape({ eval: 'process.exit(1)' }).valid).toBe(false);
    expect(validateExpressionShape({ exists: { fact: 'a' }, extra: 1 }).valid).toBe(false);
    expect(validateExpressionShape({ js: '1+1' }).valid).toBe(false);
  });

  it('rejects over-deep nesting', () => {
    let expr: Expr = { exists: { fact: 'a' } };
    for (let i = 0; i < 9; i++) expr = { not: expr };
    const result = validateExpressionShape(expr);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('verschachtelt');
  });

  it('evaluates boolean combinators and requirement / capability / receipt checks', () => {
    const context = ctx({
      facts: { a: 'x', price: 10 },
      requirements: { r1: 'SATISFIED', r2: 'MISSING' },
      capabilities: new Set(['email.send']),
      receipts: new Set(['QUOTE_DELIVERY']),
    });
    expect(evaluateExpr({ all: [{ requirementSatisfied: 'r1' }, { capabilityAvailable: 'email.send' }] }, context)).toBe(true);
    expect(evaluateExpr({ all: [{ requirementSatisfied: 'r1' }, { requirementSatisfied: 'r2' }] }, context)).toBe(false);
    expect(evaluateExpr({ any: [{ requirementSatisfied: 'r2' }, { receiptConfirmed: { purpose: 'QUOTE_DELIVERY' } }] }, context)).toBe(true);
    expect(evaluateExpr({ not: { receiptConfirmed: { purpose: 'OTHER' } } }, context)).toBe(true);
    expect(evaluateExpr({ gt: [{ fact: 'price' }, { literal: 5 }] }, context)).toBe(true);
  });

  it('normalizes factEquals to a typed eq and evaluates it', () => {
    const expr: Expr = { factEquals: { key: 'channel', value: 'EMAIL' } };
    expect(normalizeExpr(expr)).toEqual({ eq: [{ fact: 'channel' }, { literal: 'EMAIL' }] });
    expect(evaluateExpr(expr, ctx({ facts: { channel: 'EMAIL' } }))).toBe(true);
    expect(evaluateExpr(expr, ctx({ facts: { channel: 'SMS' } }))).toBe(false);
  });

  it('refuses to compare non-numbers with gt instead of answering false', () => {
    expect(() => evaluateExpr({ gt: [{ fact: 'price' }, { literal: 5 }] }, ctx({ facts: { price: '10' } }))).toThrow(ExpressionError);
  });

  it('only reads own plain-data properties (no prototype access)', () => {
    expect(() => readPath({}, '__proto__.polluted')).toThrow(ExpressionError);
    expect(() => readPath({}, 'constructor.name')).toThrow(ExpressionError);
    expect(readPath({ a: { b: 3 } }, 'a.b')).toBe(3);
    expect(readPath({ a: {} }, 'a.missing')).toBeUndefined();
    expect(readPath('text', 'length')).toBeUndefined();
  });

  it('collects references for pre-activation checks', () => {
    const refs = collectReferences({
      all: [
        { eq: [{ fact: 'f1' }, { stepOutput: { node: 'n1', path: 'x' } }] },
        { requirementSatisfied: 'r1' },
        { capabilityAvailable: 'email.send' },
        { receiptConfirmed: { purpose: 'QUOTE_DELIVERY' } },
        { factEquals: { key: 'f2', value: true } },
      ],
    });
    expect([...refs.facts].sort()).toEqual(['f1', 'f2']);
    expect([...refs.stepNodes]).toEqual(['n1']);
    expect([...refs.requirements]).toEqual(['r1']);
    expect([...refs.capabilities]).toEqual(['email.send']);
    expect([...refs.receiptPurposes]).toEqual(['QUOTE_DELIVERY']);
  });
});
