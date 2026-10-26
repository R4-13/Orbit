import type { PrismaService } from '../prisma/prisma.service';
import { isSafeCustomerText } from './reference/request-analysis';

/** Wie die Kundschaft ein Anliegen einer aufgeteilten Nachricht kennt: der Titel des Teilvorgangs (vor dem Doppelpunkt), sonst sein Ziel – nur, was als Kundentext sicher ist. */
export async function familyLabel(prisma: PrismaService, tenantId: string, child: { id: string; title: string }): Promise<string> {
  const split = await prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId: child.id, type: 'case.split_from' }, orderBy: { sequence: 'asc' }, select: { payload: true } });
  const goal = (split?.payload as { goal?: string } | null | undefined)?.goal?.trim().replace(/[.\s]+$/, '');
  const title = child.title.replace(/:.*$/, '').trim();
  const safe = (t: string | undefined): t is string => Boolean(t) && (t as string).length >= 3 && (t as string).length <= 100 && isSafeCustomerText(t as string).safe;
  const pick = safe(title) ? title : safe(goal) ? goal : title;
  return pick.replace(/[„“"]/g, '').slice(0, 100);
}
