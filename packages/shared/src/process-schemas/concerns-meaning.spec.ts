import { describe, expect, it } from 'vitest';
import { splitDecisionFromConcerns, splitSentences, verifyConcerns } from './concerns';

/**
 * Funktionsnachweis 23.10.: Wortgleichheit und Zeichenähnlichkeit (≥ 92 %) sind nur Hilfen. Gegenbeispiele: Auszüge, die Verneinungen oder Bedingungen weglassen oder erfinden,
 * dürfen den Sinn des Anliegens nicht verändern; bei unsicherem Beleg gilt der vollständige Originaltext.
 */
describe('Sinnerhalt der Anliegen: Ähnlichkeit ist nur eine Hilfe', () => {
  const one = (message: string, excerpt: string, goal = 'g') => verifyConcerns(message, { concerns: [{ title: 't', category: 'UNKNOWN', goal, excerpt }], sharedContext: '' });

  it('eine EINGEFÜGTE Verneinung ist kein Beleg, auch wenn fast alle Zeichen übereinstimmen', () => {
    const message = 'Wir möchten den Termin am 4.11. verschieben und brauchen dafür eine Bestätigung.';
    const verified = one(message, 'Wir möchten den Termin am 4.11. nicht verschieben und brauchen dafür eine Bestätigung.');
    expect(verified.concerns[0]!.grounded).toBe(false);
    expect(verified.coverage.ungrounded).toEqual(['t']);
  });

  it('eine EINGEFÜGTE Bedingung ist kein Beleg', () => {
    const message = 'Bitte schicken Sie uns das Angebot für die Badsanierung noch diese Woche zu.';
    expect(one(message, 'Bitte schicken Sie uns das Angebot für die Badsanierung nur falls noch diese Woche zu.').concerns[0]!.grounded).toBe(false);
  });

  it('eine AUSGELASSENE Verneinung wird nicht übernommen: der Originalsatz gilt, das Risiko ist vermerkt und das Ziel kommt aus dem Originaltext', () => {
    const message = 'Wir möchten den Wartungsvertrag kündigen, aber nicht vor dem Winter. Bitte bestätigen Sie den Eingang.';
    const verified = one(message, 'Wir möchten den Wartungsvertrag kündigen', 'Wartungsvertrag sofort gekündigt');
    const concern = verified.concerns[0]!;
    expect(concern.grounded).toBe(true);
    expect(concern.excerpt).toBe('Wir möchten den Wartungsvertrag kündigen, aber nicht vor dem Winter.');
    expect(concern.meaningRisk).toEqual(expect.arrayContaining(['aber', 'nicht']));
    expect(verified.coverage.meaningRisk).toEqual(['t']);
    const decision = splitDecisionFromConcerns({ ...verified, concerns: [concern, { ...concern, title: 'u' }] });
    expect(decision.children[0]!.goal).toContain('nicht vor dem Winter'); // nicht die Formulierung „sofort gekündigt“ der KI
    expect(decision.children[0]!.goal).not.toContain('sofort gekündigt');
    expect(decision.children[0]!.segment).toContain('nicht vor dem Winter');
  });

  it('ohne ausgelassene Einschränkung bleibt das Ziel der KI', () => {
    const message = 'Wir möchten den Wartungsvertrag kündigen. Bitte bestätigen Sie den Eingang.';
    const verified = one(message, 'Wir möchten den Wartungsvertrag kündigen.', 'Wartungsvertrag gekündigt');
    expect(verified.concerns[0]!.meaningRisk).toBeUndefined();
    const decision = splitDecisionFromConcerns({ ...verified, concerns: [verified.concerns[0]!, { ...verified.concerns[0]!, title: 'u' }] });
    expect(decision.children[0]!.goal).toBe('Wartungsvertrag gekündigt');
  });

  it('eine Bedingung in einem eigenen Nachbarsatz geht nicht verloren: sie wird dem Anliegen zugeschlagen', () => {
    const message = 'Bitte verschieben Sie den Wartungstermin auf den 4.11.\nAber nur, wenn Frau Meier dann auch da ist.\nAußerdem brauche ich eine Kopie der letzten Rechnung.';
    const verified = verifyConcerns(message, {
      concerns: [
        { title: 'Termin', category: 'UNKNOWN', goal: 'Termin verschoben', excerpt: 'Bitte verschieben Sie den Wartungstermin auf den 4.11.' },
        { title: 'Rechnung', category: 'UNKNOWN', goal: 'Kopie', excerpt: 'Außerdem brauche ich eine Kopie der letzten Rechnung.' },
      ],
      sharedContext: '',
    });
    expect(verified.concerns[0]!.excerpt).toContain('Aber nur, wenn Frau Meier dann auch da ist.');
    expect(verified.concerns[1]!.excerpt).not.toContain('Frau Meier');
    expect(verified.coverage.qualifiersAttached).toEqual(['Aber nur, wenn Frau Meier dann auch da ist.']);
  });

  it('eine Einschränkung vor dem Anliegen wird dem folgenden Anliegen zugeschlagen', () => {
    const message = 'Das gilt nur, solange die Heizung nicht ausfällt.\nBitte schicken Sie mir die Rechnung.';
    const verified = verifyConcerns(message, { concerns: [{ title: 'Rechnung', category: 'UNKNOWN', goal: 'g', excerpt: 'Bitte schicken Sie mir die Rechnung.' }], sharedContext: '' });
    expect(verified.concerns[0]!.excerpt).toContain('solange die Heizung nicht ausfällt');
  });

  it('eine Einschränkung ohne benachbartes Anliegen landet im gemeinsamen Kontext', () => {
    const message = 'Bitte schicken Sie mir die Rechnung.\nDanke.\nDas gilt nur, solange die Heizung nicht ausfällt.';
    const verified = verifyConcerns(message, { concerns: [{ title: 'Rechnung', category: 'UNKNOWN', goal: 'g', excerpt: 'Bitte schicken Sie mir die Rechnung.' }], sharedContext: '' });
    expect(verified.sharedContext).toContain('solange die Heizung nicht ausfällt');
  });

  it('ein sehr kurzer Auszug belegt keinen langen Satz', () => {
    const message = 'Wir wollen zusätzlich noch einen Termin für die Wartung unserer Gasheizung im Keller vereinbaren.';
    expect(one(message, 'Termin').concerns[0]!.grounded).toBe(false);
    expect(one(message, 'Heizung Keller').concerns[0]!.grounded).toBe(false);
  });

  it('ein Teilwort ist kein Treffer (Termin ≠ Terminen)', () => {
    const message = 'Wir haben viele Terminen im Kalender stehen.';
    expect(one(message, 'Wir haben viele Termin').concerns[0]!.grounded).toBe(false);
  });

  it('bei unsicherem Beleg bekommt der Teilvorgang keinen gekürzten Auszug (die vollständige Nachricht bleibt die Grundlage)', () => {
    const message = 'Wir möchten den Termin am 4.11. verschieben und brauchen dafür eine Bestätigung. Außerdem noch eine Frage zur Rechnung.';
    const verified = verifyConcerns(message, {
      concerns: [
        { title: 'a', category: 'UNKNOWN', goal: 'g1', excerpt: 'Wir möchten den Termin am 4.11. nicht verschieben und brauchen dafür eine Bestätigung.' },
        { title: 'b', category: 'UNKNOWN', goal: 'g2', excerpt: 'Außerdem noch eine Frage zur Rechnung.' },
      ],
      sharedContext: '',
    });
    const decision = splitDecisionFromConcerns(verified);
    expect(decision.children[0]!.segment).toBeUndefined();
    expect(decision.children[1]!.segment).toBe('Außerdem noch eine Frage zur Rechnung.');
  });
});

describe('Weich umbrochene Zeilen sind keine Satzgrenzen (Funktionsnachweis 23.10.)', () => {
  const wrapped = 'Guten Tag,\r\n\r\nerstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer, zweitens möchte ich den Wartungstermin vom 28.10. auf den 4.11.\r\nverschieben und drittens würde mich ein Angebot für einen neuen Heizungsregler\r\ninteressieren.\r\n\r\nDanke, Tom Orbit';

  it('ein Umbruch vor einem Kleinbuchstaben verbindet die Zeilen; Absätze und Satzenden bleiben Grenzen', () => {
    expect(splitSentences(wrapped)).toEqual([
      'Guten Tag,',
      'erstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer, zweitens möchte ich den Wartungstermin vom 28.10. auf den 4.11. verschieben und drittens würde mich ein Angebot für einen neuen Heizungsregler interessieren.',
      'Danke, Tom Orbit',
    ]);
  });

  it('ein Auszug über den Umbruch hinweg ist belegt (kein „ungebelegtes“ Anliegen, kein zusätzliches Restanliegen)', () => {
    const verified = verifyConcerns(wrapped, {
      concerns: [
        { title: 'Rechnung', category: 'UNKNOWN', goal: 'Kopie', excerpt: 'erstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer' },
        { title: 'Termin', category: 'UNKNOWN', goal: 'Termin verschoben', excerpt: 'zweitens möchte ich den Wartungstermin vom 28.10. auf den 4.11.\r\nverschieben' },
        { title: 'Regler', category: 'UNKNOWN', goal: 'Angebot', excerpt: 'drittens würde mich ein Angebot für einen neuen Heizungsregler interessieren' },
      ],
      sharedContext: '',
    });
    expect(verified.concerns.every((c) => c.grounded)).toBe(true);
    expect(verified.concerns.some((c) => c.supplemented)).toBe(false);
  });
});
