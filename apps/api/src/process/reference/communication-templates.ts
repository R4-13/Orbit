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
