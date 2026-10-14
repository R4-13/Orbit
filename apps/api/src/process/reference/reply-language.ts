/**
 * Sprache der Antwort an die Kundschaft (AUT-07). Die Rahmentexte der Mitteilungen gibt es auf Deutsch und Englisch. Erkannt wird die Sprache der eingegangenen
 * Nachricht an häufigen Funktionswörtern – deterministisch, ohne KI-Aufruf und ohne Kosten; bei Unsicherheit gilt die erste Sprache des Betriebs.
 * Geantwortet wird nur in Sprachen, die der Betrieb im Profil angegeben hat (Standard: Deutsch) – eine Antwort in einer Sprache, die der Betrieb nicht pflegt,
 * wäre ein Versprechen, das niemand lesen kann.
 */
export type ReplyLanguage = 'de' | 'en';
export const SUPPORTED_REPLY_LANGUAGES: readonly ReplyLanguage[] = ['de', 'en'];

const GERMAN = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'wir', 'sie', 'ein', 'eine', 'bitte', 'danke', 'für', 'mit', 'auf', 'zu', 'von', 'den', 'dem', 'haben', 'wie', 'wann', 'auch', 'sind', 'sehr', 'guten', 'tag', 'hallo', 'grüße', 'grüßen', 'freundlichen', 'angebot', 'rechnung', 'termin']);
const ENGLISH = new Set(['the', 'and', 'is', 'not', 'we', 'you', 'your', 'our', 'please', 'thank', 'thanks', 'for', 'with', 'to', 'of', 'have', 'how', 'when', 'also', 'are', 'very', 'hello', 'dear', 'regards', 'kind', 'best', 'quote', 'invoice', 'appointment', 'would', 'could', 'can', 'need', 'my', 'this', 'that']);

export function detectLanguage(text: string): ReplyLanguage | undefined {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  if (words.length < 4) return undefined;
  let de = 0;
  let en = 0;
  for (const word of words) {
    if (GERMAN.has(word)) de += 1;
    if (ENGLISH.has(word)) en += 1;
  }
  if (de + en < 2) return undefined;
  // Ein klarer Abstand: bei Gleichstand oder knappem Vorsprung entscheidet nicht die Erkennung.
  if (de >= en * 1.5) return 'de';
  if (en >= de * 1.5) return 'en';
  return undefined;
}

/** Sprache der Antwort: die erkannte Sprache der Nachricht, wenn der Betrieb sie führt; sonst die erste unterstützte Sprache des Betriebs, sonst Deutsch. */
export function replyLanguage(inboundText: string | null | undefined, tenantLanguages: readonly string[] | null | undefined): ReplyLanguage {
  const offered = (tenantLanguages ?? ['de']).filter((l): l is ReplyLanguage => (SUPPORTED_REPLY_LANGUAGES as readonly string[]).includes(l));
  const fallback: ReplyLanguage = offered[0] ?? 'de';
  const detected = inboundText ? detectLanguage(inboundText) : undefined;
  return detected && offered.includes(detected) ? detected : fallback;
}
