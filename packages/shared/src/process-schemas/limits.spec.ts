import { describe, expect, it } from 'vitest';
import { LIMIT_CEILINGS, LIMIT_DEFAULTS, checkActionLimits, effectiveLimits } from './limits';

describe('zentrale Limits (BP-39)', () => {
  it('ohne Blueprint-Angabe gelten die Standardwerte', () => {
    expect(effectiveLimits()).toEqual(LIMIT_DEFAULTS);
  });

  it('ein Blueprint darf verschärfen, aber nie über die Plattformobergrenze hinaus lockern', () => {
    expect(effectiveLimits({ maxActionsPerCase: 5 }).maxActionsPerCase).toBe(5);
    expect(effectiveLimits({ maxActionsPerCase: 500 }).maxActionsPerCase).toBe(LIMIT_CEILINGS.maxActionsPerCase);
    expect(effectiveLimits({ maxSteps: 100 }).maxSteps).toBe(LIMIT_CEILINGS.maxSteps);
    expect(effectiveLimits({ maxAutoQuestions: 9 }).maxAutoQuestions).toBe(LIMIT_CEILINGS.maxAutoQuestions);
    expect(effectiveLimits({ maxReplans: 7 }).maxReplans).toBe(7);
  });

  it('Aktionslimit: erreicht → keine weitere Aktion, mit fachlicher Begründung', () => {
    const limits = effectiveLimits({ maxActionsPerCase: 3 });
    expect(checkActionLimits(limits, 2, [])).toEqual({ allowed: true });
    const verdict = checkActionLimits(limits, 3, []);
    expect(verdict).toMatchObject({ allowed: false, code: 'LIMIT_ACTIONS_PER_CASE' });
    expect(verdict.message).toContain('3');
  });

  it('Fehler in Folge: nur ununterbrochene Fehlschläge der neuesten Aktionen zählen', () => {
    const limits = effectiveLimits({ maxConsecutiveCapabilityFailures: 3 });
    expect(checkActionLimits(limits, 3, [true, true, false, true])).toEqual({ allowed: true }); // Erfolg unterbricht die Folge
    expect(checkActionLimits(limits, 3, [true, true, true])).toMatchObject({ allowed: false, code: 'LIMIT_CONSECUTIVE_FAILURES' });
    expect(checkActionLimits(limits, 0, [])).toEqual({ allowed: true });
  });
});
