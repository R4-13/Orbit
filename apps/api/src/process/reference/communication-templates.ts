import { APPOINTMENT_DURATION_MINUTES, type AppointmentKind } from './appointment-slots';
import { formatEuro } from './money';

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

function appointmentBlock(appointment: ClarificationAppointment): string[] {
  const minutes = APPOINTMENT_DURATION_MINUTES[appointment.kind];
  if (appointment.kind === 'SITE_VISIT') {
    if (appointment.slots.length > 0) {
      return [
        `Für ein verlässliches Angebot schauen wir uns die Situation gern bei Ihnen vor Ort an (ca. ${minutes} Minuten). Folgende Termine hätten wir frei:`,
        ...appointment.slots.map((slot) => `- ${slot}`),
        'Bitte antworten Sie mit Ihrem Wunschtermin. Passt keiner der Vorschläge, nennen Sie uns gern Alternativen.',
      ];
    }
    return [`Für ein verlässliches Angebot schauen wir uns die Situation gern bei Ihnen vor Ort an (ca. ${minutes} Minuten). Bitte nennen Sie uns zwei bis drei Zeiträume (Wochentag und Uhrzeit), zu denen ein Termin bei Ihnen passt.`];
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
}): string {
  const lines = input.questions.map((q, index) => `${index + 1}. ${q.question}`);
  const intro = `vielen Dank für Ihre Anfrage${input.originalSubject ? ` „${input.originalSubject}“` : ''}.`;
  const out: string[] = ['Guten Tag,', '', intro];
  if (input.summary) out.push(`Wir haben sie so verstanden: ${input.summary}`);
  out.push('');
  if (lines.length > 0) {
    out.push('Damit wir Ihnen ein passendes Angebot erstellen können, benötigen wir noch folgende Angaben:', '', ...lines, '');
  }
  if (input.appointment) out.push(...appointmentBlock(input.appointment), '');
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

const GREETING = ['Guten Tag,', ''];
const closing = (companyName: string): string[] => ['', 'Mit freundlichen Grüßen', companyName];

/**
 * Eingangsbestätigung. Sie sagt nur, was stimmt: die Nachricht ist angekommen und wird bearbeitet. Bei einem Notfall kommt hinzu, dass sie als dringend eingestuft und
 * sofort weitergeleitet wurde – und der Hinweis auf den Notruf bei Gefahr für Personen. Es werden keine Zeiten, Preise oder Leistungen zugesagt.
 */
export function acknowledgementBody(input: { originalSubject?: string | null; companyName: string; emergency?: boolean }): string {
  const about = input.originalSubject ? ` zu „${input.originalSubject}“` : '';
  return [
    ...GREETING,
    `vielen Dank für Ihre Nachricht${about}. Sie ist bei uns eingegangen.`,
    ...(input.emergency
      ? ['Wir haben sie als dringend eingestuft und leiten sie sofort an die zuständige Stelle weiter.', 'Bei akuter Gefahr für Personen wenden Sie sich bitte umgehend an den Notruf 112.']
      : ['Wir kümmern uns darum und melden uns bei Ihnen.']),
    'Sie können einfach auf diese E-Mail antworten, wenn Sie etwas ergänzen möchten.',
    ...closing(input.companyName),
  ].join('\n');
}

/** Was der Stand eines Vorgangs für die Kundschaft heißt – ohne interne Begriffe und ohne Zusagen über Zeitpunkte. */
export function caseStatusPhrase(status: string): string {
  switch (status) {
    case 'RECEIVED':
    case 'READY':
    case 'IN_PROGRESS':
      return 'Ihre Anfrage ist bei uns in Bearbeitung.';
    case 'WAITING_FOR_INFORMATION':
      return 'Wir warten auf Ihre Rückmeldung zu unseren Fragen.';
    case 'WAITING_FOR_APPROVAL':
    case 'MANUAL_REVIEW':
    case 'WAITING_FOR_EXTERNAL_SYSTEM':
    case 'PAUSED':
      return 'Ihre Anfrage wird derzeit von uns geprüft.';
    case 'COMPLETED':
      return 'Ihre Anfrage ist bei uns abgeschlossen.';
    case 'REJECTED':
    case 'CANCELLED':
      return 'Ihre Anfrage wird von uns nicht weiterverfolgt.';
    default:
      return 'Ihre Anfrage ist bei uns in Bearbeitung.';
  }
}

export function statusUpdateBody(input: { referenceTitle?: string | null; status: string; lastStep?: string; companyName: string }): string {
  return [
    ...GREETING,
    `zu Ihrer Nachfrage${input.referenceTitle ? ` zu „${input.referenceTitle}“` : ''}: ${caseStatusPhrase(input.status)}`,
    ...(input.lastStep ? [`Zuletzt ist Folgendes geschehen: ${input.lastStep}`] : []),
    'Sobald es etwas Neues gibt, melden wir uns bei Ihnen.',
    ...closing(input.companyName),
  ].join('\n');
}

export function attachmentRequestBody(input: { originalSubject?: string | null; what: string; companyName: string }): string {
  return [
    ...GREETING,
    `vielen Dank für Ihre Nachricht${input.originalSubject ? ` „${input.originalSubject}“` : ''}.`,
    `Leider ist bei uns ${input.what} nicht angekommen bzw. nicht lesbar. Könnten Sie ihn uns bitte noch einmal als Antwort auf diese E-Mail schicken?`,
    ...closing(input.companyName),
  ].join('\n');
}

/** Auskunft aus dem Betriebswissen: der Text kommt aus dem Profil/den freigegebenen Antworten (und wurde als unbedenklich geprüft), die Vorlage fügt nur den Rahmen hinzu. */
export function informationBody(input: { answer: string; companyName: string }): string {
  return [...GREETING, 'vielen Dank für Ihre Nachricht.', '', input.answer.trim(), '', 'Bei weiteren Fragen melden Sie sich gern.', ...closing(input.companyName)].join('\n');
}

export function appointmentConfirmationBody(input: { kind: AppointmentKind; label: string; companyName: string }): string {
  const what = input.kind === 'SITE_VISIT' ? 'der Vor-Ort-Termin' : 'unser Telefontermin';
  return [
    ...GREETING,
    `${what} ist bestätigt: ${input.label}.`,
    input.kind === 'SITE_VISIT' ? 'Wir freuen uns auf den Termin. Sollte etwas dazwischenkommen, antworten Sie bitte einfach auf diese E-Mail.' : 'Wir rufen Sie zu dieser Zeit an. Sollte etwas dazwischenkommen, antworten Sie bitte einfach auf diese E-Mail.',
    ...closing(input.companyName),
  ].join('\n');
}
