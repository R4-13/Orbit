import { findStreetAddress, isAddressKey } from './street-address';

describe('Anschrift in einer Nachricht', () => {
  it('erkennt Straße mit Hausnummer im Wortlaut', () => {
    expect(findStreetAddress('Das Haus steht in Köln, Musterstraße 12.')).toBe('Musterstraße 12');
    expect(findStreetAddress('Die Wohnung ist in der Bahnhofstraße 7 in Bonn.')).toBe('Bahnhofstraße 7');
    expect(findStreetAddress('Wir wohnen im Musterweg 3 in Leverkusen.')).toBe('Musterweg 3');
    expect(findStreetAddress('Wir sind am Rosenweg 3a erreichbar.')).toBe('Rosenweg 3a');
  });

  it('ohne Hausnummer oder ohne Straße nichts', () => {
    expect(findStreetAddress('Wir wohnen in Köln.')).toBeUndefined();
    expect(findStreetAddress('Die Musterstraße ist schön.')).toBeUndefined();
    expect(findStreetAddress('Das Bad hat 6 m².')).toBeUndefined();
    expect(findStreetAddress(null)).toBeUndefined();
  });

  it('erkennt Schlüssel, die eine Anschrift tragen', () => {
    expect(['ai.anschrift', 'ai.address', 'ai.projektadresse', 'ai.strasse'].every(isAddressKey)).toBe(true);
    expect(isAddressKey('ai.standort')).toBe(false);
  });
});
