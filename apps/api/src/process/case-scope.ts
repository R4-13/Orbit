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
