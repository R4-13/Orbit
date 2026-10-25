import { findPriceQuestion } from './price-question';

describe('Preisfrage in einer Anfrage', () => {
  it('erkennt die Frage im Betreff und im Text und gibt den Satz wörtlich zurück', () => {
    expect(findPriceQuestion('Badezimmer erneuern – was kostet das?', 'Guten Tag, wir möchten ein Komplettbad mit ebenerdiger Dusche.')).toBe('Badezimmer erneuern – was kostet das?');
    expect(findPriceQuestion('Heizung', 'Guten Tag. Wie teuer wird eine neue Wärmepumpe etwa? Viele Grüße')).toBe('Wie teuer wird eine neue Wärmepumpe etwa?');
    expect(findPriceQuestion('Anfrage', 'Wie viel würde der Tausch von vier Heizkörpern kosten?')).toContain('kosten');
    expect(findPriceQuestion('Bad', 'Womit müssten wir preislich rechnen?')).toBe('Womit müssten wir preislich rechnen?');
  });

  it('eine Anfrage ohne Preisfrage liefert nichts', () => {
    expect(findPriceQuestion('Neue Heizung – bitte um Angebot', 'Wir brauchen eine neue Heizung für unser Haus. Bitte schicken Sie uns ein Angebot.')).toBeUndefined();
    expect(findPriceQuestion(null, null)).toBeUndefined();
  });
});
