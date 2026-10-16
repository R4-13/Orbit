import { AGENT_EXPECTATIONS, scoreAgentRecord, summariseAgentRuns, type AgentExpectation, type AgentRecord } from './agent-evaluation';

const record = (over: Partial<AgentRecord> & { id: string }): AgentRecord => ({ triage: {}, case: null, attention: [], mails: [], ...over });
const mail = (body: string) => ({ to: 'kunde@kunde.example', subject: 'Re: x', body });

describe('Bewertung des Agenten', () => {
  it('eine belegte Antwort auf eine Profilfrage besteht', () => {
    const r = record({ id: 'A1', triage: { category: 'GENERAL_INQUIRY' }, case: { status: 'COMPLETED' }, mails: [mail('Ja, wir führen Badsanierungen aus.')] });
    expect(scoreAgentRecord(r)).toMatchObject({ id: 'A1', pass: true });
  });

  it('nennt die gescheiterten Prüfungen mit Grund', () => {
    const r = record({ id: 'A1', triage: { category: 'GENERAL_INQUIRY' }, case: { status: 'MANUAL_REVIEW' }, attention: ['NOTIFY_REQUEST/GENERAL/OPEN'], mails: [] });
    const score = scoreAgentRecord(r);
    expect(score.pass).toBe(false);
    expect(score.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(expect.arrayContaining(['1 Antwort(en) gesendet', 'Vorgang COMPLETED', 'keine Meldung an Menschen']));
  });

  it('Notfall verlangt die Meldung an die Zuständigkeit EMERGENCY und die Einstufung kritisch', () => {
    const ok = record({ id: 'A3', triage: { urgency: 'CRITICAL' }, case: { status: 'MANUAL_REVIEW' }, attention: ['NOTIFY_REQUEST/EMERGENCY/OPEN'] });
    expect(scoreAgentRecord(ok).pass).toBe(true);
    const missed = record({ id: 'A3', triage: { urgency: 'HIGH' }, case: { status: 'MANUAL_REVIEW' }, attention: ['NOTIFY_REQUEST/GENERAL/OPEN'] });
    expect(scoreAgentRecord(missed).checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['Meldung an EMERGENCY', 'Dringlichkeit CRITICAL']);
  });

  it('die englische Frage muss auf Englisch beantwortet werden', () => {
    const base = { id: 'A6', case: { status: 'COMPLETED' } };
    expect(scoreAgentRecord(record({ ...base, mails: [mail('Hello John, thank you. Yes, we do bathroom renovations. Kind regards')] })).pass).toBe(true);
    expect(scoreAgentRecord(record({ ...base, mails: [mail('Guten Tag John, vielen Dank. Ja, renovation. Mit freundlichen Grüßen')] })).pass).toBe(false);
  });

  it('Werbung: kein Vorgang und keine Antwort; ein Fehler zählt als nicht bestanden', () => {
    expect(scoreAgentRecord(record({ id: 'A10', triage: { category: 'NEWSLETTER_OR_MARKETING' }, case: null })).pass).toBe(true);
    expect(scoreAgentRecord(record({ id: 'A10', error: 'Datenbankfehler', triage: { category: 'NEWSLETTER_OR_MARKETING' } })).pass).toBe(false);
    expect(scoreAgentRecord(record({ id: 'A10', triage: { category: 'NEWSLETTER_OR_MARKETING' }, case: { status: 'IN_PROGRESS' } })).pass).toBe(false);
  });

  it('ein Szenario ohne hinterlegte Erwartung besteht nie stillschweigend', () => {
    expect(scoreAgentRecord(record({ id: 'A99' })).pass).toBe(false);
  });

  it('alle Szenarien des Live-Tests haben eine Erwartung', () => {
    expect(Object.keys(AGENT_EXPECTATIONS)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10']);
  });
});

describe('Zusammenfassung über Läufe', () => {
  const expectations: Record<string, AgentExpectation> = { A1: { intent: 'x', mails: 1 }, A2: { intent: 'y', mails: 0 } };
  const run = (a1Mails: number, a2Mails: number): AgentRecord[] => [
    record({ id: 'A1', mails: Array.from({ length: a1Mails }, () => mail('a')) }),
    record({ id: 'A2', mails: Array.from({ length: a2Mails }, () => mail('b')) }),
  ];

  it('zählt bestandene Szenario-Läufe, immer bestandene und gleiche Wege', () => {
    const summary = summariseAgentRuns([run(1, 0), run(1, 1), run(0, 0)], expectations);
    expect(summary.runs).toBe(3);
    expect(summary.scenarios.map((s) => [s.id, s.passed, s.runs])).toEqual([['A1', 2, 3], ['A2', 2, 3]]);
    expect(summary.passRate).toBeCloseTo(4 / 6);
    expect(summary.alwaysPassing).toBe(0);
    expect(summary.stableScenarios).toBe(0);
    expect(summary.scenarios[0]?.failing).toEqual([{ name: '1 Antwort(en) gesendet', runs: 1 }]);
  });

  it('ein einzelner Lauf sagt nichts über die Stabilität', () => {
    const summary = summariseAgentRuns([run(1, 0)], expectations);
    expect(summary.passRate).toBe(1);
    expect(summary.stableScenarios).toBeNull();
  });
});
