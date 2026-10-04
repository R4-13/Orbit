import { formatEuro } from './money';

/**
 * Business wording of the reference process's outbound messages. These are process content (a tenant can later replace
 * them with its own templates); they are not engine logic and contain no prices, customers or addresses of their own.
 */
export interface ClarificationQuestion {
  key: string;
  question: string;
}

export function clarificationBody(input: { originalSubject?: string | null; questions: ClarificationQuestion[]; companyName: string }): string {
  const lines = input.questions.map((q, index) => `${index + 1}. ${q.question}`);
  return [
    'Guten Tag,',
    '',
    `vielen Dank für Ihre Anfrage${input.originalSubject ? ` „${input.originalSubject}“` : ''}. Damit wir Ihnen ein passendes Angebot erstellen können, benötigen wir noch folgende Angaben:`,
    '',
    ...lines,
    '',
    'Sie können einfach auf diese E-Mail antworten.',
    '',
    'Mit freundlichen Grüßen',
    input.companyName,
  ].join('\n');
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
