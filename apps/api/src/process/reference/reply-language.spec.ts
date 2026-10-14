import { safeSalutationName, acknowledgementBody, appointmentConfirmationBody, attachmentRequestBody, informationBody, statusUpdateBody } from './communication-templates';
import { formatSlotLabel } from './appointment-slots';
import { detectLanguage, replyLanguage } from './reply-language';

describe('Sprache der Antwort (AUT-07)', () => {
  it('erkennt deutsche und englische Nachrichten, bei Unklarem nichts', () => {
    expect(detectLanguage('Guten Tag, wir haben ein Problem mit der Heizung und bitten um einen Termin.')).toBe('de');
    expect(detectLanguage('Hello, we have a problem with the heating and would like an appointment, please.')).toBe('en');
    expect(detectLanguage('OK')).toBeUndefined();
    expect(detectLanguage('Rechnung 4711 Betrag 120 EUR')).toBeUndefined();
  });

  it('antwortet nur in Sprachen, die der Betrieb führt', () => {
    const english = 'Hello, we have a problem with the heating and would like an appointment, please.';
    expect(replyLanguage(english, ['de'])).toBe('de'); // Betrieb führt nur Deutsch
    expect(replyLanguage(english, ['de', 'en'])).toBe('en');
    expect(replyLanguage(english, undefined)).toBe('de'); // ohne Profil: Deutsch
    expect(replyLanguage('Guten Tag, wir haben ein Problem mit der Heizung.', ['en', 'de'])).toBe('de');
    expect(replyLanguage('OK', ['en', 'de'])).toBe('en'); // unklar ⇒ erste Sprache des Betriebs
    expect(replyLanguage(english, ['fr'])).toBe('de'); // nicht unterstützte Sprache ⇒ Deutsch
  });

  it('die englischen Texte enthalten dieselben Aussagen wie die deutschen – und keine Zusagen', () => {
    const company = 'Muster GmbH';
    const emergency = acknowledgementBody({ companyName: company, emergency: true, lang: 'en', originalSubject: 'Burst pipe' });
    expect(emergency).toContain('Hello,');
    expect(emergency).toContain('112');
    expect(emergency).toContain('"Burst pipe"');
    expect(emergency).toContain('Kind regards');
    expect(emergency).not.toMatch(/Guten Tag|Grüße/);
    expect(acknowledgementBody({ companyName: company }).includes('Guten Tag')).toBe(true);

    const status = statusUpdateBody({ companyName: company, status: 'COMPLETED', lang: 'en', referenceTitle: 'Heating' });
    expect(status).toContain('has been completed');
    expect(attachmentRequestBody({ companyName: company, what: 'the attachment', lang: 'en' })).toContain('send it again');
    expect(informationBody({ companyName: company, answer: 'Yes, we do.', lang: 'en' })).toContain('Yes, we do.');
    const start = new Date('2026-11-03T09:00:00Z');
    const label = formatSlotLabel(start, new Date('2026-11-03T10:00:00Z'), 'Europe/Berlin', 'en');
    expect(label).toMatch(/Tuesday.*November 2026, 10:00–11:00/);
    expect(appointmentConfirmationBody({ kind: 'SITE_VISIT', label, companyName: company, lang: 'en' })).toContain('is confirmed');
  });

  it('persönliche Anrede nur mit einem Namen, der wie ein Personenname aussieht (AUT-08)', () => {
    expect(safeSalutationName('  Karl   Kunde ')).toBe('Karl Kunde');
    expect(safeSalutationName("Anne-Marie O'Brien")).toBe("Anne-Marie O'Brien");
    expect(safeSalutationName('Dr. Éva Müller')).toBe('Dr. Éva Müller');
    for (const bad of ['dringend: konto gesperrt!', 'Hans <script>', 'Rechnung 4711', 'A', 'x'.repeat(80), '', null, undefined, 'info@firma.example', 'https://evil.example']) expect(safeSalutationName(bad)).toBeUndefined();
    expect(acknowledgementBody({ companyName: 'Muster GmbH', name: 'Karl Kunde' })).toContain('Guten Tag Karl Kunde,');
    expect(acknowledgementBody({ companyName: 'Muster GmbH', name: 'Karl Kunde', lang: 'en' })).toContain('Hello Karl Kunde,');
    expect(acknowledgementBody({ companyName: 'Muster GmbH', name: 'Hans <script>' })).toMatch(/^Guten Tag,\n/);
  });
});
