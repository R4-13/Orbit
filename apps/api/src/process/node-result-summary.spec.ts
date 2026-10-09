import { summarizeNodeResult } from './node-result-summary';

describe('Ergebnis eines Schritts in Worten', () => {
  const resolved = {
    complete: false,
    missing: [{ key: 'ai.daemmung', question: 'Wie ist das Gebäude gedämmt?' }, { key: 'appointment.agreed', question: 'Welcher der vorgeschlagenen Termine passt Ihnen?' }],
    internalMissing: [{ key: 'appointment.outcome', question: 'Ergebnis des Vor-Ort-Termins (Aufmaß, Befund)' }],
    analysis: { requestType: 'Heizungstausch im Einfamilienhaus', summary: 'Tausch der Ölheizung gegen eine Wärmepumpe.', nextStep: 'PROPOSE_SITE_VISIT', siteVisit: { recommended: true, reason: 'Aufstellfläche muss geprüft werden.' } },
  };

  it('Anforderungsprüfung mit KI-Analyse: Art der Anfrage, Verständnis, gewählter nächster Schritt mit Grund, was erfragt und was intern nachgetragen wird', () => {
    expect(summarizeNodeResult('requirements.resolve', resolved)).toEqual([
      'Anfrage erkannt als: Heizungstausch im Einfamilienhaus.',
      'So wurde sie verstanden: Tausch der Ölheizung gegen eine Wärmepumpe.',
      'Gewählter nächster Schritt: Einen Vor-Ort-Termin vorschlagen. Grund: Aufstellfläche muss geprüft werden.',
      'Wird erfragt (2): Wie ist das Gebäude gedämmt? · Welcher der vorgeschlagenen Termine passt Ihnen?',
      'Intern nachzutragen: Ergebnis des Vor-Ort-Termins (Aufmaß, Befund)',
    ]);
  });

  it('ohne KI-Analyse sagt es ehrlich, dass nur die festen Regeln geprüft haben', () => {
    const lines = summarizeNodeResult('requirements.resolve', { ...resolved, analysis: null, internalMissing: [] });
    expect(lines[0]).toBe('Geprüft nach den festen Regeln des Prozesses (keine KI-Analyse der Anfrage).');
  });

  it('sind alle Angaben da, steht das so da', () => {
    expect(summarizeNodeResult('requirements.resolve', { complete: true, missing: [], internalMissing: [], analysis: null })).toContain('Alle benötigten Angaben liegen vor.');
  });

  it('Rückfrage-Entwurf: nennt, ob die Zeiten aus dem Kalender stammen oder um Terminwünsche gebeten wird', () => {
    expect(summarizeNodeResult('communication.draft', { appointment: { kind: 'SITE_VISIT', source: 'GOOGLE_CALENDAR', slotCount: 3 } })).toEqual(['Terminvorschlag: Vor-Ort-Termin – 3 freie Zeiten aus dem verbundenen Kalender in der Nachricht.']);
    expect(summarizeNodeResult('communication.draft', { appointment: { kind: 'PHONE_CALL', source: 'NONE', slotCount: 0 } })).toEqual(['Terminvorschlag: Telefontermin – keine Kalenderzeiten verfügbar, die Nachricht bittet um Terminwünsche.']);
    expect(summarizeNodeResult('communication.draft', { draftId: 'x' })).toEqual([]);
  });

  it('unbekannte Fähigkeiten und fehlende Ausgaben ergeben nichts (nie der Roh-Output)', () => {
    expect(summarizeNodeResult('pricing.resolve', { lines: [{ sku: 'X' }] })).toEqual([]);
    expect(summarizeNodeResult('requirements.resolve', null)).toEqual([]);
    expect(summarizeNodeResult(undefined, resolved)).toEqual([]);
  });
});
