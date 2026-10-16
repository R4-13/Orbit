import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, catalogueProblems, checkThresholds, percentile, regressions, scoreCase, sealOf, type CaseResult, type EvaluationCase, type Expectation, type Observation, type Thresholds } from './triage-evaluation';

const FIXTURES = join(__dirname, '../../../../fixtures/evaluation');
const obs = (over: Partial<Observation> = {}): Observation => ({ appliedRelevance: 'BUSINESS_ACTIONABLE', category: 'REQUEST_FOR_QUOTE', urgency: 'NORMAL', relation: 'NEW', riskFlags: [], intentCount: 1, latencyMs: 1000, ...over });
const result = (id: string, expect: Expectation, ...observed: Observation[]): CaseResult => ({
  id,
  label: id,
  expect,
  runs: observed.map((o) => ({ observed: o, ...scoreCase(expect, o) })),
});

describe('Bewertung einer Einstufung', () => {
  it('prüft nur, was erwartet wird', () => {
    const { checks, pass } = scoreCase({ relevance: 'BUSINESS_ACTIONABLE' }, obs({ category: 'IRGENDWAS', urgency: 'CRITICAL' }));
    expect(checks).toEqual({ relevance: true });
    expect(pass).toBe(true);
  });
  it('Relevanz: „Geschäft oder Prüfung“ lässt die Prüfung zu, nie den Ausschluss', () => {
    const e: Expectation = { relevance: 'BUSINESS_OR_REVIEW' };
    expect(scoreCase(e, obs({ appliedRelevance: 'UNKNOWN_REQUIRES_REVIEW' })).pass).toBe(true);
    expect(scoreCase(e, obs({ appliedRelevance: 'NON_ACTIONABLE' })).pass).toBe(false);
    expect(scoreCase({ relevance: 'NOT_BUSINESS_OR_REVIEW' }, obs({ appliedRelevance: 'BUSINESS_ACTIONABLE' })).pass).toBe(false);
  });
  it('Dringlichkeit: Notfall exakt, „hoch oder kritisch“, „nicht kritisch“', () => {
    expect(scoreCase({ relevance: 'BUSINESS_ACTIONABLE', urgency: 'CRITICAL' }, obs({ urgency: 'HIGH' })).checks.urgency).toBe(false);
    expect(scoreCase({ relevance: 'BUSINESS_ACTIONABLE', urgency: 'HIGH_OR_CRITICAL' }, obs({ urgency: 'HIGH' })).checks.urgency).toBe(true);
    expect(scoreCase({ relevance: 'BUSINESS_ACTIONABLE', urgency: 'NOT_CRITICAL' }, obs({ urgency: 'CRITICAL' })).checks.urgency).toBe(false);
  });
  it('Kategorie, Bezug, Flags und mehrere Anliegen', () => {
    const e: Expectation = { relevance: 'BUSINESS_ACTIONABLE', categories: ['A'], relation: 'CONTINUATION', flags: ['X'], multipleIntents: true };
    expect(scoreCase(e, obs({ category: 'A', relation: 'CONTINUATION', riskFlags: ['X'], intentCount: 2 })).pass).toBe(true);
    expect(scoreCase(e, obs({ category: 'B', relation: 'CONTINUATION', riskFlags: ['X'], intentCount: 2 })).checks.category).toBe(false);
    expect(scoreCase(e, obs({ category: 'A', relation: 'NEW', riskFlags: ['X'], intentCount: 2 })).checks.relation).toBe(false);
    expect(scoreCase(e, obs({ category: 'A', relation: 'CONTINUATION', riskFlags: [], intentCount: 2 })).checks.flags).toBe(false);
    expect(scoreCase(e, obs({ category: 'A', relation: 'CONTINUATION', riskFlags: ['X'], intentCount: 1 })).checks.multipleIntents).toBe(false);
  });
});

describe('Kennzahlen', () => {
  const critical: Expectation = { relevance: 'BUSINESS_ACTIONABLE', urgency: 'CRITICAL' };
  const calm: Expectation = { relevance: 'BUSINESS_ACTIONABLE', urgency: 'NOT_CRITICAL' };

  it('Notfallquote, Fehlalarme und ausgeschlossene Kundennachrichten', () => {
    const m = aggregate([
      result('e1', critical, obs({ urgency: 'CRITICAL' })),
      result('e2', critical, obs({ urgency: 'NORMAL' })), // übersehen
      result('c1', calm, obs({ urgency: 'CRITICAL' })), // Fehlalarm
      result('c2', calm, obs({ urgency: 'NORMAL' })),
      result('c3', calm, obs({ urgency: 'NORMAL', appliedRelevance: 'NON_ACTIONABLE' })), // zu Unrecht ausgeschlossen
      result('c4', calm, obs({ urgency: 'NORMAL' })),
    ]);
    expect(m.emergencyRecall).toBe(0.5);
    expect(m.falseAlarmRate).toBeCloseTo(1 / 4);
    expect(m.missedBusinessRate).toBeCloseTo(1 / 6);
    expect(m.passRate).toBeCloseTo(3 / 6, 5); // e1, c2, c4 bestehen
  });

  it('Konsistenz über Wiederholungen: gleiche Kategorie, Relevanz und Dringlichkeit', () => {
    const stable = result('s', calm, obs(), obs(), obs());
    const flaky = result('f', calm, obs(), obs({ category: 'SALES_INQUIRY' }), obs());
    expect(aggregate([stable, flaky]).consistency).toBe(0.5);
    // REQUEST_FOR_QUOTE gegen SALES_INQUIRY führt in denselben Verkaufsweg; nur der Weg zählt bei der Konsistenz des Wegs.
    const sameRoute = result('r', calm, obs({ category: 'REQUEST_FOR_QUOTE', urgency: 'NORMAL' }), obs({ category: 'SALES_INQUIRY', urgency: 'LOW' }));
    expect(aggregate([sameRoute]).consistency).toBe(0);
    expect(aggregate([sameRoute]).routingConsistency).toBe(1);
    expect(aggregate([result('c', calm, obs({ urgency: 'NORMAL' }), obs({ urgency: 'CRITICAL' }))]).routingConsistency).toBe(0); // Notfall ja/nein ändert den Weg
    expect(aggregate([result('one', calm, obs())]).consistency).toBeNull(); // eine Wiederholung sagt nichts über Schwankung
  });

  it('Läufe ohne Ergebnis zählen als nicht bestanden und werden gemeldet', () => {
    const failed: CaseResult = { id: 'x', label: 'x', expect: calm, runs: [{ error: 'Zeitüberschreitung', pass: false }] };
    const m = aggregate([failed, result('ok', calm, obs())]);
    expect(m.failedRuns).toBe(1);
    expect(m.passRate).toBe(0.5);
  });

  it('Antwortzeit: Median und 95. Perzentil', () => {
    expect(percentile([1, 2, 3, 4, 100], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(aggregate([result('a', calm, obs({ latencyMs: 500 }), obs({ latencyMs: 1500 }))]).latencyMs).toEqual({ p50: 500, p95: 1500 });
  });

  it('Gütekriterien und Rückschritt gegenüber einem früheren Lauf', () => {
    const thresholds: Thresholds = { minPassRate: 0.8, minEmergencyRecall: 0.9, maxFalseAlarmRate: 0.1, maxMissedBusinessRate: 0.05, minConsistency: 0.85, maxFailedRuns: 0 };
    const good = aggregate([result('e', critical, obs({ urgency: 'CRITICAL' })), result('c', calm, obs())]);
    expect(checkThresholds(good, thresholds)).toEqual({ ok: true, failures: [] });
    const bad = aggregate([result('e', critical, obs()), result('c', calm, obs({ appliedRelevance: 'NON_ACTIONABLE' }))]);
    const verdict = checkThresholds(bad, thresholds);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toContain('Notfälle erkannt');
    expect(verdict.failures.join(' ')).toContain('Zu Unrecht ausgeschlossene');
    expect(regressions(bad, good)).toEqual(expect.arrayContaining([expect.stringContaining('Notfälle erkannt: 100.0 % → 0.0 %')]));
    expect(regressions(good, good)).toEqual([]);
  });
});

describe('Kataloge', () => {
  const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { cases: EvaluationCase[] };
  const dev = load('triage-catalogue.json').cases;
  const v1Text = readFileSync(join(FIXTURES, 'triage-holdout-v1.json'), 'utf8');
  const v1 = (JSON.parse(v1Text) as { cases: EvaluationCase[] }).cases;
  const v2Text = readFileSync(join(FIXTURES, 'triage-holdout-v2.json'), 'utf8');
  const v2 = (JSON.parse(v2Text) as { cases: EvaluationCase[] }).cases;
  const textsOf = (cases: EvaluationCase[]) => new Set(cases.map((c) => `${c.subject}|${c.body}`));
  const count = (cases: EvaluationCase[], predicate: (c: EvaluationCase) => boolean) => cases.filter(predicate).length;

  it('alle Kataloge sind in sich stimmig und überschneidungsfrei', () => {
    for (const cases of [dev, v1, v2]) expect(catalogueProblems(cases)).toEqual([]);
    expect(dev.filter((d) => v1.some((h) => h.id === d.id))).toEqual([]);
    expect(v2.filter((w) => [...dev, ...v1].some((h) => h.id === w.id))).toEqual([]);
    expect(v1.filter((h) => textsOf(dev).has(`${h.subject}|${h.body}`))).toEqual([]); // kein Fall steht in zwei Sätzen
    expect(v2.filter((w) => textsOf([...dev, ...v1]).has(`${w.subject}|${w.body}`))).toEqual([]);
  });

  it('die versiegelten Prüfsätze sind seit dem ersten Lauf unverändert', () => {
    expect(sealOf(v1Text)).toBe(readFileSync(join(FIXTURES, 'triage-holdout-v1.sha256'), 'utf8').trim());
    expect(sealOf(v2Text)).toBe(readFileSync(join(FIXTURES, 'triage-holdout-v2.sha256'), 'utf8').trim());
  });

  it.each([
    ['holdout-v1', v1, 40],
    ['holdout-v2', v2, 80],
  ])('%s deckt die wichtigen Lagen ab', (_name, holdout, size) => {
    expect(holdout.length).toBeGreaterThanOrEqual(size);
    expect(count(holdout, (c) => c.expect.urgency === 'CRITICAL')).toBeGreaterThanOrEqual(2); // eindeutige Notfälle
    expect(count(holdout, (c) => c.expect.urgency === 'HIGH_OR_CRITICAL')).toBeGreaterThanOrEqual(2); // dringend, aber Auslegungssache
    expect(count(holdout, (c) => c.expect.urgency === 'NOT_CRITICAL' && /DRINGEND|dringend|WICHTIG/.test(`${c.subject} ${c.body}`))).toBeGreaterThanOrEqual(1); // Fehlalarm-Falle
    expect(count(holdout, (c) => c.expect.relevance === 'NOT_BUSINESS' || c.expect.relevance === 'NOT_BUSINESS_OR_REVIEW')).toBeGreaterThanOrEqual(8);
    expect(count(holdout, (c) => c.expect.relation === 'CONTINUATION')).toBeGreaterThanOrEqual(3);
    expect(count(holdout, (c) => c.expect.multipleIntents === true)).toBeGreaterThanOrEqual(1);
    expect(count(holdout, (c) => /ignoriere|ignore|vergiss alle|systemhinweis/i.test(c.body))).toBeGreaterThanOrEqual(2); // Einschleusung
    expect(count(holdout, (c) => /(Hello|Dear|Merhaba|Dzień|Bonjour|Buongiorno|Hola)/.test(c.body))).toBeGreaterThanOrEqual(4); // andere Sprachen
    for (const category of ['REQUEST_FOR_QUOTE', 'GENERAL_INQUIRY', 'COMPLAINT_OR_SERVICE', 'APPLICATION', 'INVOICE_RECEIVED', 'SUPPLIER_OFFER', 'NEWSLETTER_OR_MARKETING']) {
      expect(count(holdout, (c) => c.expect.categories?.includes(category) ?? false)).toBeGreaterThanOrEqual(1);
    }
  });

  it('holdout-v2 prüft die Randfälle, die der Satz v1 aufgezeigt hat, mit mehreren Fällen', () => {
    expect(count(v2, (c) => c.expect.categories?.includes('SUPPLIER_OFFER') ?? false)).toBeGreaterThanOrEqual(5); // persönliche Angebote und Massenwerbung
    expect(count(v2, (c) => c.expect.categories?.includes('APPLICATION') ?? false)).toBeGreaterThanOrEqual(5);
    expect(count(v2, (c) => c.hints?.autoGenerated === true)).toBeGreaterThanOrEqual(4);
  });
});
