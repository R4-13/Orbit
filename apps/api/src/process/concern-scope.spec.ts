import { belongsToOtherConcern, belongsToOwnConcern, mentionsOtherConcern, overlap, type ConcernScope } from './concern-scope';

const scope: ConcernScope = {
  own: 'Kopie der letzten Rechnung für die Steuer erhalten. Erstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer.',
  siblings: ['Wartungstermin vom 28.10. auf den 4.11. verschieben', 'Angebot für einen neuen Heizungsregler erhalten'],
};

describe('Zuordnung zu einem Anliegen', () => {
  it('erkennt Aussagen, die zu einem Geschwister-Anliegen gehören', () => {
    expect(belongsToOtherConcern('Welchen Heizungsregler (Hersteller, Modell) möchten Sie anbieten lassen?', scope)).toBe(true);
    expect(belongsToOtherConcern('Auf welchen Termin soll die Wartung verschoben werden?', scope)).toBe(true);
    expect(belongsToOtherConcern('Ich möchte ein Angebot für einen neuen Heizungsregler.', scope)).toBe(true);
  });

  it('lässt Aussagen zum eigenen Anliegen und neutrale Aussagen stehen', () => {
    expect(belongsToOtherConcern('Welche Rechnung brauchen Sie als Kopie (Rechnungsnummer oder Monat)?', scope)).toBe(false);
    expect(belongsToOtherConcern('Eine Kopie meiner letzten Rechnung für die Steuer erhalten.', scope)).toBe(false);
    expect(belongsToOtherConcern('Eingang bestätigen', scope)).toBe(false);
  });

  it('ohne Geschwister gehört nichts zu einem anderen Anliegen; Überschneidung zählt Stämme (Zusammensetzungen)', () => {
    expect(belongsToOtherConcern('Heizungsregler', { own: 'Rechnung', siblings: [] })).toBe(false);
    expect(overlap('Heizungsregler', 'Angebot für einen neuen Heizungsregler')).toBeGreaterThan(0);
  });
});

describe('Vermischte Aussagen', () => {
  const own: ConcernScope = { own: 'Kopie der letzten Rechnung für die Steuer erhalten', siblings: ['Wartungstermin vom 28.10. auf den 4.11. verschieben', 'Ein Angebot für einen neuen Heizungsregler erhalten'] };
  it('eine Aufgabe, die Gegenstände eines Geschwisters nennt, vermischt die Anliegen', () => {
    expect(mentionsOtherConcern('Rechnungskopie bereitstellen und Terminverschiebung bearbeiten', own)).toBe(true);
    expect(mentionsOtherConcern('Letzte Rechnung ermitteln und Kopie bereitstellen', own)).toBe(false);
    expect(mentionsOtherConcern('Angebot für den Regler prüfen', own)).toBe(true);
  });
});

describe('gemeinsame Kundenantwort (Meilenstein C)', () => {
  const termin: ConcernScope = {
    own: 'Den Wartungstermin vom 28.10. auf den 4.11. verschieben. zweitens möchte ich den Wartungstermin vom 28.10. auf den 4.11. verschieben',
    siblings: ['Eine Kopie der letzten Rechnung für die Steuer erhalten.', 'Ein Angebot für einen neuen Heizungsregler erhalten.'],
  };
  const rechnung: ConcernScope = { own: 'Eine Kopie der letzten Rechnung für die Steuer erhalten. erstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer', siblings: [termin.own, 'Ein Angebot für einen neuen Heizungsregler erhalten.'] };
  it('ordnet die Sätze der Antwort dem Anliegen zu, über dessen Gegenstand sie sprechen', () => {
    expect(belongsToOwnConcern('Zum Termin: der Wartungstermin war bei Herrn Weber.', termin)).toBe(true);
    expect(belongsToOwnConcern('Zum Termin: der Wartungstermin war bei Herrn Weber.', rechnung)).toBe(false);
    expect(belongsToOwnConcern('Zur Rechnung: es ist die vom September.', rechnung)).toBe(true);
    expect(belongsToOwnConcern('Zur Rechnung: es ist die vom September.', termin)).toBe(false);
    expect(belongsToOwnConcern('Zum Termin: der Wartungstermin', termin)).toBe(true);
  });
});
