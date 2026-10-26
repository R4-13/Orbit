import type { PrismaService } from '../prisma/prisma.service';
import { contentWords } from './fact-correction.service';

/**
 * Zuordnung zu einem Anliegen (Meilenstein C, K1). Ein Teilvorgang bearbeitet genau ein Anliegen einer Nachricht; Modelle verteilen Fragen, Ziele und Aufgaben trotz Anweisung gern auf alle Anliegen
 * („beide Teilvorgänge fragten nach dem Regler“). Dieser Maßstab prüft deterministisch am Wortlaut: eine Aussage gehört zu einem anderen Anliegen, wenn sie mit dessen Beschreibung mehr Inhaltswörter
 * teilt als mit dem eigenen Anliegen. Aussagen ohne erkennbaren Bezug (Eingangsbestätigung, Gruß) bleiben.
 */
export interface ConcernScope {
  /** Das eigene Anliegen: Kurzfassung und – falls belegt – der Auszug der Nachricht. */
  own: string;
  /** Die Anliegen der Geschwister (Kurzfassungen). */
  siblings: string[];
  /** Das eigene Anliegen in den Worten der Aufteilung und – falls belegt – der Satz der Nachricht dazu. */
  goal?: string;
  segment?: string;
}

/** Gleicher Wortstamm: gleich, gleicher Wortanfang, ineinander enthalten oder ein gemeinsames Wortstück von mindestens sechs Buchstaben (Zusammensetzungen und Beugung: Terminverschiebung ~ Wartungstermin, verschieben ~ Verschiebung). */
const stem = (a: string, b: string): boolean => {
  if (a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)))) return true;
  for (let i = 0; i + 6 <= a.length; i += 1) if (b.includes(a.slice(i, i + 6))) return true;
  return false;
};

/** Wie viele Inhaltswörter des Textes kommen (gleichen Stamms) in der Beschreibung vor? */
export function overlap(text: string, reference: string): number {
  const ref = contentWords(reference);
  return contentWords(text).filter((w) => ref.some((r) => stem(w, r))).length;
}

/** Kommt in der Aussage ein Inhaltswort vor, das nur zu einem Geschwister-Anliegen passt (nicht zum eigenen)? Dann vermischt die Aussage mehrere Anliegen. */
export function mentionsOtherConcern(text: string, scope: ConcernScope): boolean {
  const own = contentWords(scope.own);
  const foreign = contentWords(scope.siblings.join(' ')).filter((w) => !own.some((o) => stem(w, o)));
  return contentWords(text).some((w) => foreign.some((f) => stem(w, f)));
}

/** Gehört die Aussage erkennbar zu einem anderen Anliegen als zum eigenen? */
export function belongsToOtherConcern(text: string, scope: ConcernScope): boolean {
  if (scope.siblings.length === 0) return false;
  const mine = overlap(text, scope.own);
  const other = Math.max(...scope.siblings.map((s) => overlap(text, s)));
  return other > mine;
}

/** Gehört die Aussage erkennbar zum eigenen Anliegen (mehr Überschneidung mit ihm als mit jedem Geschwister)? */
export function belongsToOwnConcern(text: string, scope: ConcernScope): boolean {
  const mine = overlap(text, scope.own);
  if (mine === 0) return false;
  return scope.siblings.every((s) => overlap(text, s) < mine);
}

/** Das Anliegen eines Teilvorgangs aus dem Ereignis der Aufteilung – `null`, wenn der Vorgang kein Teilvorgang ist. */
export async function concernScope(prisma: PrismaService, tenantId: string, caseId: string): Promise<ConcernScope | null> {
  const event = await prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId, type: 'case.split_from' }, orderBy: { sequence: 'asc' }, select: { payload: true } });
  const p = event?.payload as { goal?: string; segment?: string; siblings?: string[] } | null | undefined;
  if (!p?.goal) return null;
  return { own: `${p.goal} ${p.segment ?? ''}`.trim(), siblings: (p.siblings ?? []).filter((s) => typeof s === 'string' && s.length > 0), goal: p.goal, ...(p.segment ? { segment: p.segment } : {}) };
}
