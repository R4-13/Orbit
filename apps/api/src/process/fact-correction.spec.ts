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
