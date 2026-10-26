import { z } from 'zod';
import type { SplitChild, SplitDecision } from './case-split';
import { hasQualifier, insertedQualifiers, omittedQualifiers } from './meaning-guard';

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
  /**
   * Einschränkungen (Verneinung, Bedingung …), die der Originalsatz trägt, der Auszug der KI aber nicht. Titel und Ziel der KI können dann den Sinn verfehlen; für den Teilvorgang gilt der **vollständige Originaltext**
   * (siehe `splitDecisionFromConcerns`).
   */
  meaningRisk?: string[];
}

export interface ConcernCoverage {
  /** Anzahl inhaltlich tragender Aussagen (Fragen, Bitten, Wünsche) der Nachricht. */
  substantive: number;
  /** Davon keinem Anliegen und nicht dem gemeinsamen Kontext zugeordnet (vor der Ergänzung). */
  unassigned: string[];
  /** Nicht belegte Auszüge (Titel). */
  ungrounded: string[];
  /** Anliegen, deren Auszug eine Einschränkung des Originalsatzes ausließ (Titel): für sie gilt der Originaltext statt des Ziels der KI. */
  meaningRisk: string[];
  /** Sätze mit Einschränkung (Verneinung/Bedingung), die keine eigene Aussage sind und dem benachbarten Anliegen (sonst dem gemeinsamen Kontext) zugeschlagen wurden. */
  qualifiersAttached: string[];
}

export interface VerifiedConcerns {
  concerns: VerifiedConcern[];
  sharedContext: string;
  coverage: ConcernCoverage;
}

/** Zerlegt Text in Sätze/Zeilen; Aufzählungszeichen und Nummerierung werden entfernt. */
export function splitSentences(text: string): string[] {
  // Ein Zeilenumbruch mitten im Satz (E-Mails brechen Zeilen nach etwa 72 Zeichen um) ist keine Satzgrenze: folgt auf den Umbruch ein Kleinbuchstabe, geht der Satz weiter (Funktionsnachweis 23.10.: „…auf den 4.11.⏎verschieben“ wurde in zwei Sätze zerlegt und ein Anliegen blieb unbelegt).
  // Auch vor einem Großbuchstaben (deutsche Hauptwörter: „…für eine⏎Heizungswartung frei?“): ein Umbruch hinter einer Zeile ohne Satzzeichen am Ende, vor einer Zeile ohne Listenzeichen und ohne Leerzeile, setzt den Satz fort
  // (Meilenstein C: ein umgebrochener Satz wurde zerlegt, die zweite Hälfte als „weiteres Anliegen“ ergänzt).
  const unwrapped = text.replace(/([^.!?…:;\s])[ \t]*\r?\n[ \t]*(?!(?:[-*•–]|\d+[.)])\s)(?=[^\s])/g, '$1 ').replace(/[ \t]*\r?\n[ \t]*(?=[a-zäöüß])/g, ' ');
  return unwrapped
    .split(/(?<=[.!?…])(?<!\d\.)(?<!\b(?:[Nn]r|[Hh]r|[Ff]r|[Dd]r|ca|bzw|usw|etc|ggf|inkl|evtl|vgl|[Ss]tr|[Tt]el)\.)\s+|(?<=\d\.)\s+(?=[A-ZÄÖÜ0-9„"(])|\r?\n+/)
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
  let s = sentence.trim();
  // Anrede, Gruß und Dank stehen oft vor einem echten Anliegen („Danke und bitte rufen Sie zurück“): erst die Floskel abtrennen, dann den Rest prüfen. Bleibt nichts Tragendes, ist es keine Aussage.
  const greeting = /^(?:sehr geehrte[^,.!?]*|guten (?:tag|morgen|abend)|hallo(?: zusammen)?|liebe[rs]?[^,.!?]*|mit freundlichen gr[üu](?:ß|ss)en|freundliche gr[üu](?:ß|ss)e|viele gr[üu](?:ß|ss)e|beste gr[üu](?:ß|ss)e|herzliche gr[üu](?:ß|ss)e|vielen dank(?: im voraus| vorab| schon mal)?|besten dank|danke(?: schön| sehr| vorab| im voraus)?)[\s,.!:;–-]*(?:und\s+)?/i;
  for (let i = 0; i < 3; i += 1) {
    const rest = s.replace(greeting, '');
    if (rest === s) break;
    s = rest.trim();
  }
  if (s.length < 12) return false;
  return s.includes('?') || REQUEST_CUES.test(s);
}

/**
 * Prüft die Zerlegung gegen die Nachricht. Ergibt belegte Anliegen (Reihenfolge der Nachricht bleibt die der KI), den Nachweis der Vollständigkeit und – falls nötig – ein ergänztes Anliegen
 * für Aussagen, die niemand zugeordnet hat.
 */
function tokensOf(text: string): string[] {
  return normalizeForMatch(text)
    .split(' ')
    .filter((t) => t.length > 0);
}

function isSubsequenceOf(needle: readonly string[], haystack: readonly string[]): boolean {
  let position = 0;
  for (const token of needle) {
    const index = haystack.indexOf(token, position);
    if (index < 0) return false;
    position = index + 1;
  }
  return true;
}

/** Länge der längsten gemeinsamen Teilfolge zweier Zeichenketten (Zeichen für Zeichen). */
function lcsLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) current[j] = a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
    previous = current;
  }
  return previous[b.length]!;
}

const compact = (text: string): string => normalizeForMatch(text).replace(/[^a-z0-9äöüß]/g, '');

/** Der Satz der Nachricht, in dem fast alle Zeichen des Auszugs in dieser Reihenfolge vorkommen (≥ 92 % bei mindestens 20 Zeichen); sonst nichts. */
function closestSentence(part: string, sentences: ReadonlyArray<{ raw: string; tokens: string[] }>): { raw: string; tokens: string[] } | undefined {
  const needle = compact(part);
  if (needle.length < 20) return undefined;
  let best: { sentence: { raw: string; tokens: string[] }; ratio: number } | undefined;
  for (const sentence of sentences) {
    const ratio = lcsLength(needle, compact(sentence.raw)) / needle.length;
    if (ratio >= 0.92 && (!best || ratio > best.ratio)) best = { sentence, ratio };
  }
  return best?.sentence;
}

const tokenContains = (haystack: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) if (needle.every((t, k) => haystack[i + k] === t)) return true;
  return false;
};


export function verifyConcerns(message: string, segmentation: ConcernSegmentation): VerifiedConcerns {
  const messageSentences = splitSentences(message).map((raw) => ({ raw, tokens: tokensOf(raw) }));
  /**
   * Belegt wird satzweise gegen die Sätze der Nachricht: alle Wörter des Auszugs (ab drei Wörtern in derselben Reihenfolge; kürzere nur, wenn sie praktisch den ganzen Satz ausmachen) müssen in EINEM Satz
   * der Nachricht stehen. Verwendet wird dann **immer der vollständige Originalsatz**, nie der gekürzte Text der KI. Wortgleichheit und Zeichenähnlichkeit sind dabei nur Hilfen (Funktionsnachweis 23.10.):
   *  - eine **ausgelassene** Verneinung/Bedingung bleibt im Originalsatz; sie wird als `meaningRisk` vermerkt, weil Titel und Ziel der KI den Sinn dann verfehlen können (für den Teilvorgang gilt der Originaltext),
   *  - eine **eingefügte** Verneinung/Bedingung (Auszug trägt eine Einschränkung, der Originalsatz nicht) macht den Auszug unbelegt – auch bei hoher Zeichenähnlichkeit,
   *  - ein Auszug, dessen Beleg unsicher bleibt, wird nicht verwendet; der Teilvorgang bekommt dann die vollständige Nachricht.
   */
  const ground = (text: string): { ok: boolean; expanded: string; meaningRisk: string[] } => {
    const parts = splitSentences(text).filter((part) => tokensOf(part).length > 0);
    const used: string[] = [];
    const risk = new Set<string>();
    let found = 0;
    for (const part of parts) {
      const tokens = tokensOf(part);
      const matches = messageSentences.filter((m) => (tokens.length >= 3 ? isSubsequenceOf(tokens, m.tokens) : m.tokens.length <= tokens.length + 2 && tokenContains(m.tokens, tokens)));
      let best = [...matches].sort((x, y) => x.tokens.length - y.tokens.length)[0];
      if (best) {
        for (const marker of omittedQualifiers(part, best.raw)) risk.add(marker);
      } else {
        // Ein Auszug mit Zeichenfehlern der KI („telefon isch“, ein eingestreuter Buchstabe) gilt als belegt, wenn fast alle Zeichen in der Reihenfolge eines einzigen Satzes stehen (≥ 92 %) – aber nur, wenn
        // beide dieselben Einschränkungen tragen: ein eingefügtes oder fehlendes „nicht“/„falls“ ändert die Zeichenähnlichkeit kaum und den Sinn vollständig.
        const close = closestSentence(part, messageSentences);
        if (close && insertedQualifiers(part, close.raw).length === 0 && omittedQualifiers(part, close.raw).length === 0) best = close;
      }
      if (!best) continue;
      found += 1;
      if (!used.includes(best.raw)) used.push(best.raw);
    }
    return { ok: parts.length > 0 && found / parts.length >= 0.8, expanded: used.join(' '), meaningRisk: [...risk].sort() };
  };
  const concerns: VerifiedConcern[] = segmentation.concerns.map((c) => {
    const grounded = ground(c.excerpt);
    return { ...c, excerpt: grounded.ok ? grounded.expanded : c.excerpt, grounded: grounded.ok, ...(grounded.ok && grounded.meaningRisk.length > 0 ? { meaningRisk: grounded.meaningRisk } : {}) };
  });
  const sharedResult = segmentation.sharedContext ? ground(segmentation.sharedContext) : { ok: false, expanded: '', meaningRisk: [] as string[] };
  let sharedGrounded = sharedResult.ok ? sharedResult.expanded : '';

  const assigned = new Set<string>();
  for (const c of concerns) if (c.grounded) for (const s of splitSentences(c.excerpt)) assigned.add(normalizeForMatch(s));
  for (const s of splitSentences(sharedGrounded)) assigned.add(normalizeForMatch(s));

  const all = splitSentences(message);
  const substantive = all.filter(isSubstantiveSentence);
  const isAssigned = (sentence: string): boolean => {
    const n = normalizeForMatch(sentence);
    if (assigned.has(n)) return true;
    // Ein Satz, der Teil eines längeren zugeordneten Satzes ist (oder umgekehrt), gilt als zugeordnet.
    for (const a of assigned) if (a.includes(n) || n.includes(a)) return true;
    return false;
  };
  const unassigned = substantive.filter((s) => !isAssigned(s));

  // Ein Satz mit Verneinung oder Bedingung, der selbst keine Frage oder Bitte ist („Aber nur, wenn Frau Meier da ist.“, „Vorher bitte nicht anrufen“ wäre tragend), gehört zu dem Satz davor oder danach.
  // Fehlt er in der Zuordnung, geht eine Einschränkung verloren, die den Sinn des Anliegens bestimmt: er wird dem benachbarten Anliegen zugeschlagen, sonst dem gemeinsamen Kontext.
  const qualifiersAttached: string[] = [];
  const ownerOf = (sentence: string): VerifiedConcern | undefined => concerns.find((c) => c.grounded && splitSentences(c.excerpt).some((x) => normalizeForMatch(x) === normalizeForMatch(sentence)));
  all.forEach((sentence, index) => {
    if (isAssigned(sentence) || isSubstantiveSentence(sentence) || sentence.length < 12 || !hasQualifier(sentence)) return;
    const owner = (index > 0 ? ownerOf(all[index - 1]!) : undefined) ?? (index + 1 < all.length ? ownerOf(all[index + 1]!) : undefined);
    if (owner) owner.excerpt = `${owner.excerpt} ${sentence}`.trim();
    else sharedGrounded = `${sharedGrounded} ${sentence}`.trim();
    assigned.add(normalizeForMatch(sentence));
    qualifiersAttached.push(sentence);
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
    coverage: {
      substantive: substantive.length,
      unassigned,
      ungrounded: concerns.filter((c) => !c.grounded).map((c) => c.title),
      meaningRisk: concerns.filter((c) => c.meaningRisk && c.meaningRisk.length > 0).map((c) => c.title),
      qualifiersAttached,
    },
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

/** Das Ziel aus dem Originalwortlaut statt aus der Formulierung der KI – wenn deren Auszug eine Verneinung oder Bedingung ausließ, trägt nur der Originaltext den Sinn. */
function goalFromOriginal(excerpt: string): string {
  const quote = excerpt.length > 360 ? `${excerpt.slice(0, 357)}…` : excerpt;
  return `Das Anliegen laut Originaltext bearbeiten, einschließlich aller Einschränkungen: „${quote}“`;
}

/** Aus der geprüften Zerlegung wird die Aufteilungsentscheidung: ab zwei Anliegen ein Teilvorgang je Anliegen (Obergrenze der gleichzeitig bearbeiteten regelt der Aufrufer). */
export function splitDecisionFromConcerns(verified: VerifiedConcerns): SplitDecision {
  if (verified.concerns.length < 2) return { split: false, children: [], reason: 'Die Zerlegung ergab nur ein Anliegen.' };
  const children = verified.concerns.slice(0, MAX_CONCERNS).map(
    (c): SplitChild => ({
      intentKey: c.category,
      goal: c.grounded && c.meaningRisk && c.meaningRisk.length > 0 ? goalFromOriginal(c.excerpt) : c.goal,
      title: c.title,
      ...(c.grounded ? { segment: c.excerpt } : {}),
      ...(verified.sharedContext ? { sharedContext: verified.sharedContext } : {}),
    }),
  );
  const notes = [
    verified.coverage.unassigned.length > 0 ? 'nicht zugeordnete Aussagen wurden als eigenes Anliegen ergänzt' : '',
    verified.coverage.meaningRisk.length > 0 ? 'bei ausgelassenen Einschränkungen gilt der Originaltext' : '',
    verified.coverage.qualifiersAttached.length > 0 ? 'Sätze mit Einschränkung wurden dem Anliegen zugeschlagen' : '',
  ].filter(Boolean);
  const note = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  return { split: true, children, reason: `${children.length} getrennte Anliegen in der Nachricht erkannt${note}.` };
}
