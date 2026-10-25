/**
 * Erkennt eine Anschrift (Straße mit Hausnummer) im Text einer Nachricht – rein, ohne KI, der Wortlaut wird übernommen. Eine genannte Anschrift ist für ein Angebot oder einen Termin wesentlich und darf nicht
 * davon abhängen, ob die Auslese sie unter einem passenden Schlüssel meldet (Meilenstein B: „Köln, Musterstraße 12“ landete nur mit „Köln“ im Lead).
 */
const STREET = /\b((?:[A-ZÄÖÜ][\p{L}.-]*\s)?[A-ZÄÖÜ][\p{L}-]*(?:straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer|pfad|chaussee)\s+\d{1,4}\s?[a-z]?)(?![\p{L}\d])/u;

/** Die erste Anschrift im Text (z. B. „Musterstraße 12“, „Am Rosenweg 3a“), sonst `undefined`. */
export function findStreetAddress(text: string | null | undefined): string | undefined {
  const found = STREET.exec(text ?? '');
  return found ? found[1]!.replace(/\s+/g, ' ').trim() : undefined;
}

/** Schlüssel, die eine Anschrift tragen (so benennen Analyse und Auslese sie): ist eine davon belegt, wird keine zweite angelegt. */
export const isAddressKey = (key: string): boolean => /(anschrift|adresse|address|strasse|straße)/i.test(key);
