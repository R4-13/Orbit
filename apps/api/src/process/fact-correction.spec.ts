import { contentWords, cueSentences, numericReplacements, type AnchoredNumber } from './fact-correction.service';

const bad: AnchoredNumber = { key: 'bathroom.area_m2', value: 7, anchors: contentWords('bathroom area m2 Mein Bad hat ca. 7 m²'), unit: 'm2' };
const kueche: AnchoredNumber = { key: 'kitchen.area_m2', value: 7, anchors: contentWords('kitchen area m2 Die Küche im Erdgeschoss hat 7 m²'), unit: 'm2' };
const heizung: AnchoredNumber = { key: 'heating.power_kw', value: 7, anchors: contentWords('heating power kw Die Heizung hat 7 kW'), unit: 'kw' };

describe('Korrektur „nicht A, sondern B“: die Zuordnung hängt nicht allein am Zahlenwert', () => {
  it('ordnet der Angabe zu, deren Gegenstand der Satz nennt, auch wenn mehrere Angaben denselben Wert haben', () => {
    const update = numericReplacements('Die Küche hat doch nicht 7 m², sondern 9 m².', [bad, kueche]);
    expect(update.map((u) => [u.key, u.newValue])).toEqual([['kitchen.area_m2', 9]]);
    const bath = numericReplacements('Das Bad hat doch nicht 7 m², sondern 12 m², weil die Abstellkammer dazukommt.', [bad, kueche]);
    expect(bath.map((u) => [u.key, u.newValue])).toEqual([['bathroom.area_m2', 12]]);
  });

  it('gleiche Zahl für einen anderen Gegenstand oder eine andere Einheit ändert nichts', () => {
    expect(numericReplacements('Das Gästezimmer hat nicht 7 m², sondern 12 m².', [bad, kueche])).toEqual([]); // kein bekannter Gegenstand passt
    expect(numericReplacements('Die Heizung hat nicht 7 m², sondern 12 m².', [heizung])).toEqual([]); // Einheit passt nicht (kW ≠ m²)
    expect(numericReplacements('Es sind nicht 7 kW, sondern 11 kW.', [bad, heizung]).map((u) => u.key)).toEqual(['heating.power_kw']);
  });

  it('ohne erkennbaren Gegenstand nur bei genau einer passenden Angabe; sonst keine geratene Änderung', () => {
    expect(numericReplacements('Es sind nicht 7, sondern 12.', [bad]).map((u) => u.key)).toEqual(['bathroom.area_m2']);
    expect(numericReplacements('Es sind nicht 7, sondern 12.', [bad, kueche])).toEqual([]);
  });
});

describe('Sätze mit Korrekturhinweis', () => {
  it('liefert den Satz mit dem Hinweis und den folgenden, nichts bei fehlendem Hinweis', () => {
    expect(cueSentences('Guten Tag. Ich muss mich korrigieren: Das Bad hat nicht 7 m², sondern 12 m². Die Wand fällt weg. Noch etwas.')).toContain('Die Wand fällt weg.');
    expect(cueSentences('Alles in Ordnung, danke.')).toBeUndefined();
  });
});

describe('Korrektur unter Vorbehalt: Ähnlichkeit des Satzbaus ersetzt keine Bedeutung (Funktionsnachweis 23.10.)', () => {
  it('eine Bedingung, Vermutung oder Alternative macht aus „nicht A, sondern B“ keine feste Änderung', () => {
    expect(numericReplacements('Das Bad hat nicht 7 m², sondern 12 m², falls die Abstellkammer dazukommt.', [bad])).toEqual([]);
    expect(numericReplacements('Das Bad hat nicht 7 m², sondern vermutlich 12 m².', [bad])).toEqual([]);
    expect(numericReplacements('Das Bad hat nicht 7 m², sondern 12 oder 13 m².', [bad])).toEqual([]);
    expect(numericReplacements('Das Bad hat nicht 7 m², sondern höchstens 12 m².', [bad])).toEqual([]);
  });

  it('„nicht nur A, sondern B“ ist eine Erweiterung, kein Ersatz', () => {
    expect(numericReplacements('Das Bad hat nicht nur 7 m², sondern 12 m² mit Abstellraum.', [bad])).toEqual([]);
  });

  it('der feste Ersatz bleibt erkannt', () => {
    expect(numericReplacements('Das Bad hat nicht 7 m², sondern 12 m².', [bad]).map((u) => [u.key, u.newValue])).toEqual([['bathroom.area_m2', 12]]);
  });
});

describe('Korrektur einer Zahl innerhalb eines Textwerts (Funktionsnachweis 23.10., Ablauf B1)', () => {
  const heizung: AnchoredNumber = { key: 'ai.existing_heating', value: 'Gasheizung von 1985', anchors: contentWords('ai existing heating Gasheizung von 1985 Die vorhandene Heizung ist eine Gasheizung von 1985') };
  const baujahr: AnchoredNumber = { key: 'ai.building_year', value: 'Baujahr 1985', anchors: contentWords('ai building year Baujahr 1985 Das Haus ist Baujahr 1985') };

  it('ersetzt nur die Zahl im Text, der Rest bleibt', () => {
    const update = numericReplacements('Entschuldigung, die vorhandene Heizung ist nicht von 1985, sondern von 1995.', [heizung]);
    expect(update.map((u) => [u.key, u.newValue])).toEqual([['ai.existing_heating', 'Gasheizung von 1995']]);
  });

  it('ordnet nach Gegenstand zu, wenn zwei Textwerte dieselbe Zahl tragen', () => {
    const update = numericReplacements('Die Heizung ist nicht von 1985, sondern von 1995.', [heizung, baujahr]);
    expect(update.map((u) => u.key)).toEqual(['ai.existing_heating']);
  });

  it('eine Zahl, die im Text nur als Teil einer größeren Zahl vorkommt, wird nicht ersetzt', () => {
    const fremd: AnchoredNumber = { key: 'ai.note', value: 'Bestellnummer 119850', anchors: contentWords('ai note Bestellnummer 119850') };
    expect(numericReplacements('Das ist nicht 1985, sondern 1995.', [fremd])).toEqual([]);
  });

  it('unter Vorbehalt keine automatische Änderung', () => {
    expect(numericReplacements('Die Heizung ist nicht von 1985, sondern vermutlich von 1995.', [heizung])).toEqual([]);
  });
});

describe('Meilenstein B: Textwerte bleiben bei einer Korrektur erhalten, Zahlwörter werden erkannt', () => {
  const heizungText: AnchoredNumber = { key: 'ai.vorhandene_heizung', value: 'Gasheizung von 1985', anchors: contentWords('ai vorhandene heizung Gasheizung von 1985 Die vorhandene Heizung ist eine Gasheizung von 1985'), };
  const heizkoerper: AnchoredNumber = { key: 'ai.anzahl_heizkoerper', value: 'vier', anchors: contentWords('ai anzahl heizkoerper vier Es sind vier Heizkörper: Wohnzimmer, Schlafzimmer, Küche und Bad.') };
  const flaeche: AnchoredNumber = { key: 'ai.flaeche', value: '6 m²', anchors: contentWords('ai flaeche 6 m² Das Bad hat 6 m²'), unit: 'm2' };

  it('ersetzt in einem Textwert nur die Zahl: aus „Gasheizung von 1985“ wird „Gasheizung von 1995“, nicht „1995“', () => {
    const update = numericReplacements('Eine Korrektur: Die vorhandene Heizung ist nicht von 1985, sondern von 1995.', [heizungText]);
    expect(update.map((u) => [u.key, u.newValue])).toEqual([['ai.vorhandene_heizung', 'Gasheizung von 1995']]);
  });

  it('ersetzt ein Zahlwort („nicht vier, sondern sechs Heizkörper“) und lässt den Rest des Wertes stehen', () => {
    const update = numericReplacements('Es sind nicht vier, sondern sechs Heizkörper – das Kinderzimmer und der Flur kommen dazu.', [heizkoerper]);
    expect(update.map((u) => [u.key, u.newValue])).toEqual([['ai.anzahl_heizkoerper', 'sechs']]);
  });

  it('ersetzt einen Flächenwert mit Einheit im Text', () => {
    const update = numericReplacements('Das Bad hat nicht 6 m², sondern 7 m².', [flaeche]);
    expect(update.map((u) => [u.key, u.newValue])).toEqual([['ai.flaeche', '7 m²']]);
  });
});
