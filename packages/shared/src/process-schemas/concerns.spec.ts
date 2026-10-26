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

describe('Gekürzte Auszüge: es zählt der Originalsatz, nie der verkürzte Text', () => {
  const msg = 'Wir möchten die Heizung tauschen, aber nicht vor dem Winter. Das Gäste-WC im Erdgeschoss hat einen tropfenden Wasserhahn. Termin am 4.11. wäre möglich, wenn der Monteur vormittags kommt.';
  const one = (excerpt: string) => verifyConcerns(msg, { concerns: [{ title: 't', category: 'UNKNOWN', goal: 'g', excerpt }], sharedContext: '' }).concerns[0]!;

  it('eine ausgelassene Verneinung ändert die Bedeutung nicht: verwendet wird der vollständige Originalsatz', () => {
    const concern = one('Wir möchten die Heizung tauschen');
    expect(concern.grounded).toBe(true);
    expect(concern.excerpt).toBe('Wir möchten die Heizung tauschen, aber nicht vor dem Winter.');
  });

  it('eine ausgelassene Zuordnung (Gäste-WC) und eine ausgelassene Bedingung („wenn … vormittags“) bleiben im Originalsatz', () => {
    expect(one('tropfenden Wasserhahn').excerpt).toBe('Das Gäste-WC im Erdgeschoss hat einen tropfenden Wasserhahn.');
    expect(one('Termin am 4.11. wäre möglich').excerpt).toBe('Termin am 4.11. wäre möglich, wenn der Monteur vormittags kommt.');
  });

  it('Wörter aus verschiedenen Sätzen ergeben keinen Beleg; hinzugefügte oder umgestellte Wörter ebenso nicht', () => {
    expect(one('Heizung tauschen tropfenden Wasserhahn').grounded).toBe(false); // zwei Sätze zusammengezogen
    expect(one('Wir möchten die Heizung sofort tauschen').grounded).toBe(false); // „sofort“ steht nicht in der Nachricht
    expect(one('Wasserhahn tropfenden einen hat').grounded).toBe(false); // umgestellt
  });

  it('ein Datum mit Punkt trennt keinen Satz (4.11. wäre möglich …)', () => {
    expect(splitSentences('Der Termin am 28.10. wird auf den 4.11. verschoben. Danke.')).toEqual(['Der Termin am 28.10. wird auf den 4.11. verschoben.', 'Danke.']);
  });
});

describe('Zerlegung: verstümmelte Auszüge und Floskeln (Messlauf 21.10.)', () => {
  const FIVE = `Guten Tag,
ich habe fünf Anliegen: Erstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer. Zweitens möchte ich den Wartungstermin vom 28.10. auf den 4.11. verschieben. Viertens: Sind Sie samstags telefonisch erreichbar?
Danke, Tom Orbit`;

  it('ein Auszug mit Zeichenfehlern der KI gilt als belegt und erzeugt kein doppeltes Restanliegen', () => {
    const verified = verifyConcerns(FIVE, {
      concerns: [
        { title: 'Rechnung', category: 'GENERAL_INQUIRY', goal: 'Kopie der Rechnung', excerpt: 'Erstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer.' },
        { title: 'Wartungstermin', category: 'GENERAL_INQUIRY', goal: 'Termin verschieben', excerpt: 'Zweitens möchte ich den Wartungstermin vom 28.10. auf den 4.11. verschieben.' },
        { title: 'Erreichbarkeit', category: 'GENERAL_INQUIRY', goal: 'Erreichbarkeit erfahren', excerpt: 'Viertens: Sind Sie samstags\nt telefon isch erreichbar?' },
      ],
      sharedContext: '',
    });
    expect(verified.concerns.map((c) => c.grounded)).toEqual([true, true, true]);
    expect(verified.concerns.some((c) => c.supplemented)).toBe(false);
    expect(verified.concerns[2]!.excerpt).toContain('Viertens: Sind Sie samstags telefonisch erreichbar?'); // der volle Originalsatz
  });

  it('ein erfundener Auszug wird auch mit der unscharfen Prüfung nicht belegt', () => {
    const verified = verifyConcerns(FIVE, { concerns: [{ title: 'X', category: 'UNKNOWN', goal: 'g', excerpt: 'Bitte schicken Sie uns sofort die komplette Preisliste für alle Produkte zu.' }], sharedContext: '' });
    expect(verified.concerns[0]!.grounded).toBe(false);
  });

  it('Gruß und Dank sind kein Anliegen; Dank mit echter Bitte schon', () => {
    const only = verifyConcerns('Guten Tag,\nbitte rufen Sie mich wegen der Heizung zurück.\nVielen Dank im Voraus, Tom Orbit', { concerns: [{ title: 'Rückruf', category: 'UNKNOWN', goal: 'Rückruf', excerpt: 'bitte rufen Sie mich wegen der Heizung zurück.' }], sharedContext: '' });
    expect(only.concerns.some((c) => c.supplemented)).toBe(false);
    const withRequest = verifyConcerns('Guten Tag,\nbitte rufen Sie mich wegen der Heizung zurück.\nDanke und bitte schicken Sie mir noch die Rechnung vom letzten Einsatz.', { concerns: [{ title: 'Rückruf', category: 'UNKNOWN', goal: 'Rückruf', excerpt: 'bitte rufen Sie mich wegen der Heizung zurück.' }], sharedContext: '' });
    expect(withRequest.concerns.find((c) => c.supplemented)?.excerpt).toContain('Rechnung vom letzten Einsatz');
  });
});

describe('umgebrochene Sätze (Meilenstein C)', () => {
  it('ein Zeilenumbruch mitten im Satz ist keine Satzgrenze, auch vor einem Hauptwort', () => {
    expect(splitSentences('Und haben Sie bis Freitag noch einen Termin für eine\nHeizungswartung frei?')).toEqual(['Und haben Sie bis Freitag noch einen Termin für eine Heizungswartung frei?']);
    expect(splitSentences('Die Rechnung Nr. 4711 habe ich zweimal bekommen, bitte klären Sie das.\nUnd haben Sie einen Termin frei?')).toHaveLength(2);
  });

  it('Leerzeilen und Listenzeichen bleiben Grenzen', () => {
    expect(splitSentences('Guten Tag\n\nbitte rufen Sie zurück')).toEqual(['Guten Tag', 'bitte rufen Sie zurück']);
    expect(splitSentences('Wir brauchen\n- eine Kopie\n- einen Termin')).toEqual(['Wir brauchen', 'eine Kopie', 'einen Termin']);
  });
});
