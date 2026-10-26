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
}

const stem = (a: string, b: string): boolean => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)));

/** Wie viele Inhaltswörter des Textes kommen (gleichen Stamms) in der Beschreibung vor? */
export function overlap(text: string, reference: string): number {
  const ref = contentWords(reference);
  return contentWords(text).filter((w) => ref.some((r) => stem(w, r))).length;
}

/** Gehört die Aussage erkennbar zu einem anderen Anliegen als zum eigenen? */
export function belongsToOtherConcern(text: string, scope: ConcernScope): boolean {
  if (scope.siblings.length === 0) return false;
  const mine = overlap(text, scope.own);
  const other = Math.max(...scope.siblings.map((s) => overlap(text, s)));
  return other > mine;
}

/** Das Anliegen eines Teilvorgangs aus dem Ereignis der Aufteilung – `null`, wenn der Vorgang kein Teilvorgang ist. */
export async function concernScope(prisma: PrismaService, tenantId: string, caseId: string): Promise<ConcernScope | null> {
  const event = await prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId, type: 'case.split_from' }, orderBy: { sequence: 'asc' }, select: { payload: true } });
  const p = event?.payload as { goal?: string; segment?: string; siblings?: string[] } | null | undefined;
  if (!p?.goal) return null;
  return { own: `${p.goal} ${p.segment ?? ''}`.trim(), siblings: (p.siblings ?? []).filter((s) => typeof s === 'string' && s.length > 0) };
}
