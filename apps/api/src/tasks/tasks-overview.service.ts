import { Injectable } from '@nestjs/common';
import { caseTypeDisplay, humanizeKnownKeys, internalHref, type TaskListItem, type TaskListResponse, type TaskSection } from '@orbit/shared';
import { periodRange } from '../dashboard/dashboard-time';
import { PrismaService } from '../prisma/prisma.service';

/**
 * UI v2 §15 — „Meine Arbeit zuerst“: Aufgaben nach überfällig / heute / später gegliedert, mit zugehörigem Vorgang und dem
 * erwarteten Ergebnis. Die Teamansicht liefert alle offenen Aufgaben; Berechtigungen prüft der Controller.
 */
@Injectable()
export class TasksOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, userId: string, input: { scope: 'MINE' | 'TEAM'; includeDone: boolean; timezone: string }, now: Date = new Date()): Promise<TaskListResponse> {
    const db = this.prisma.forTenantId(tenantId);
    const range = periodRange('TODAY', now, input.timezone);
    const mine = { OR: [{ assigneeId: userId }, { assigneeId: null }] };
    const rows = await db.task.findMany({
      where: { ...(input.scope === 'MINE' ? mine : {}), status: input.includeDone ? { in: ['OPEN', 'DONE'] } : 'OPEN' },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 300,
      include: { assignee: { select: { firstName: true, lastName: true } }, case: { select: { id: true, title: true, type: true, blueprintKey: true } } },
    });

    const sectionOf = (row: (typeof rows)[number]): TaskSection => {
      if (row.status === 'DONE') return 'DONE';
      if (!row.dueDate) return 'NO_DUE_DATE';
      if (row.dueDate < range.startOfToday) return 'OVERDUE';
      if (row.dueDate < range.endOfToday) return 'TODAY';
      return 'LATER';
    };

    const items = rows.map((row): TaskListItem => ({
      id: row.id,
      title: humanizeKnownKeys(row.title),
      expectedResult: row.description ? humanizeKnownKeys(row.description) : undefined,
      status: row.status,
      section: sectionOf(row),
      dueAt: row.dueDate?.toISOString(),
      assigneeLabel: row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}`.trim() : undefined,
      assignedToMe: row.assigneeId === userId,
      fromAssistant: row.source === 'AGENT',
      relatedCase: row.case ? { type: 'CASE', id: row.case.id, label: row.case.title, href: internalHref('CASE', row.case.id) } : undefined,
      caseHasProcess: Boolean(row.case?.blueprintKey),
      areaLabel: row.case ? caseTypeDisplay(row.case.type) : undefined,
      href: `/tasks?focus=${row.id}`,
    }));

    const order: Record<TaskSection, number> = { OVERDUE: 0, TODAY: 1, LATER: 2, NO_DUE_DATE: 3, DONE: 4 };
    items.sort((a, b) => order[a.section] - order[b.section] || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));

    const counts = { OVERDUE: 0, TODAY: 0, LATER: 0, NO_DUE_DATE: 0, DONE: 0 };
    for (const item of items) counts[item.section] += 1;
    return { items, total: items.length, counts, generatedAt: now.toISOString() };
  }
}
