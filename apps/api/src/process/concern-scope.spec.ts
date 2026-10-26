import { belongsToOtherConcern, overlap, type ConcernScope } from './concern-scope';

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
