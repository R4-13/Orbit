import { describe, expect, it } from 'vitest';
import { describeCompletionEvaluation, evaluateCompletion } from './completion';
import type { EvalContext, Expr } from './expressions';

const ctx = (facts: Record<string, unknown>): EvalContext => ({ facts, stepOutputs: {}, config: {}, sourceRefs: {}, requirements: {}, capabilities: new Set(), receipts: new Set() });
const hasFact = (key: string): Expr => ({ exists: { fact: key } });

describe('Abschlussbewertung (BP-40)', () => {
  const def = { goals: ['Angebot erstellen', 'Angebot versenden'], completionCriteria: hasFact('quote') };

  it('ohne Ziel-Kriterien folgen alle Ziele den Abschlusskriterien', () => {
    const met = evaluateCompletion(def, ctx({ quote: 'Q-1' }), ['email.send/QUOTE_DELIVERY']);
    expect(met.met).toBe(true);
    expect(met.goals.map((g) => g.basis)).toEqual(['COMPLETION_CRITERIA', 'COMPLETION_CRITERIA']);
    expect(met.evidenceRefs).toEqual(['email.send/QUOTE_DELIVERY']);
    const open = evaluateCompletion(def, ctx({}), []);
    expect(open).toMatchObject({ met: false, criteriaMet: false });
    expect(open.goals.every((g) => g.status === 'NOT_ACHIEVED')).toBe(true);
  });

  it('ein Ziel mit eigenem Kriterium kann den Abschluss verhindern, obwohl die allgemeinen Kriterien erfüllt sind', () => {
    const withGoal = { ...def, goalCriteria: { 'Angebot versenden': hasFact('delivered') } };
    const result = evaluateCompletion(withGoal, ctx({ quote: 'Q-1' }), []);
    expect(result.criteriaMet).toBe(true);
    expect(result.met).toBe(false);
    expect(result.goals).toEqual([
      { goal: 'Angebot erstellen', basis: 'COMPLETION_CRITERIA', status: 'ACHIEVED' },
      { goal: 'Angebot versenden', basis: 'GOAL_CRITERIA', status: 'NOT_ACHIEVED' },
    ]);
    expect(evaluateCompletion(withGoal, ctx({ quote: 'Q-1', delivered: true }), []).met).toBe(true);
  });

  it('ein nicht auswertbares Kriterium gilt nie als erfüllt', () => {
    const broken = { goals: ['Ziel'], completionCriteria: { gt: [{ fact: 'x' }, { literal: 'abc' }] } as Expr };
    const result = evaluateCompletion(broken, ctx({ x: 1 }), []);
    expect(result.met).toBe(false);
  });

  it('die Historienzeile nennt jedes Ziel mit Status', () => {
    const text = describeCompletionEvaluation(evaluateCompletion(def, ctx({}), []));
    expect(text).toContain('noch nicht erfüllt');
    expect(text).toContain('Angebot versenden: noch nicht erreicht');
  });
});
