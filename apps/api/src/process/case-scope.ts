import type { PrismaService } from '../prisma/prisma.service';

/**
 * Die Vorgänge, deren eingegangene Nachrichten zu diesem Vorgang gehören: er selbst und – bei einem Teilvorgang einer aufgeteilten Nachricht (FX-02) – sein Hauptvorgang, der die
 * Nachricht trägt. Eigene (neuere) Nachrichten des Teilvorgangs gehen bei absteigender Sortierung vor; die ursprüngliche Nachricht steht bei aufsteigender Sortierung vorn.
 */
export async function messageCaseIds(prisma: PrismaService, tenantId: string, caseId: string): Promise<string[]> {
  const row = await prisma.forTenantId(tenantId).case.findFirst({ where: { id: caseId }, select: { parentCaseId: true } });
  return row?.parentCaseId ? [caseId, row.parentCaseId] : [caseId];
}
