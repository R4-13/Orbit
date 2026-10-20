import { describe, expect, it } from 'vitest';
import { shouldSegment, splitSentences, verifyConcerns, type ConcernSegmentation } from './concerns';

const MESSAGE = `Guten Tag,
wir ziehen zum 1. Dezember mit der Praxis um. Bitte ändern Sie die Rechnungsanschrift auf Hauptstraße 5.
Außerdem möchten wir einen Wartungsvertrag für unsere Heizung. Was würde der pro Jahr kosten?
Könnten Sie uns zusätzlich den Zählerstand vom letzten Besuch mitteilen?
Viele Grüße
Anna Beispiel`;

const seg = (over: Partial<ConcernSegmentation> = {}): ConcernSegmentation => ({
  concerns: [
    { title: 'Adressänderung', category: 'CUSTOMER_DATA_CHANGE', goal: 'Rechnungsanschrift geändert', excerpt: 'wir ziehen zum 1. Dezember mit der Praxis um. Bitte ändern Sie die Rechnungsanschrift auf Hauptstraße 5.' },
    { title: 'Wartungsvertrag', category: 'REQUEST_FOR_QUOTE', goal: 'Konditionen für Wartungsvertrag genannt', excerpt: 'Außerdem möchten wir einen Wartungsvertrag für unsere Heizung. Was würde der pro Jahr kosten?' },
  ],
  sharedContext: '',
  ...over,
});

describe('Erkennung und Abgrenzung mehrerer Anliegen', () => {
  it('belegt jedes Anliegen am Wortlaut und ergänzt, was niemand zugeordnet hat (Nachweis der Vollständigkeit)', () => {
    const verified = verifyConcerns(MESSAGE, seg());
    expect(verified.concerns.map((c) => c.grounded)).toEqual([true, true, true]);
    const extra = verified.concerns[2]!;
    expect(extra.supplemented).toBe(true);
    expect(extra.excerpt).toContain('Zählerstand');
    expect(verified.coverage.unassigned).toHaveLength(1);
  });

  it('verwendet einen erfundenen Auszug nicht als Beleg', () => {
    const verified = verifyConcerns(MESSAGE, seg({ concerns: [{ title: 'Erfunden', category: 'UNKNOWN', goal: 'x', excerpt: 'Bitte schicken Sie mir sofort einen Monteur nach Hamburg.' }, ...seg().concerns] }));
    expect(verified.concerns[0]!.grounded).toBe(false);
    expect(verified.coverage.ungrounded).toEqual(['Erfunden']);
  });

  it('gemeinsamer Kontext zählt als zugeordnet; Anrede und Gruß nicht als tragende Aussage', () => {
    const verified = verifyConcerns(MESSAGE, seg({ sharedContext: 'Könnten Sie uns zusätzlich den Zählerstand vom letzten Besuch mitteilen?' }));
    expect(verified.concerns).toHaveLength(2);
    expect(verified.coverage.unassigned).toEqual([]);
    expect(splitSentences('- eins.\n2) zwei!')).toEqual(['eins.', 'zwei!']);
  });

  it('Vorprüfung: Kurznachrichten nicht, mehrere Fragen/Bitten ja, Hinweis der Einstufung ja', () => {
    expect(shouldSegment('Wann ist Ihr Büro morgen besetzt? Danke.')).toBe(false);
    expect(shouldSegment(MESSAGE)).toBe(true);
    expect(shouldSegment('Hallo', { multipleIntentsFlag: true })).toBe(true);
    expect(shouldSegment('Bitte rufen Sie mich zurück, es geht um den Termin am Freitag in der Werkstatt, danke und viele Grüße aus Hamburg.')).toBe(false);
  });
});
