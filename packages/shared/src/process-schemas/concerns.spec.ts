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

describe('Belegung leicht gekürzter Auszüge', () => {
  const message = 'Viertens: Sind Sie samstags telefonisch erreichbar? Fünftens tropft im Gäste-WC der Wasserhahn, bitte um einen Reparaturtermin.';
  it('ein gekürzter Auszug mit denselben Wörtern in derselben Reihenfolge ist belegt und erzeugt kein doppeltes Anliegen', () => {
    const verified = verifyConcerns(message, {
      concerns: [
        { title: 'Erreichbarkeit', category: 'UNKNOWN', goal: 'Erreichbarkeit genannt', excerpt: 'Samstags telefonisch erreichbar?' },
        { title: 'Wasserhahn', category: 'UNKNOWN', goal: 'Reparaturtermin', excerpt: 'Fünftens tropft im Gäste-WC der Wasserhahn, bitte um einen Reparaturtermin.' },
      ],
      sharedContext: '',
    });
    expect(verified.concerns.map((c) => c.grounded)).toEqual([true, true]);
    expect(verified.concerns).toHaveLength(2);
  });
  it('ein erfundener oder umgestellter Auszug bleibt unbelegt', () => {
    const verified = verifyConcerns(message, { concerns: [{ title: 'x', category: 'UNKNOWN', goal: 'x', excerpt: 'Erreichbar telefonisch samstags Sie' }, { title: 'y', category: 'UNKNOWN', goal: 'y', excerpt: 'Wir brauchen sofort einen Monteur in Hamburg' }], sharedContext: '' });
    expect(verified.concerns.slice(0, 2).map((c) => c.grounded)).toEqual([false, false]);
  });
});
