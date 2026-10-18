import { describe, expect, it } from 'vitest';
import { LIMIT_CEILINGS, LIMIT_DEFAULTS, checkActionLimits, checkAiCostLimit, effectiveLimits } from './limits';

describe('zentrale Limits (BP-39)', () => {
  it('ohne Blueprint-Angabe gelten die Standardwerte', () => {
    expect(effectiveLimits()).toEqual(LIMIT_DEFAULTS);
  });

  it('ein Blueprint darf verschärfen, aber nie über die Plattformobergrenze hinaus lockern', () => {
    expect(effectiveLimits({ maxActionsPerCase: 5 }).maxActionsPerCase).toBe(5);
    expect(effectiveLimits({ maxActionsPerCase: 500 }).maxActionsPerCase).toBe(LIMIT_CEILINGS.maxActionsPerCase);
    expect(effectiveLimits({ maxSteps: 100 }).maxSteps).toBe(LIMIT_CEILINGS.maxSteps);
    expect(effectiveLimits({ maxAutoQuestions: 9 }).maxAutoQuestions).toBe(LIMIT_CEILINGS.maxAutoQuestions);
    expect(effectiveLimits(undefined).maxOutageWorkingDays).toBe(2); // Standard und Obergrenze: höchstens zwei Arbeitstage Ausfall, dann ein Mensch
    expect(effectiveLimits({ maxOutageWorkingDays: 1 }).maxOutageWorkingDays).toBe(1);
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

  it('der Betrieb darf weiter verschärfen (BPF-04), nie lockern; ungültige Angaben zählen nicht', () => {
    expect(effectiveLimits(undefined, { maxActionsPerCase: 5 }).maxActionsPerCase).toBe(5);
    expect(effectiveLimits({ maxActionsPerCase: 4 }, { maxActionsPerCase: 9 }).maxActionsPerCase).toBe(4); // Blueprint ist strenger
    expect(effectiveLimits({ maxActionsPerCase: 9 }, { maxActionsPerCase: 4 }).maxActionsPerCase).toBe(4); // Betrieb ist strenger
    expect(effectiveLimits(undefined, { maxActionsPerCase: 999 }).maxActionsPerCase).toBe(LIMIT_DEFAULTS.maxActionsPerCase); // lockern über den Standard hinaus geht nicht
    expect(effectiveLimits(undefined, { maxActionsPerCase: -3, maxReplans: null }).maxActionsPerCase).toBe(LIMIT_DEFAULTS.maxActionsPerCase);
    expect(effectiveLimits(undefined, { maxReplans: 0 }).maxReplans).toBe(0); // 0 Neuplanungen ist eine gültige Strenge
    // Andere Schlüssel (z. B. Planschritte) kann der Betrieb nicht setzen.
    expect(effectiveLimits(undefined, { maxSteps: 1 } as never).maxSteps).toBe(LIMIT_DEFAULTS.maxSteps);
  });

  it('KI-Kostengrenze je Vorgang (BPF-01): unter der Grenze frei, ab der Grenze Prüfung mit fachlichem Text', () => {
    expect(checkAiCostLimit(5, 4.99)).toEqual({ allowed: true });
    const blocked = checkAiCostLimit(5, 5);
    expect(blocked).toMatchObject({ allowed: false, code: 'LIMIT_AI_COST' });
    expect(blocked.message).toContain('KI-Kosten');
    expect(effectiveLimits(undefined, { maxAiCostPerCase: 1.5 }).maxAiCostPerCase).toBe(1.5);
  });
});
