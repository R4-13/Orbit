import { contentWords } from './fact-correction.service';
import { overlapWords, type ConcernScope } from './concern-scope';

/**
 * Zuordnung einer Antwort der Kundschaft zu den Anliegen einer aufgeteilten Nachricht aus dem Gesprächszusammenhang (Meilenstein C, Nachbesserung): nicht nur gemeinsame Inhaltswörter mit dem Anliegen,
 * sondern auch mit den **tatsächlich gestellten Rückfragen** und den offenen Anforderungen. Reine Funktionen; die Anbindung an Vorgänge und Modell steht in `ReplyRoutingService`.
 *
 *  - Eine Aussage gehört zu dem Anliegen, mit dessen Gegenstand oder Rückfrage sie die meisten Inhaltswörter teilt.
 *  - Teilen mehrere Anliegen gleich viel, aber verschiedene Wörter (die Aussage spricht von beiden), gilt sie für alle diese Anliegen („gemeinsame Angabe“).
 *  - Hat die Aussage keinen Bezug zu einem Gegenstand („Bitte beides.“), gehört sie zur einzigen offenen Rückfrage – gibt es mehrere, ist die Zuordnung offen (Rückfrage an die Kundschaft).
 */
export interface RoutingChild {
  id: string;
  /** Wie die Kundschaft das Anliegen kennt. */
  label: string;
  scope: ConcernScope;
  /** Die an die Kundschaft gestellten und noch offenen Rückfragen dieses Anliegens (wörtlich). */
  asked: string[];
  /** Wartet das Anliegen auf eine Antwort der Kundschaft? */
  awaiting: boolean;
}

export type RoutingBasis = 'TOPIC' | 'ONLY_OPEN_QUESTION' | 'SHARED' | 'MODEL';

export interface RoutedStatement {
  text: string;
  childIds: string[];
  basis: RoutingBasis;
}

export interface AmbiguousStatement {
  text: string;
  /** Die in Frage kommenden Anliegen (Teilvorgänge mit offener Rückfrage bzw. mit gleichem Bezug). */
  candidates: string[];
}

export interface RoutingResult {
  assigned: RoutedStatement[];
  ambiguous: AmbiguousStatement[];
  /** Höflichkeitsformeln und Aussagen ohne Bezug, ohne dass ein Anliegen auf eine Antwort wartet: bleiben am Hauptvorgang lesbar. */
  unplaced: string[];
}

const COURTESY = /^(?:(?:sehr geehrte[^,.!?]*|guten (?:tag|morgen|abend)|hallo(?: zusammen)?|liebe[rs]?[^,.!?]*|danke(?: schön| sehr| vielmals| vorab)?|vielen dank(?: im voraus| vorab)?|besten dank|dankeschön|mit freundlichen gr[üu](?:ß|ss)en|freundliche gr[üu](?:ß|ss)e|viele gr[üu](?:ß|ss)e|beste gr[üu](?:ß|ss)e|herzliche gr[üu](?:ß|ss)e|gr[üu](?:ß|ss)e|mfg|lg|thanks|thank you|kind regards|best regards|regards)[\s,.!:;–-]*)+$/i;

/** Nur Anrede, Gruß, Dank oder Unterschrift? */
export function isCourtesy(statement: string): boolean {
  const text = statement.trim();
  if (text.length === 0) return true;
  if (COURTESY.test(text)) return true;
  // Eine Unterschrift („Tom Orbit“): kurz, ohne Satzzeichen mitten drin, ohne Verb – nicht von Antworten wie „Beides“ zu trennen; deshalb nur die Formeln oben.
  return false;
}

const wordsOf = (text: string): string[] => contentWords(text);

/** Eine Aussage gegen ein Anliegen: die Wörter, die sie mit dessen Gegenstand und den gestellten Rückfragen teilt. */
function matched(statement: string, child: RoutingChild): string[] {
  return overlapWords(statement, `${child.scope.own} ${child.asked.join(' ')}`);
}

export function routeStatements(statements: readonly string[], children: readonly RoutingChild[]): RoutingResult {
  const result: RoutingResult = { assigned: [], ambiguous: [], unplaced: [] };
  const open = children.filter((c) => c.awaiting && c.asked.length > 0);
  for (const text of statements) {
    if (isCourtesy(text) || (wordsOf(text).length === 0 && text.trim().length < 2)) continue;
    const scored = children.map((child) => ({ child, words: matched(text, child) }));
    const best = Math.max(0, ...scored.map((s) => s.words.length));
    if (best > 0) {
      const winners = scored.filter((s) => s.words.length === best);
      if (winners.length === 1) {
        result.assigned.push({ text, childIds: [winners[0]!.child.id], basis: 'TOPIC' });
        continue;
      }
      // Gleich viele Treffer bei mehreren Anliegen: spricht die Aussage von beiden (verschiedene Wörter), gilt sie für beide; trifft sie dieselben Wörter, ist sie nicht zuzuordnen.
      const seen = new Map<string, number>();
      for (const w of winners.flatMap((s) => s.words)) seen.set(w, (seen.get(w) ?? 0) + 1);
      const distinct = winners.every((s) => s.words.every((w) => seen.get(w) === 1));
      if (distinct) result.assigned.push({ text, childIds: winners.map((s) => s.child.id), basis: 'SHARED' });
      else result.ambiguous.push({ text, candidates: winners.map((s) => s.child.id) });
      continue;
    }
    // Kein Gegenstandsbezug: die Antwort gehört zur einzigen offenen Rückfrage.
    if (open.length === 1) result.assigned.push({ text, childIds: [open[0]!.id], basis: 'ONLY_OPEN_QUESTION' });
    else if (open.length > 1) result.ambiguous.push({ text, candidates: open.map((c) => c.id) });
    else result.unplaced.push(text);
  }
  return result;
}

/** Die Rückfragen eines Entwurfs-Kerns: die nummerierten bzw. mit Strichen aufgeführten Zeilen, sonst alle Zeilen (ohne Einleitungssatz, wenn es Listenzeilen gibt). */
export function askedLines(core: readonly string[]): string[] {
  const listed = core.filter((l) => /^\s*(?:\d+[.)]|[-*•])\s+\S/.test(l)).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim());
  if (listed.length > 0) return listed;
  return core.map((l) => l.trim()).filter((l) => l.length > 0);
}

export interface ModelDecision {
  /** 1-basiert in der Liste der vorgelegten offenen Aussagen. */
  statement: number;
  /** 1-basiert in der Liste der vorgelegten Anliegen. */
  concerns: number[];
  certain: boolean;
}

/**
 * Wendet die Entscheidungen des Modells auf die offenen Aussagen an – nur eindeutige (`certain`) mit gültigen Verweisen; alles andere bleibt offen und wird der Kundschaft als Rückfrage vorgelegt.
 * Das Modell entscheidet nie allein über den Wortlaut: jede Aussage stammt unverändert aus der Nachricht der Kundschaft.
 */
export function applyModelDecisions(open: readonly AmbiguousStatement[], concernIds: readonly string[], decisions: readonly ModelDecision[]): { assigned: RoutedStatement[]; ambiguous: AmbiguousStatement[] } {
  const assigned: RoutedStatement[] = [];
  const decided = new Set<number>();
  for (const d of decisions) {
    const statement = open[d.statement - 1];
    const ids = [...new Set(d.concerns.map((n) => concernIds[n - 1]).filter((id): id is string => id !== undefined))];
    if (!statement || decided.has(d.statement) || !d.certain || ids.length === 0 || ids.length !== new Set(d.concerns).size) continue;
    decided.add(d.statement);
    assigned.push({ text: statement.text, childIds: ids, basis: 'MODEL' });
  }
  return { assigned, ambiguous: open.filter((_, i) => !decided.has(i + 1)) };
}
