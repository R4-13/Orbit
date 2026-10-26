import { safeSalutationName } from './reference/communication-templates';
import type { ReplyLanguage } from './reference/reply-language';

/**
 * Die gemeinsame Antwort auf eine Nachricht mit mehreren Anliegen (Meilenstein C): reine Funktionen, die aus den bereits freigegebenen Teilen der Teilvorgänge (Rückfragen, Auskünfte) und dem Stand jedes Anliegens
 * **eine** verständliche Nachricht setzen. Nichts wird hier neu erfunden: Rückfragen und Auskünfte stammen unverändert aus den Entwürfen der Teilvorgänge, die Stand-Sätze sind feste Vorlagen.
 */

/** Wie sich der Stand eines Anliegens der Kundschaft mitteilen lässt (nur wahre Aussagen). */
export type FamilyStateKind = 'HANDOVER' | 'IN_REVIEW' | 'DONE';

export interface FamilyReplySection {
  /** Wie die Kundschaft das Anliegen kennt (Kurzfassung des Anliegens). */
  label: string;
  /** Rückfragen/Auskünfte dieses Anliegens im Wortlaut der Entwürfe (Zeilen). */
  lines: string[];
  /** Stand-Satz, wenn für das Anliegen nichts zu fragen oder zu beantworten ist. */
  state?: FamilyStateKind;
}

export interface FamilyReplyInput {
  name?: string;
  companyName: string;
  lang: ReplyLanguage;
  /** Betreff der Nachricht, auf die geantwortet wird (für die Eingangsbestätigung). */
  originalSubject?: string | null;
  /** Erste Antwort auf diese Nachricht: sie bestätigt zugleich den Eingang (die einzige Eingangsbestätigung). */
  confirmsReceipt: boolean;
  /** Anzahl der Anliegen der Nachricht (für die Einleitung). */
  concerns: number;
  sections: FamilyReplySection[];
}

const STATE_DE: Record<FamilyStateKind, string> = {
  HANDOVER: 'Dieses Anliegen können wir nicht automatisch erledigen. Wir haben es an eine zuständige Person bei uns übergeben; sie kümmert sich darum und meldet sich bei Ihnen.',
  IN_REVIEW: 'Dieses Anliegen prüfen wir noch intern; wir melden uns dazu gesondert bei Ihnen.',
  DONE: 'Dieses Anliegen ist erledigt.',
};
const STATE_EN: Record<FamilyStateKind, string> = {
  HANDOVER: 'We cannot complete this request automatically. We have passed it on to a responsible person on our team, who will take care of it and get back to you.',
  IN_REVIEW: 'We are still reviewing this request internally and will get back to you about it separately.',
  DONE: 'This request has been completed.',
};

export const familyStateSentence = (kind: FamilyStateKind, lang: ReplyLanguage): string => (lang === 'en' ? STATE_EN[kind] : STATE_DE[kind]);

const quotable = (subject?: string | null): string => (subject ?? '').replace(/^\s*((re|aw|fw|fwd|wg)\s*:\s*)+/i, '').trim();

export function familyReplyBody(input: FamilyReplyInput): string {
  const who = safeSalutationName(input.name);
  const en = input.lang === 'en';
  const subject = quotable(input.originalSubject);
  const out: string[] = [en ? (who ? `Hello ${who},` : 'Hello,') : who ? `Guten Tag ${who},` : 'Guten Tag,', ''];
  if (input.confirmsReceipt) {
    out.push(
      en
        ? `thank you for your message${subject ? ` "${subject}"` : ''}. We have received it and are handling your ${input.concerns} requests separately. Here is where each one stands:`
        : `vielen Dank für Ihre Nachricht${subject ? ` „${subject}“` : ''}. Sie ist bei uns eingegangen; wir bearbeiten Ihre ${input.concerns} Anliegen getrennt. Hier der Stand zu jedem:`,
    );
  } else {
    out.push(en ? 'thank you for your reply. Here is the current status of your requests:' : 'vielen Dank für Ihre Antwort. Hier der aktuelle Stand zu Ihren Anliegen:');
  }
  for (const section of input.sections) {
    out.push('', en ? `Regarding "${section.label}":` : `Zu „${section.label}“:`);
    if (section.lines.length > 0) out.push(...section.lines);
    else if (section.state) out.push(familyStateSentence(section.state, input.lang));
  }
  out.push('', en ? 'You are welcome to simply reply to this email.' : 'Sie können einfach auf diese E-Mail antworten.');
  out.push('', en ? 'Kind regards' : 'Mit freundlichen Grüßen', input.companyName);
  return out.join('\n');
}

/** Sätze der Vorlagen, die in der gemeinsamen Antwort nur einmal (in der Einleitung/am Schluss) stehen. */
const STOCK_LINE = [
  /^(vielen dank für ihre (anfrage|nachricht|antwort)|thank you for your (message|enquiry|reply))\b/i,
  /^sie können einfach auf diese e-mail antworten/i,
  /^you are welcome to simply reply/i,
  /^bei weiteren fragen melden sie sich gern\.?$/i,
  /^if you have any further questions/i,
  /^sobald es etwas neues gibt/i,
  /^as soon as there is any news/i,
];
const GREETING = /^(guten tag|hello)\b.*,$/i;
const CLOSING = /^(mit freundlichen grüßen|kind regards)$/i;

/**
 * Der Kern eines Entwurfs der Vorlagen: ohne Anrede, Gruß und Standardsätze – das, was dieses Anliegen der Kundschaft sagt oder fragt. Die Entwürfe stammen aus festen Vorlagen
 * (`communication-templates`); die Zerlegung ist an deren Aufbau (Anrede, Leerzeile, Inhalt, Leerzeile, Gruß, Firma) gebunden und durch Tests abgesichert.
 */
export function draftCore(bodyText: string): string[] {
  const lines = bodyText.split(/\r?\n/);
  let start = 0;
  if (lines[0] !== undefined && GREETING.test(lines[0].trim())) start = 1;
  let end = lines.length;
  const closing = lines.findIndex((l, i) => i >= start && CLOSING.test(l.trim()));
  if (closing >= 0) end = closing;
  const core = lines.slice(start, end).filter((l) => !STOCK_LINE.some((re) => re.test(l.trim())));
  // Führende, trailing und doppelte Leerzeilen entfernen.
  const trimmed: string[] = [];
  for (const line of core) {
    if (line.trim() === '' && (trimmed.length === 0 || trimmed[trimmed.length - 1] === '')) continue;
    trimmed.push(line.trimEnd());
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed;
}
