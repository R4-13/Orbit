/**
 * Erkennt eine Preisfrage in einer Anfrage („Was kostet das?“, „Wie teuer wird …?“). Rein und ohne KI: der Satz der Person wird wörtlich übernommen, nichts wird gedeutet. Die Frage bleibt so
 * auch dann sichtbar und beantwortbar, wenn die Anfrage zugleich ein Angebot wünscht (Meilenstein B, B3: eine Eingangsbestätigung allein beantwortet sie nicht).
 */
const PRICE_QUESTION = /(?:\b(?:was|wie\s*viel|wieviel|wie\s+hoch)\b[^.?!\n]{0,60}\b(?:kost\w*|preis\w*)\b|\bwie\s+teuer\b|\bpreis(?:e|vorstellung|schätzung|spanne)?\b[^.?!\n]{0,40}\?|\bkost(?:et|en|enpunkt)\b[^.?!\n]{0,40}\?)/i;

/** Der erste Satz mit einer Preisfrage (Betreff zuerst, dann Text), höchstens 300 Zeichen – sonst `undefined`. */
export function findPriceQuestion(subject: string | null | undefined, body: string | null | undefined): string | undefined {
  const sentences = [subject ?? '', body ?? ''].join('\n').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const hit = sentences.find((s) => PRICE_QUESTION.test(s));
  return hit ? hit.slice(0, 300) : undefined;
}

/** Schlüssel der Angabe, unter der die Preisfrage am Vorgang steht (Wortlaut der Kundschaft). */
export const PRICE_QUESTION_KEY = 'request.price_question';
