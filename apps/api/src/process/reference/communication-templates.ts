import { APPOINTMENT_DURATION_MINUTES, type AppointmentKind } from './appointment-slots';
import { formatEuro } from './money';
import type { ReplyLanguage } from './reply-language';

/**
 * Business wording of the reference process's outbound messages. These are process content (a tenant can later replace
 * them with its own templates); they are not engine logic and contain no prices, customers or addresses of their own.
 */
export interface ClarificationQuestion {
  key: string;
  question: string;
}

export interface ClarificationAppointment {
  kind: AppointmentKind;
  /** Konkrete freie Zeiten aus dem Kalender; leer = es sind keine bekannt, die Nachricht bittet um Terminwünsche. */
  slots: string[];
}

/** Wozu gefragt wird: für ein Angebot, das ORBIT selbst erstellt (`QUOTE`), oder um die Anfrage an die zuständige Person zu übergeben (`HANDOFF`, kein Wort über ein Angebot). */
export type ClarificationIntent = 'QUOTE' | 'HANDOFF';

function appointmentBlock(appointment: ClarificationAppointment, intent: ClarificationIntent): string[] {
  const minutes = APPOINTMENT_DURATION_MINUTES[appointment.kind];
  const reliable = intent === 'HANDOFF' ? 'eine verlässliche Einschätzung' : 'ein verlässliches Angebot';
  if (appointment.kind === 'SITE_VISIT') {
    if (appointment.slots.length > 0) {
      return [
        `Für ${reliable} schauen wir uns die Situation gern bei Ihnen vor Ort an (ca. ${minutes} Minuten). Folgende Termine hätten wir frei:`,
        ...appointment.slots.map((slot) => `- ${slot}`),
        'Bitte antworten Sie mit Ihrem Wunschtermin. Passt keiner der Vorschläge, nennen Sie uns gern Alternativen.',
      ];
    }
    return [`Für ${reliable} schauen wir uns die Situation gern bei Ihnen vor Ort an (ca. ${minutes} Minuten). Bitte nennen Sie uns zwei bis drei Zeiträume (Wochentag und Uhrzeit), zu denen ein Termin bei Ihnen passt.`];
  }
  if (appointment.slots.length > 0) {
    return [
      `Zur Klärung der offenen Punkte und zur Abstimmung eines möglichen Vor-Ort-Termins rufen wir Sie gern kurz an (ca. ${minutes} Minuten). Dafür hätten wir folgende Zeiten:`,
      ...appointment.slots.map((slot) => `- ${slot}`),
      'Bitte antworten Sie mit Ihrer Wunschzeit und einer Telefonnummer, unter der wir Sie erreichen.',
    ];
  }
  return [`Zur Klärung der offenen Punkte und zur Abstimmung eines möglichen Vor-Ort-Termins rufen wir Sie gern kurz an (ca. ${minutes} Minuten). Unter welcher Telefonnummer und zu welchen Zeiten erreichen wir Sie am besten?`];
}

export function clarificationBody(input: {
  originalSubject?: string | null;
  questions: ClarificationQuestion[];
  companyName: string;
  /** Ein Satz, wie die Anfrage verstanden wurde (nur unbedenklicher Text). */
  summary?: string;
  appointment?: ClarificationAppointment;
  intent?: ClarificationIntent;
  /** Wie viele Rückfragen die Kundschaft in diesem Vorgang schon bekommen hat (ab der zweiten wird für die Antwort gedankt statt die Anfrage noch einmal zusammenzufassen). */
  previousRounds?: number;
}): string {
  const lines = input.questions.map((q, index) => `${index + 1}. ${q.question}`);
  const intent = input.intent ?? 'QUOTE';
  const followUp = (input.previousRounds ?? 0) > 0;
  const intro = followUp ? 'vielen Dank für Ihre Antwort.' : `vielen Dank für Ihre Anfrage${input.originalSubject ? ` „${input.originalSubject}“` : ''}.`;
  const out: string[] = ['Guten Tag,', '', intro];
  // Bei einer Übergabe steht die KI-Zusammenfassung nur intern (CRM): sie ist in der dritten Person geschrieben und kann Aussagen des Betriebs aus dem Profil enthalten, die nicht in eine Nachricht an die Kundschaft gehören.
  if (input.summary && !followUp && intent !== 'HANDOFF') out.push(`Wir haben sie so verstanden: ${input.summary}`);
  out.push('');
  if (lines.length > 0) {
    const why = intent === 'HANDOFF' ? 'Damit wir Ihre Anfrage gut vorbereiten können' : 'Damit wir Ihnen ein passendes Angebot erstellen können';
    out.push(`${why}, ${followUp ? 'fehlen uns noch' : 'benötigen wir noch'} folgende Angaben:`, '', ...lines, '');
  }
  if (input.appointment) out.push(...appointmentBlock(input.appointment, intent), '');
  out.push('Sie können einfach auf diese E-Mail antworten.', '', 'Mit freundlichen Grüßen', input.companyName);
  return out.join('\n');
}

export function quoteDeliveryBody(input: { quoteNumber: string; grossCents: number; validUntil: Date; companyName: string }): string {
  const valid = input.validUntil.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return [
    'Guten Tag,',
    '',
    `vielen Dank für Ihr Interesse. Anbei erhalten Sie unser Angebot ${input.quoteNumber} über ${formatEuro(input.grossCents)} (brutto).`,
    `Das Angebot ist gültig bis zum ${valid}.`,
    '',
    'Bei Fragen melden Sie sich gern.',
    '',
    'Mit freundlichen Grüßen',
    input.companyName,
  ].join('\n');
}

export function replySubject(original?: string | null, fallback = 'Ihre Anfrage'): string {
  const base = (original ?? '').trim() || fallback;
  return /^(re|aw):/i.test(base) ? base : `Re: ${base}`;
}

// ── Weitere Mitteilungen (Autonomie-Ausbau): Bestätigung, Statusauskunft, Anhang anfordern, Auskunft, Terminbestätigung ──────────────────────────────

/**
 * Ein Name taugt für die persönliche Anrede nur, wenn er wie ein Personenname aussieht: Buchstaben, Leerzeichen, Punkt, Apostroph, Bindestrich, 2 bis 60 Zeichen, mit
 * Großbuchstaben am Anfang. Anzeigenamen aus E-Mails sind frei wählbar (auch „Dringend: Konto gesperrt!“) – alles andere fällt auf die neutrale Anrede zurück.
 */
export function safeSalutationName(raw: string | null | undefined): string | undefined {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) return undefined;
  if (!/^\p{Lu}[\p{L} .'’-]*$/u.test(name)) return undefined;
  if (!/\p{L}{2}/u.test(name)) return undefined;
  return name;
}

const greeting = (lang: ReplyLanguage, name?: string): string[] => {
  const who = safeSalutationName(name);
  return lang === 'en' ? [who ? `Hello ${who},` : 'Hello,', ''] : [who ? `Guten Tag ${who},` : 'Guten Tag,', ''];
};
const closing = (companyName: string, lang: ReplyLanguage = 'de'): string[] => ['', lang === 'en' ? 'Kind regards' : 'Mit freundlichen Grüßen', companyName];

/**
 * Eingangsbestätigung. Sie sagt nur, was stimmt: die Nachricht ist angekommen und wird bearbeitet. Bei einem Notfall kommt hinzu, dass sie als dringend eingestuft und
 * sofort weitergeleitet wurde – und der Hinweis auf den Notruf bei Gefahr für Personen. Es werden keine Zeiten, Preise oder Leistungen zugesagt.
 */
/** Betreff ohne „Re:“/„AW:“-Vorsätze, wenn er in einem Satz zitiert wird. */
export const quotableSubject = (subject?: string | null): string => (subject ?? '').replace(/^\s*((re|aw|fw|fwd|wg)\s*:\s*)+/i, '').trim();

export function acknowledgementBody(input: { originalSubject?: string | null; companyName: string; emergency?: boolean; lang?: ReplyLanguage; name?: string }): string {
  const lang = input.lang ?? 'de';
  const subject = quotableSubject(input.originalSubject);
  if (lang === 'en') {
    return [
      ...greeting('en', input.name),
      `thank you for your message${subject ? ` regarding "${subject}"` : ''}. We have received it.`,
      ...(input.emergency
        ? ['We have classed it as urgent and are passing it on to the person responsible right away.', 'If anyone is in immediate danger, please call the emergency number 112 straight away.']
        : ['We will look into it and get back to you.']),
      'You are welcome to simply reply to this email if you would like to add anything.',
      ...closing(input.companyName, lang),
    ].join('\n');
  }
  const about = subject ? ` zu „${subject}“` : '';
  return [
    ...greeting('de', input.name),
    `vielen Dank für Ihre Nachricht${about}. Sie ist bei uns eingegangen.`,
    ...(input.emergency
      ? ['Wir haben sie als dringend eingestuft und leiten sie sofort an die zuständige Stelle weiter.', 'Bei akuter Gefahr für Personen wenden Sie sich bitte umgehend an den Notruf 112.']
      : ['Wir kümmern uns darum und melden uns bei Ihnen.']),
    'Sie können einfach auf diese E-Mail antworten, wenn Sie etwas ergänzen möchten.',
    ...closing(input.companyName),
  ].join('\n');
}

/** Was der Stand eines Vorgangs für die Kundschaft heißt – ohne interne Begriffe und ohne Zusagen über Zeitpunkte. */
export function caseStatusPhrase(status: string, lang: ReplyLanguage = 'de'): string {
  const text = (de: string, en: string) => (lang === 'en' ? en : de);
  switch (status) {
    case 'WAITING_FOR_INFORMATION':
      return text('Wir warten auf Ihre Rückmeldung zu unseren Fragen.', 'We are waiting for your reply to our questions.');
    case 'WAITING_FOR_APPROVAL':
    case 'MANUAL_REVIEW':
    case 'WAITING_FOR_EXTERNAL_SYSTEM':
    case 'PAUSED':
      return text('Ihre Anfrage wird derzeit von uns geprüft.', 'Your request is currently being reviewed by us.');
    case 'COMPLETED':
      return text('Ihre Anfrage ist bei uns abgeschlossen.', 'Your request has been completed on our side.');
    case 'REJECTED':
    case 'CANCELLED':
      return text('Ihre Anfrage wird von uns nicht weiterverfolgt.', 'We are not pursuing your request any further.');
    default:
      return text('Ihre Anfrage ist bei uns in Bearbeitung.', 'Your request is being processed by us.');
  }
}

export function statusUpdateBody(input: { referenceTitle?: string | null; status: string; lastStep?: string; companyName: string; lang?: ReplyLanguage; name?: string }): string {
  const lang = input.lang ?? 'de';
  if (lang === 'en') {
    return [
      ...greeting('en', input.name),
      `regarding your enquiry${input.referenceTitle ? ` about "${input.referenceTitle}"` : ''}: ${caseStatusPhrase(input.status, lang)}`,
      ...(input.lastStep ? [`The most recent step was: ${input.lastStep}`] : []),
      'As soon as there is any news, we will get in touch with you.',
      ...closing(input.companyName, lang),
    ].join('\n');
  }
  return [
    ...greeting('de', input.name),
    `zu Ihrer Nachfrage${input.referenceTitle ? ` zu „${input.referenceTitle}“` : ''}: ${caseStatusPhrase(input.status)}`,
    ...(input.lastStep ? [`Zuletzt ist Folgendes geschehen: ${input.lastStep}`] : []),
    'Sobald es etwas Neues gibt, melden wir uns bei Ihnen.',
    ...closing(input.companyName),
  ].join('\n');
}

export function attachmentRequestBody(input: { originalSubject?: string | null; what: string; companyName: string; lang?: ReplyLanguage; name?: string }): string {
  const lang = input.lang ?? 'de';
  if (lang === 'en') {
    return [
      ...greeting('en', input.name),
      `thank you for your message${input.originalSubject ? ` "${input.originalSubject}"` : ''}.`,
      `Unfortunately, ${input.what} did not reach us or could not be read. Could you please send it again as a reply to this email?`,
      ...closing(input.companyName, lang),
    ].join('\n');
  }
  return [
    ...greeting('de', input.name),
    `vielen Dank für Ihre Nachricht${input.originalSubject ? ` „${input.originalSubject}“` : ''}.`,
    `Leider ist bei uns ${input.what} nicht angekommen bzw. nicht lesbar. Könnten Sie ihn uns bitte noch einmal als Antwort auf diese E-Mail schicken?`,
    ...closing(input.companyName),
  ].join('\n');
}

/** Auskunft aus dem Betriebswissen: der Text kommt aus dem Profil/den freigegebenen Antworten (und wurde als unbedenklich geprüft), die Vorlage fügt nur den Rahmen hinzu. */
export function informationBody(input: { answer: string; companyName: string; lang?: ReplyLanguage; name?: string }): string {
  const lang = input.lang ?? 'de';
  if (lang === 'en') return [...greeting('en', input.name), 'thank you for your message.', '', input.answer.trim(), '', 'If you have any further questions, please get in touch.', ...closing(input.companyName, lang)].join('\n');
  return [...greeting('de', input.name), 'vielen Dank für Ihre Nachricht.', '', input.answer.trim(), '', 'Bei weiteren Fragen melden Sie sich gern.', ...closing(input.companyName)].join('\n');
}

export function appointmentConfirmationBody(input: { kind: AppointmentKind; label: string; companyName: string; lang?: ReplyLanguage; name?: string }): string {
  const lang = input.lang ?? 'de';
  if (lang === 'en') {
    const what = input.kind === 'SITE_VISIT' ? 'The on-site appointment' : 'Our phone appointment';
    return [
      ...greeting('en', input.name),
      `${what} is confirmed: ${input.label}.`,
      input.kind === 'SITE_VISIT' ? 'We look forward to seeing you. If anything comes up, please simply reply to this email.' : 'We will call you at that time. If anything comes up, please simply reply to this email.',
      ...closing(input.companyName, lang),
    ].join('\n');
  }
  const what = input.kind === 'SITE_VISIT' ? 'der Vor-Ort-Termin' : 'unser Telefontermin';
  return [
    ...greeting('de', input.name),
    `${what} ist bestätigt: ${input.label}.`,
    input.kind === 'SITE_VISIT' ? 'Wir freuen uns auf den Termin. Sollte etwas dazwischenkommen, antworten Sie bitte einfach auf diese E-Mail.' : 'Wir rufen Sie zu dieser Zeit an. Sollte etwas dazwischenkommen, antworten Sie bitte einfach auf diese E-Mail.',
    ...closing(input.companyName),
  ].join('\n');
}
