import { buildHandoffSummary, type HandoffInput } from './handoff-summary';
import type { AnalysisResult } from './request-analysis';

const analysis: AnalysisResult = {
  requestType: 'Wärmepumpe',
  summary: 'Ersatz einer Gasheizung durch eine Wärmepumpe im Einfamilienhaus in Köln-Porz; Angebot und Besichtigung gewünscht.',
  known: [
    { key: 'ai.living_area', label: 'Wohnfläche', value: '140 m²', evidence: '140 m²', confidence: 1 },
    { key: 'ai.existing_heating', label: 'Bestehende Heizung', value: 'Gasheizung, Baujahr 2003', evidence: 'x', confidence: 1 },
  ],
  requirements: [
    { key: 'ai.living_area', label: 'Wohnfläche', question: 'Wie groß ist die Wohnfläche?', type: 'string', blocking: true },
    { key: 'ai.hot_water', label: 'Warmwasser über die Wärmepumpe', question: 'Soll die Wärmepumpe auch das Warmwasser übernehmen?', type: 'string', blocking: true },
    { key: 'ai.gas_use', label: 'Jährlicher Gasverbrauch', question: 'Wie hoch war der jährliche Gasverbrauch?', type: 'string', blocking: false },
  ],
  siteVisit: { recommended: true, reason: 'Auslegung braucht die Gegebenheiten vor Ort' },
  nextStep: 'PROPOSE_SITE_VISIT',
  rejected: [],
};

const base: HandoffInput = {
  customer: { name: 'Tom Orbit', email: 'tom@kunde.example' },
  title: 'Anfrage Wärmepumpe',
  receivedAt: new Date('2026-10-17T11:12:00Z'),
  timeZone: 'Europe/Berlin',
  analysis,
  facts: [
    { key: 'contact.email', value: 'tom@kunde.example' },
    { key: 'ai.living_area', value: '140 m²' },
    { key: 'ai.existing_heating', value: 'Gasheizung, Baujahr 2003' },
  ],
};

describe('Übergabe-Zusammenfassung', () => {
  it('trennt Vorliegendes und Offenes, ohne etwas zu ergänzen', () => {
    const summary = buildHandoffSummary(base);
    expect(summary.known).toEqual([
      { label: 'Wohnfläche', value: '140 m²' },
      { label: 'Bestehende Heizung', value: 'Gasheizung, Baujahr 2003' },
    ]);
    expect(summary.open).toEqual(['Soll die Wärmepumpe auch das Warmwasser übernehmen?', 'Wie hoch war der jährliche Gasverbrauch?']);
    expect(summary.text).toContain('Kundschaft: Tom Orbit <tom@kunde.example>');
    expect(summary.text).toContain('Anliegen: Anfrage Wärmepumpe'); // die Bezeichnung des Vorgangs; die Kurzfassung der ersten Nachricht steht nicht darin (sie widersprach dem späteren Stand)
    expect(summary.text).not.toContain('Köln-Porz');
    expect(summary.text).toContain('- Wohnfläche: 140 m²');
    expect(summary.text).toContain('Noch offen:\n- Soll die Wärmepumpe auch das Warmwasser übernehmen?');
    expect(summary.text).not.toContain('contact.email'); // interne Marker erscheinen nicht
  });

  it('nach den Antworten rücken Fragen in die Angaben, weitere bestätigte Angaben kommen mit lesbarer Bezeichnung dazu', () => {
    const summary = buildHandoffSummary({ ...base, facts: [...base.facts, { key: 'ai.hot_water', value: 'ja' }, { key: 'ai.gas_use', value: '18.000 kWh' }, { key: 'ai.roof_type', value: 'Satteldach' }] });
    expect(summary.open).toEqual([]);
    expect(summary.known.map((k) => k.label)).toEqual(['Wohnfläche', 'Warmwasser über die Wärmepumpe', 'Jährlicher Gasverbrauch', 'Bestehende Heizung', 'Roof type']);
    expect(summary.text).not.toContain('Noch offen');
  });

  it('Termin: gebucht, Wunsch der Kundschaft oder noch offen – jeweils eindeutig', () => {
    const booked = buildHandoffSummary({ ...base, appointment: { booked: { kind: 'SITE_VISIT', start: '2026-10-21T08:00:00Z', assignee: 'Ben Monteur' } } });
    expect(booked.text).toMatch(/Termin: Vor-Ort-Termin gebucht für .*21\. Oktober 2026.*10:00.*zuständig: Ben Monteur/);
    const wish = buildHandoffSummary({ ...base, appointment: { agreed: 'Dienstag oder Donnerstag vormittags' } });
    expect(wish.text).toContain('noch nicht gebucht. Antwort/Wunsch der Kundschaft: „Dienstag oder Donnerstag vormittags“');
    const none = buildHandoffSummary(base);
    expect(none.text).toContain('Ein Vor-Ort-Termin ist sinnvoll (Auslegung braucht die Gegebenheiten vor Ort); noch kein Termin vereinbart.');
    const noVisit = buildHandoffSummary({ ...base, analysis: { ...analysis, siteVisit: { recommended: false, reason: '' }, nextStep: 'ASK_CUSTOMER' } });
    expect(noVisit.text).not.toContain('Termin:');
  });

  it('ohne Analyse und ohne Namen bleibt es sachlich und vollständig', () => {
    const summary = buildHandoffSummary({ customer: { email: 'a@b.example' }, title: 'Frage zur Heizung', receivedAt: base.receivedAt, timeZone: 'Europe/Berlin', facts: [{ key: 'request.quantity', value: 4 }] });
    expect(summary.text).toContain('Kundschaft: <a@b.example>');
    expect(summary.text).toContain('Anliegen: Frage zur Heizung');
    expect(summary.known).toEqual([{ label: 'Quantity', value: '4' }]);
  });
});

describe('Übergabe-Zusammenfassung widerspricht den strukturierten Angaben nicht (Meilenstein B)', () => {
  it('der Text enthält nur aktuelle Werte: eine korrigierte Angabe steht einmal, mit dem neuen Wert; Ergänzungen sind als solche bezeichnet', () => {
    const summary = buildHandoffSummary({
      ...base,
      facts: [
        { key: 'contact.email', value: 'tom@kunde.example' },
        { key: 'ai.existing_heating', value: 'Gasheizung von 1995' },
        { key: 'ai.existing_heating.ergaenzung.ab12cd34', value: 'mit Speicher im Keller' },
        { key: 'korrekturhinweis.ergaenzung.ef56gh78', value: 'Die Fläche stimmt so nicht' },
      ],
    });
    expect(summary.text).toContain('- Bestehende Heizung: Gasheizung von 1995');
    expect(summary.text).not.toContain('2003');
    expect(summary.text).toContain('- Ergänzung zu Bestehende Heizung: mit Speicher im Keller');
    expect(summary.text).not.toContain('korrekturhinweis');
  });

  it('eine ungeklärte Korrektur steht ausdrücklich als ungeklärt im Text', () => {
    const summary = buildHandoffSummary({ ...base, openCorrections: ['Die Fläche stimmt so nicht'] });
    expect(summary.text).toContain('Ungeklärt – angekündigte Änderung der Kundschaft:');
  });
});
