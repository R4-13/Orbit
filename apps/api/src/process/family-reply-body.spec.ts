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
      opening: 'RECEIPT' as const,
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
    const body = familyReplyBody({ ...base, opening: 'REPLY' as const, sections: [{ label: 'Rechnung', lines: [], state: 'HANDOVER' }] });
    expect(body).toContain('vielen Dank für Ihre Antwort');
    expect(body).not.toContain('eingegangen');
    expect(familyStateSentence('HANDOVER', 'de')).not.toMatch(/erledigt/);
    expect(familyStateSentence('DONE', 'de')).toContain('erledigt');
  });

  it('Angaben der Kundschaft, die bei einer Person liegen, werden so gemeldet – ohne Erledigt-Zusage', () => {
    const body = familyReplyBody({ ...base, opening: 'REPLY' as const, sections: [{ label: 'Rechnung', lines: [], state: 'INFO_PASSED' }] });
    expect(body).toContain('Zu „Rechnung“:\nIhre Angaben dazu haben wir an die zuständige Person weitergegeben');
    expect(familyStateSentence('INFO_PASSED', 'de')).not.toMatch(/erledigt/);
    expect(familyStateSentence('INFO_PASSED', 'en')).toContain('passed your details on');
  });

  it('„Danke für Ihre Antwort“ steht nur nach einer tatsächlichen Antwort der Kundschaft; ohne neuen Eingang beginnt die Rückmeldung neutral', () => {
    const sections = [{ label: 'Rechnung', lines: [], state: 'IN_REVIEW' as const }];
    expect(familyReplyBody({ ...base, opening: 'REPLY' as const, sections })).toContain('vielen Dank für Ihre Antwort');
    const update = familyReplyBody({ ...base, opening: 'UPDATE' as const, sections });
    expect(update).not.toMatch(/Dank für Ihre Antwort|eingegangen/);
    expect(update).toContain('hier eine Rückmeldung zu Ihren Anliegen:');
    expect(familyReplyBody({ ...base, lang: 'en', opening: 'UPDATE' as const, sections })).not.toMatch(/thank you/);
  });

  it('ein als übergeben gemeldetes Anliegen, zu dem später doch gefragt wird: der Wechsel wird benannt', () => {
    const body = familyReplyBody({ ...base, opening: 'UPDATE' as const, sections: [{ label: 'Angebot Heizungsregler', lines: ['1. Welcher Regler?'], supersedes: 'HANDOVER' }] });
    expect(body).toContain('Zu „Angebot Heizungsregler“:\nNach unserer ersten Rückmeldung zu diesem Anliegen haben wir bei der weiteren Prüfung doch noch Rückfragen:\n\n1. Welcher Regler?');
    const plain = familyReplyBody({ ...base, opening: 'UPDATE' as const, sections: [{ label: 'Angebot Heizungsregler', lines: ['1. Welcher Regler?'] }] });
    expect(plain).not.toContain('Nach unserer ersten Rückmeldung');
  });

  it('englische Kundschaft bekommt eine englische Antwort', () => {
    const body = familyReplyBody({ ...base, lang: 'en', opening: 'RECEIPT' as const, sections: [{ label: 'Invoice copy', lines: [], state: 'HANDOVER' }] });
    expect(body).toContain('Hello Tom Orbit,');
    expect(body).toContain('Kind regards');
    expect(body).toContain('We cannot complete this request automatically.');
  });
});
