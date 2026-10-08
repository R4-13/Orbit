import { describe, expect, it } from 'vitest';
import { costLimitApplies, costLimitScopeKey, costLimitState, costPeriodStart, costStateChanges, detectUsageAnomaly, validateCostLimit, type CostLimitDefinition } from './cost-guardrails';

const limit = (over: Partial<CostLimitDefinition> = {}): CostLimitDefinition => ({ scope: 'GLOBAL', warnAmount: 80, softAmount: 100, hardAmount: 150, hardEnforced: false, ...over });

describe('Kosten-Leitplanken (Amendment 03 §12.3)', () => {
  it('Zustand: strengste überschrittene Stufe; die Schwelle selbst zählt als erreicht', () => {
    expect(costLimitState(79.99, limit())).toBe('OK');
    expect(costLimitState(80, limit())).toBe('WARNING');
    expect(costLimitState(100, limit())).toBe('SOFT_EXCEEDED');
    expect(costLimitState(149.99, limit())).toBe('SOFT_EXCEEDED');
    expect(costLimitState(150, limit())).toBe('HARD_EXCEEDED');
    expect(costLimitState(10_000, limit({ warnAmount: null, softAmount: null }))).toBe('HARD_EXCEEDED');
    expect(costLimitState(10_000, limit({ hardAmount: null, softAmount: null }))).toBe('WARNING');
    expect(costLimitState(0, limit())).toBe('OK');
  });

  it('Geltungsbereich: plattformweit für alle, Mandant nur für diesen, Profil nur für dieses; ein Schlüssel je Bereich', () => {
    const call = { tenantId: 't1', profileKey: 'FAST_CLASSIFICATION' };
    expect(costLimitApplies({ scope: 'GLOBAL' }, call)).toBe(true);
    expect(costLimitApplies({ scope: 'TENANT', targetTenantId: 't1' }, call)).toBe(true);
    expect(costLimitApplies({ scope: 'TENANT', targetTenantId: 't2' }, call)).toBe(false);
    expect(costLimitApplies({ scope: 'PROFILE', profileKey: 'FAST_CLASSIFICATION' }, call)).toBe(true);
    expect(costLimitApplies({ scope: 'PROFILE', profileKey: 'COMPLEX_REASONING' }, call)).toBe(false);
    expect(costLimitScopeKey({ scope: 'GLOBAL' })).toBe('GLOBAL');
    expect(costLimitScopeKey({ scope: 'TENANT', targetTenantId: 't1' })).toBe('TENANT:t1');
    expect(costLimitScopeKey({ scope: 'PROFILE', profileKey: 'X' })).toBe('PROFILE:X');
  });

  it('Validierung: Schwellen aufsteigend und positiv, Bereichsangaben passend, Durchsetzung nur mit Hard-Limit', () => {
    expect(validateCostLimit(limit())).toEqual([]);
    expect(validateCostLimit(limit({ warnAmount: 100, softAmount: 100 }))).toContain('Die Schwellen müssen aufsteigen: Warnung < Soft-Limit < Hard-Limit.');
    expect(validateCostLimit(limit({ warnAmount: -1 }))).toContain('Beträge müssen größer als 0 sein.');
    expect(validateCostLimit(limit({ warnAmount: null, softAmount: null, hardAmount: null }))).toContain('Mindestens eine Schwelle (Warnung, Soft- oder Hard-Limit) ist erforderlich.');
    expect(validateCostLimit(limit({ scope: 'TENANT' }))).toContain('Für ein Mandanten-Limit ist ein Mandant anzugeben.');
    expect(validateCostLimit(limit({ scope: 'PROFILE' }))).toContain('Für ein Profil-Limit ist ein Profil anzugeben.');
    expect(validateCostLimit(limit({ targetTenantId: 't1' }))).toContain('Ein Mandant ist nur bei einem Mandanten-Limit zulässig.');
    expect(validateCostLimit(limit({ profileKey: 'X' }))).toContain('Ein Profil ist nur bei einem Profil-Limit zulässig.');
    expect(validateCostLimit(limit({ hardAmount: null, hardEnforced: true }))).toContain('Ein durchgesetztes Limit braucht ein Hard-Limit.');
    expect(validateCostLimit(limit({ hardEnforced: true }))).toEqual([]);
  });

  it('Zeitraum ist der laufende Kalendermonat in UTC', () => {
    expect(costPeriodStart(new Date('2026-10-31T23:59:59Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(costPeriodStart(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('Meldung nur bei Wechsel: kein Alarm im Rahmen, Meldung bei Überschreitung, Verschärfung und Rückkehr; nie doppelt', () => {
    const state = (entries: Array<[string, 'OK' | 'WARNING' | 'SOFT_EXCEEDED' | 'HARD_EXCEEDED']>) => new Map(entries);
    expect(costStateChanges(undefined, [{ limitId: 'a', state: 'OK' }])).toEqual([]);
    expect(costStateChanges(undefined, [{ limitId: 'a', state: 'WARNING' }])).toEqual([{ limitId: 'a', from: null, to: 'WARNING' }]);
    expect(costStateChanges(state([['a', 'WARNING']]), [{ limitId: 'a', state: 'WARNING' }])).toEqual([]);
    expect(costStateChanges(state([['a', 'WARNING']]), [{ limitId: 'a', state: 'HARD_EXCEEDED' }])).toEqual([{ limitId: 'a', from: 'WARNING', to: 'HARD_EXCEEDED' }]);
    expect(costStateChanges(state([['a', 'HARD_EXCEEDED']]), [{ limitId: 'a', state: 'OK' }])).toEqual([{ limitId: 'a', from: 'HARD_EXCEEDED', to: 'OK' }]);
  });

  it('ungewöhnliche Nutzung: deutlich über dem Tagesdurchschnitt UND Mindestmenge; ohne Vergleichsbasis nie', () => {
    const baseline = [100, 90, 110, 100, 95, 105, 100];
    expect(detectUsageAnomaly({ recent: { requests: 450, cost: 9 }, baselineDailyRequests: baseline })).toMatchObject({ anomalous: true, factor: 4.5, baselineAverage: 100 });
    expect(detectUsageAnomaly({ recent: { requests: 250, cost: 5 }, baselineDailyRequests: baseline }).anomalous).toBe(false); // ×2,5: im Schwankungsbereich
    expect(detectUsageAnomaly({ recent: { requests: 300, cost: 6 }, baselineDailyRequests: baseline }).anomalous).toBe(true); // genau ×3
    expect(detectUsageAnomaly({ recent: { requests: 20, cost: 1 }, baselineDailyRequests: [1, 1, 1, 1, 1, 1, 1] }).anomalous).toBe(false); // ×20, aber unter der Mindestmenge
    expect(detectUsageAnomaly({ recent: { requests: 5000, cost: 99 }, baselineDailyRequests: [0, 0, 0, 0, 0, 0, 0] })).toEqual({ anomalous: false, factor: null, baselineAverage: 0 });
    expect(detectUsageAnomaly({ recent: { requests: 5000, cost: 99 }, baselineDailyRequests: [] }).anomalous).toBe(false);
  });
});
