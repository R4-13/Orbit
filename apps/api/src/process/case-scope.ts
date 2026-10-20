import type { PrismaService } from '../prisma/prisma.service';

/**
 * Die Vorgänge, deren eingegangene Nachrichten zu diesem Vorgang gehören: er selbst und – bei einem Teilvorgang einer aufgeteilten Nachricht (FX-02) – sein Hauptvorgang, der die
 * ursprüngliche Nachricht trägt, sowie die **Geschwister**. Eine Antwort der Kundschaft hängt an dem Teilvorgang, auf dessen Nachricht sie antwortet, kann aber Angaben für andere Teilvorgänge
 * enthalten; diese dürfen dadurch nicht verloren gehen. Bei absteigender Sortierung gewinnt die neueste Nachricht der Familie, bei aufsteigender die ursprüngliche (die des Hauptvorgangs).
 */
export async function messageCaseIds(prisma: PrismaService, tenantId: string, caseId: string): Promise<string[]> {
  const scoped = prisma.forTenantId(tenantId);
  const row = await scoped.case.findFirst({ where: { id: caseId }, select: { parentCaseId: true } });
  if (!row?.parentCaseId) return [caseId];
  const siblings = await scoped.case.findMany({ where: { parentCaseId: row.parentCaseId, id: { not: caseId } }, select: { id: true } });
  return [caseId, row.parentCaseId, ...siblings.map((s) => s.id)];
}

export interface SplitFocus {
  goal: string;
  /** Die Sätze der Nachricht, die zu diesem Anliegen gehören (wörtlich, belegt). */
  segment: string;
  /** Angaben, die für alle Anliegen der Nachricht gelten. */
  sharedContext: string;
}

/**
 * Bei einem Teilvorgang mit belegtem Auszug (Zerlegung der Nachricht): sein Anliegen und der gemeinsame Kontext. Die ganze Nachricht bleibt als Verständnishilfe zugänglich, Angaben und Ziele aus
 * den Auszügen anderer Anliegen werden aber nicht ungeprüft übernommen. `null`, wenn der Vorgang kein Teilvorgang ist oder kein belegter Auszug vorliegt.
 */
export async function splitFocus(prisma: PrismaService, tenantId: string, caseId: string): Promise<SplitFocus | null> {
  const event = await prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId, type: 'case.split_from' }, orderBy: { sequence: 'asc' }, select: { payload: true } });
  const payload = event?.payload as { goal?: string; segment?: string; sharedContext?: string } | null | undefined;
  if (!payload?.segment) return null;
  return { goal: payload.goal ?? '', segment: payload.segment, sharedContext: payload.sharedContext ?? '' };
}

/** Der Text, den ein Teilvorgang liest: sein Auszug zuerst, dann der gemeinsame Kontext, dann – ausdrücklich nur als Verständnishilfe – die ganze Nachricht. */
export function focusedMessageText(focus: SplitFocus, fullText: string): string {
  return [
    `DEIN ANLIEGEN (maßgeblich): ${focus.goal}\n${focus.segment}`,
    focus.sharedContext ? `GEMEINSAMER KONTEXT (gilt für alle Anliegen der Nachricht):\n${focus.sharedContext}` : '',
    `GANZE NACHRICHT (nur zum Verständnis des Zusammenhangs; Angaben, Fragen und Wünsche, die erkennbar zu einem anderen Anliegen gehören, gehören nicht zu deinem Anliegen):\n${fullText}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
