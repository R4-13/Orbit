/**
 * Sinnerhalt bei Belegprüfungen (Funktionsnachweis 23.10.). Prüfungen wie „fast alle Zeichen stehen in derselben Reihenfolge in einem Satz“ (≥ 92 %) oder „alle Wörter in derselben Reihenfolge“ sind nur **Hilfen**:
 * Sie sagen, dass zwei Texte ähnlich sind, nicht, dass sie dasselbe bedeuten. Ein einziges Wort – „nicht“, „falls“, „ohne“, „nur“ – dreht den Sinn, ändert aber die Zeichenähnlichkeit kaum.
 *
 * Diese Datei erkennt deshalb **bedeutungstragende Einschränkungen** (Verneinung, Bedingung, Gegensatz, Begrenzung) deterministisch. Sie entscheidet nicht über Fachliches, sondern sichert zwei Regeln:
 *  1. Ein Beleg gilt nur, wenn Auszug und Originalsatz dieselben Einschränkungen tragen – eine eingefügte oder weggelassene Verneinung/Bedingung macht aus „ähnlich“ keinen Beleg.
 *  2. Bleibt die Beleglage unsicher, wird der **vollständige Originaltext** verwendet, nie die gekürzte oder umformulierte Fassung.
 */

/** Gruppen gleichbedeutender Wörter; die Gruppe zählt, nicht die Wortform („kein“, „keine“, „keinen“ sind eine Verneinung). */
const FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'nicht', pattern: /\b(?:nicht|nichts|niemand|nirgends|weder|keinesfalls|auf\s+keinen\s+fall)\b/gi },
  { id: 'kein', pattern: /\bkein\w*\b/gi },
  { id: 'nie', pattern: /\b(?:nie|niemals)\b/gi },
  { id: 'ohne', pattern: /\bohne\b/gi },
  { id: 'wenn', pattern: /\b(?:falls|wenn|sofern|soweit|solange|vorausgesetzt|vorbehaltlich|angenommen)\b|\bunter\s+der\s+bedingung\b|\bes\s+sei\s+denn\b/gi },
  { id: 'sonst', pattern: /\b(?:sonst|andernfalls|ansonsten)\b/gi },
  { id: 'ob', pattern: /\bob\b/gi },
  { id: 'ausser', pattern: /\b(?:au(?:ß|ss)er|abgesehen)\b/gi },
  { id: 'nur', pattern: /\b(?:nur|lediglich|ausschlie(?:ß|ss)lich|allein)\b/gi },
  { id: 'aber', pattern: /\b(?:aber|jedoch|allerdings|dagegen|dennoch|trotzdem)\b/gi },
  { id: 'grenze', pattern: /\b(?:fr(?:ü|ue)hestens|sp(?:ä|ae)testens|h(?:ö|oe)chstens|mindestens|maximal|bis\s+zu|nicht\s+vor|nicht\s+nach)\b/gi },
  { id: 'abhaengig', pattern: /\b(?:abh(?:ä|ae)ngig|je\s+nachdem|nach\s+absprache|nach\s+r(?:ü|ue)cksprache)\b/gi },
  { id: 'vielleicht', pattern: /\b(?:vielleicht|eventuell|m(?:ö|oe)glicherweise|vermutlich|wahrscheinlich|k(?:ö|oe)nnte|w(?:ä|ae)re|w(?:ü|ue)rde)\b/gi },
];

/** Die Einschränkungen eines Textes als sortierte Gruppen-Kennungen (ohne Wiederholung). */
export function qualifierMarkers(text: string): string[] {
  const found = new Set<string>();
  for (const family of FAMILIES) if (new RegExp(family.pattern.source, family.pattern.flags).test(text)) found.add(family.id);
  return [...found].sort();
}

export const hasQualifier = (text: string): boolean => qualifierMarkers(text).length > 0;

/** Einschränkungen, die der Originalsatz trägt, der gekürzte Auszug aber nicht (ausgelassene Verneinung, Bedingung …). */
export function omittedQualifiers(excerpt: string, original: string): string[] {
  const kept = new Set(qualifierMarkers(excerpt));
  return qualifierMarkers(original).filter((marker) => !kept.has(marker));
}

/** Einschränkungen, die der Auszug trägt, der Originalsatz aber nicht (eingefügte Verneinung, Bedingung …) – das ist Erfundenes, kein Beleg. */
export function insertedQualifiers(excerpt: string, original: string): string[] {
  const kept = new Set(qualifierMarkers(original));
  return qualifierMarkers(excerpt).filter((marker) => !kept.has(marker));
}

/** Aussage unter Vorbehalt (Bedingung, Vermutung, Alternative, Begrenzung): daraus darf nicht ohne Weiteres ein fester Wert oder eine feste Zusage werden. */
export function isHedged(sentence: string): boolean {
  const markers = qualifierMarkers(sentence);
  return markers.some((m) => ['wenn', 'sonst', 'ob', 'ausser', 'abhaengig', 'vielleicht', 'grenze'].includes(m)) || /\boder\b/i.test(sentence);
}
