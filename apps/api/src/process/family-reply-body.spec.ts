import { acknowledgementBody, clarificationBody, informationBody, statusUpdateBody } from './reference/communication-templates';
import { draftCore, familyReplyBody, familyStateSentence } from './family-reply-body';

describe('Kern eines Entwurfs der Vorlagen', () => {
  it('Rückfrage: nur die Fragen, ohne Anrede, Gruß und Standardsätze', () => {
    const body = clarificationBody({ originalSubject: 'Drei Anliegen', questions: [{ key: 'a', question: 'Welche Rechnung brauchen Sie?' }, { key: 'b', question: 'Welcher Zeitraum?' }], companyName: 'Musterwerk GmbH', intent: 'HANDOFF', previousRounds: 0 });
    const core = draftCore(body);
    expect(core.join('\n')).toContain('1. Welche Rechnung brauchen Sie?');
    expect(core.join('\n')).toContain('2. Welcher Zeitraum?');
    expect(core.join('\n')).not.toMatch(/Guten Tag|Mit freundlichen|Musterwerk GmbH|vielen Dank für Ihre Anfrage|einfach auf diese E-Mail/);
  });

  it('Auskunft: der Antworttext, ohne Rahmen', () => {
    const core = draftCore(informationBody({ answer: 'Ja, wir kommen auch nach Frechen.', companyName: 'Musterwerk GmbH' }));
    expect(core).toEqual(['Ja, wir kommen auch nach Frechen.']);
  });

  it('Eingangsbestätigung und Statusauskunft: Standardsätze entfallen', () => {
    expect(draftCore(acknowledgementBody({ originalSubject: 'Hallo', companyName: 'Musterwerk GmbH' })).join(' ')).not.toMatch(/Guten Tag|vielen Dank für Ihre Nachricht|einfach auf diese E-Mail/);
    expect(draftCore(statusUpdateBody({ referenceTitle: 'Angebot', status: 'COMPLETED', companyName: 'Musterwerk GmbH' })).join(' ')).not.toMatch(/Sobald es etwas Neues gibt/);
  });
});

describe('Gemeinsame Antwort', () => {
  const base = { name: 'Tom Orbit', companyName: 'Musterwerk GmbH', lang: 'de' as const, originalSubject: 'Re: Drei Anliegen auf einmal', concerns: 3 };

  it('erste Antwort: eine Einleitung mit Eingangsbestätigung, je Anliegen ein Abschnitt, ein Gruß', () => {
    const body = familyReplyBody({
      ...base,
      confirmsReceipt: true,
      sections: [
        { label: 'Kopie der letzten Rechnung', lines: [], state: 'HANDOVER' },
        { label: 'Wartungstermin verschieben', lines: ['Welcher Termin ist gemeint?'] },
        { label: 'Angebot Heizungsregler', lines: ['1. Welcher Regler?', '2. Welche Anlage?'] },
      ],
    });
    expect(body.match(/Mit freundlichen Grüßen/g)).toHaveLength(1);
    expect(body.match(/Guten Tag/g)).toHaveLength(1);
    expect(body).toContain('Sie ist bei uns eingegangen; wir bearbeiten Ihre 3 Anliegen getrennt');
    expect(body).toContain('Zu „Kopie der letzten Rechnung“:\nDieses Anliegen können wir nicht automatisch erledigen.');
    expect(body.indexOf('Zu „Wartungstermin verschieben“')).toBeLessThan(body.indexOf('Zu „Angebot Heizungsregler“'));
    expect(body).not.toContain('Drei Anliegen auf einmal“. Sie ist bei uns eingegangen. Sie ist'); // keine doppelte Bestätigung
  });

  it('Folgeantwort bestätigt den Eingang nicht noch einmal; Stand-Sätze sind wahr formuliert (nie „erledigt“ für Übergaben)', () => {
    const body = familyReplyBody({ ...base, confirmsReceipt: false, sections: [{ label: 'Rechnung', lines: [], state: 'HANDOVER' }] });
    expect(body).toContain('vielen Dank für Ihre Antwort');
    expect(body).not.toContain('eingegangen');
    expect(familyStateSentence('HANDOVER', 'de')).not.toMatch(/erledigt/);
    expect(familyStateSentence('DONE', 'de')).toContain('erledigt');
  });

  it('englische Kundschaft bekommt eine englische Antwort', () => {
    const body = familyReplyBody({ ...base, lang: 'en', confirmsReceipt: true, sections: [{ label: 'Invoice copy', lines: [], state: 'HANDOVER' }] });
    expect(body).toContain('Hello Tom Orbit,');
    expect(body).toContain('Kind regards');
    expect(body).toContain('We cannot complete this request automatically.');
  });
});
