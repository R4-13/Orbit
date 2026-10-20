import { z } from 'zod';
import type { SplitChild, SplitDecision } from './case-split';

/**
 * Erkennung und Abgrenzung mehrerer Anliegen in einer Nachricht – unabhängig von einem einzelnen Merkmal der Einstufung (MULTIPLE_INTENTS).
 * Die KI zerlegt die Nachricht in Anliegen und nennt zu jedem die **wörtlichen** Sätze, die dazu gehören. Diese Datei prüft das Ergebnis deterministisch:
 *  - jeder Auszug muss wirklich in der Nachricht stehen (sonst ist er nicht belegt und wird nicht verwendet),
 *  - jede inhaltlich tragende Aussage der Nachricht (Frage, Bitte, Wunsch) muss einem Anliegen oder dem gemeinsamen Kontext zugeordnet sein; was übrig bleibt, wird als eigenes Anliegen geführt –
 *    so geht nichts verloren (Nachweis der Vollständigkeit).
 * Ein Auszug gehört seinem Anliegen; der gemeinsame Kontext (Absender, Objekt, Anschrift …) ist für alle zugänglich. Angaben aus dem Auszug eines anderen Anliegens werden nicht ungeprüft übernommen.
 */
export const CONCERN_SEGMENTATION_TOOL = 'submit_concerns';
export const MAX_CONCERNS = 12;

export const ConcernSchema = z
  .object({
    /** Kurzbezeichnung, z. B. „Wartungsvertrag Heizung“. */
    title: z.string().min(1).max(160),
    /** Kategorie der Registry oder UNKNOWN. */
    category: z.string().min(1).max(120),
    /** Was die Person mit diesem Anliegen erreichen will, als Ergebnis formuliert. */
    goal: z.string().min(1).max(200),
    /** Die Sätze der Nachricht, die zu diesem Anliegen gehören – wörtlich übernommen. */
    excerpt: z.string().min(1).max(3000),
  })
  .strict();
export type Concern = z.infer<typeof ConcernSchema>;

export const ConcernSegmentationSchema = z
  .object({
    concerns: z.array(ConcernSchema).min(1).max(MAX_CONCERNS),
    /** Wörtlich: Angaben, die für alle Anliegen gelten (z. B. Objekt, Anschrift, Ansprechperson); leer, wenn es keine gibt. */
    sharedContext: z.string().max(2000).default(''),
  })
  .strict();
export type ConcernSegmentation = z.infer<typeof ConcernSegmentationSchema>;

/** Ein belegtes Anliegen: der Auszug stand tatsächlich in der Nachricht. */
export interface VerifiedConcern extends Concern {
  /** `true`, wenn der Auszug aus der Nachricht stammt; sonst bleibt nur Titel/Ziel (der Auszug wird nicht als Beleg verwendet). */
  grounded: boolean;
  /** `true`: dieses Anliegen wurde nicht von der KI genannt, sondern aus nicht zugeordneten Aussagen der Nachricht ergänzt. */
  supplemented?: boolean;
}

export interface ConcernCoverage {
  /** Anzahl inhaltlich tragender Aussagen (Fragen, Bitten, Wünsche) der Nachricht. */
  substantive: number;
  /** Davon keinem Anliegen und nicht dem gemeinsamen Kontext zugeordnet (vor der Ergänzung). */
  unassigned: string[];
  /** Nicht belegte Auszüge (Titel). */
  ungrounded: string[];
}

export interface VerifiedConcerns {
  concerns: VerifiedConcern[];
  sharedContext: string;
  coverage: ConcernCoverage;
}

/**
 * Auch ein leicht gekürzter Auszug ist belegt (z. B. „Samstags telefonisch erreichbar?“ statt „Viertens: Sind Sie samstags telefonisch erreichbar?“): jedes seiner Wörter (mindestens drei) steht in der
 * Nachricht, in derselben Reihenfolge. Nichts Hinzugefügtes, nichts Umgestelltes – ein erfundener Auszug besteht diese Prüfung nicht.
 */
export function isOrderedSubsequence(candidate: string, haystack: string): boolean {
  const words = candidate.split(' ').filter((w) => w.length > 0);
  if (words.length < 3) return false;
  const source = haystack.split(' ');
  let position = 0;
  for (const word of words) {
    const index = source.indexOf(word, position);
    if (index < 0) return false;
    position = index + 1;
  }
  return true;
}

/** Zerlegt Text in Sätze/Zeilen; Aufzählungszeichen und Nummerierung werden entfernt. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\r?\n+/)
    .map((s) => s.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
    .filter((s) => s.length > 0);
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[„“"'`´‚‘’»«]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?…]+(?=\s|$)/g, '')
    .trim();
}

const REQUEST_CUES = /\b(bitte|könnten|koennten|könnte|würden|wuerden|möchte|moechte|möchten|moechten|brauche|brauchen|benötige|benoetige|benötigen|wünsche|wuensche|suche|suchen|interessiere|wollen|will|können sie|koennen sie|kann ich|kann man|haben sie|gibt es|wie viel|wie lange|wann|welche|ob ihr|ob sie|frage|anfrage|angebot|termin|rechnung|reklamation|kündig|kuendig|ändern|aendern|korrigier|umziehen|umzug)\b/i;

/** Inhaltlich tragend: eine Frage, Bitte oder ein Wunsch – keine Anrede, keine Grußformel, kein bloßer Hinweis. */
export function isSubstantiveSentence(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < 12) return false;
  if (/^(sehr geehrte|guten (tag|morgen|abend)|hallo|liebe|lieber|mit freundlichen|freundliche gr|viele gr|beste gr|herzliche gr|vielen dank|danke)/i.test(s)) return false;
  return s.includes('?') || REQUEST_CUES.test(s);
}

/**
 * Prüft die Zerlegung gegen die Nachricht. Ergibt belegte Anliegen (Reihenfolge der Nachricht bleibt die der KI), den Nachweis der Vollständigkeit und – falls nötig – ein ergänztes Anliegen
 * für Aussagen, die niemand zugeordnet hat.
 */
export function verifyConcerns(message: string, segmentation: ConcernSegmentation): VerifiedConcerns {
  const haystack = normalizeForMatch(message);
  const inMessage = (text: string): boolean => {
    const sentences = splitSentences(text).map(normalizeForMatch).filter((s) => s.length > 0);
    if (sentences.length === 0) return false;
    const found = sentences.filter((s) => haystack.includes(s) || isOrderedSubsequence(s, haystack)).length;
    return found / sentences.length >= 0.8;
  };
  const concerns: VerifiedConcern[] = segmentation.concerns.map((c) => ({ ...c, grounded: inMessage(c.excerpt) }));
  const sharedGrounded = segmentation.sharedContext && inMessage(segmentation.sharedContext) ? segmentation.sharedContext : '';

  const assigned = new Set<string>();
  for (const c of concerns) if (c.grounded) for (const s of splitSentences(c.excerpt)) assigned.add(normalizeForMatch(s));
  for (const s of splitSentences(sharedGrounded)) assigned.add(normalizeForMatch(s));

  const substantive = splitSentences(message).filter(isSubstantiveSentence);
  const unassigned = substantive.filter((s) => {
    const n = normalizeForMatch(s);
    if (assigned.has(n)) return false;
    // Ein Satz, der Teil eines längeren zugeordneten Satzes ist (oder umgekehrt), gilt als zugeordnet.
    for (const a of assigned) if (a.includes(n) || n.includes(a)) return false;
    return true;
  });
  const result: VerifiedConcern[] = [...concerns];
  if (unassigned.length > 0) {
    result.push({
      title: 'Weitere Fragen und Wünsche der Nachricht',
      category: 'UNKNOWN',
      goal: 'Die übrigen Fragen und Wünsche der Nachricht beantworten oder an eine Person weitergeben',
      excerpt: unassigned.join(' '),
      grounded: true,
      supplemented: true,
    });
  }
  return {
    concerns: result,
    sharedContext: sharedGrounded,
    coverage: { substantive: substantive.length, unassigned, ungrounded: concerns.filter((c) => !c.grounded).map((c) => c.title) },
  };
}

/**
 * Lohnt sich die Zerlegung überhaupt? Billige Vorprüfung, damit nicht jede Kurznachricht einen KI-Aufruf kostet: mehrere inhaltlich tragende Aussagen, mehrere Fragezeichen, eine Aufzählung
 * oder ein vorgeschlagenes Mehrfachanliegen aus der Einstufung. Eine Einstufung mit einem Anliegen schließt die Zerlegung nicht aus – sie ist ein Hinweis, kein Urteil.
 */
export function shouldSegment(message: string, hints: { multipleIntentsFlag?: boolean; intentCount?: number } = {}): boolean {
  if (hints.multipleIntentsFlag || (hints.intentCount ?? 0) >= 2) return true;
  if (message.trim().length < 120) return false;
  const substantive = splitSentences(message).filter(isSubstantiveSentence).length;
  const questions = (message.match(/\?/g) ?? []).length;
  const listItems = (message.match(/^\s*(?:[-*•–]|\d+[.)])\s+\S/gm) ?? []).length;
  return substantive >= 3 || questions >= 2 || listItems >= 2;
}

/** Aus der geprüften Zerlegung wird die Aufteilungsentscheidung: ab zwei Anliegen ein Teilvorgang je Anliegen (Obergrenze der gleichzeitig bearbeiteten regelt der Aufrufer). */
export function splitDecisionFromConcerns(verified: VerifiedConcerns): SplitDecision {
  if (verified.concerns.length < 2) return { split: false, children: [], reason: 'Die Zerlegung ergab nur ein Anliegen.' };
  const children = verified.concerns.slice(0, MAX_CONCERNS).map(
    (c): SplitChild => ({
      intentKey: c.category,
      goal: c.goal,
      title: c.title,
      ...(c.grounded ? { segment: c.excerpt } : {}),
      ...(verified.sharedContext ? { sharedContext: verified.sharedContext } : {}),
    }),
  );
  const note = verified.coverage.unassigned.length > 0 ? ' (nicht zugeordnete Aussagen wurden als eigenes Anliegen ergänzt)' : '';
  return { split: true, children, reason: `${children.length} getrennte Anliegen in der Nachricht erkannt${note}.` };
}
