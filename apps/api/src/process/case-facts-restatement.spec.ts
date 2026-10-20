import { isRestatement } from './case-facts.service';

describe('Dieselbe Aussage in anderen Worten ist kein Widerspruch', () => {
  it('der kürzere Text steht als Wortfolge im längeren', () => {
    expect(isRestatement('8 m²', '8 m², nicht 7')).toBe(true);
    expect(isRestatement('ca. 7 m²', '7 m²')).toBe(true);
    expect(isRestatement('Kölner Straße 12', 'Die Räume sind in der Kölner Straße 12 in Köln')).toBe(true);
  });
  it('andere Werte, Zahlen und Nicht-Texte bleiben im Widerspruch', () => {
    expect(isRestatement('7 m²', '17 m²')).toBe(false);
    expect(isRestatement('8 m²', '12 m²')).toBe(false);
    expect(isRestatement('vor der Eröffnung am 3. Februar', 'Der Prüfer kommt am 29. Januar')).toBe(false);
    expect(isRestatement(7, 8)).toBe(false);
    expect(isRestatement('', 'x')).toBe(false);
  });
});

describe('Zusätzliche Zahlen machen aus dem Umschreiben eine andere Angabe', () => {
  it('„7 m²“ vs. „nicht 7 m², sondern 12“ ist ein Widerspruch (die 12 darf nicht verloren gehen); „8 m²“ vs. „8 m², nicht 7“ ist keiner', () => {
    expect(isRestatement('7 m²', 'nicht 7 m², sondern 12 m²')).toBe(false);
    expect(isRestatement('8 m²', '8 m², nicht 7')).toBe(true);
    expect(isRestatement('Kölner Straße 12', 'Kölner Straße 12 in 50667 Köln')).toBe(false); // zusätzliche PLZ → andere (genauere) Angabe, bleibt sichtbar
  });
});
