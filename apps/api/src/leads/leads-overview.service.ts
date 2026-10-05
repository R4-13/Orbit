import { Injectable } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import { internalHref, type LeadFilter, type LeadListItem, type LeadListResponse } from '@orbit/shared';
import { periodRange } from '../dashboard/dashboard-time';
import { PrismaService } from '../prisma/prisma.service';

const SOURCE_LABELS: Record<string, string> = { EMAIL: 'E-Mail', PHONE: 'Telefon', WEB: 'Web', MANUAL: 'Manuell' };
const STATUS: Record<string, { label: string; tone: LeadListItem['statusTone'] }> = {
  NEW: { label: 'Neu', tone: 'info' },
  QUALIFIED: { label: 'Qualifiziert', tone: 'success' },
  CONVERTED: { label: 'Konvertiert', tone: 'success' },
  DISQUALIFIED: { label: 'Disqualifiziert', tone: 'neutral' },
};
const FILTERS: LeadFilter[] = ['OPEN', 'NEW', 'REPLY_MISSING', 'DUE_TODAY', 'DONE', 'ALL'];

/**
 * UI v2 §13.1 — Vertrieb: „Offene Anfragen“ mit verständlichem nächsten Schritt; Filter Neu, Antwort fehlt, Heute fällig,
 * Abgeschlossen. Ableitung aus vorhandenen Daten (Vorgang, Aufgaben) – es werden keine eigenen Funnelstufen erfunden.
 */
@Injectable()
export class LeadsOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, input: { filter: LeadFilter; search?: string; timezone: string }, now: Date = new Date()): Promise<LeadListResponse> {
    const db = this.prisma.forTenantId(tenantId);
    const range = periodRange('TODAY', now, input.timezone);
    const q = input.search?.trim().toLowerCase() ?? '';

    const leads = await db.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { contact: true, company: { select: { name: true } }, case: { select: { id: true, title: true, orchestrationStatus: true, attentionReasons: true } } },
    });
    const caseIds = leads.map((lead) => lead.caseId).filter((id): id is string => Boolean(id));
    const tasks = caseIds.length > 0 ? await db.task.findMany({ where: { caseId: { in: caseIds }, status: 'OPEN' }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }) : [];
    const nextTask = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) if (task.caseId && !nextTask.has(task.caseId)) nextTask.set(task.caseId, task);

    const rows = leads.map((lead): LeadListItem & { _open: boolean } => {
      const task = lead.caseId ? nextTask.get(lead.caseId) : undefined;
      const replyMissing = lead.case?.orchestrationStatus === 'WAITING_FOR_INFORMATION';
      const dueToday = Boolean(task?.dueDate && task.dueDate < range.endOfToday);
      const status = STATUS[lead.status] ?? { label: lead.status, tone: 'neutral' as const };
      const contactLabel = `${lead.contact.firstName} ${lead.contact.lastName}`.trim();
      const nextStep = replyMissing
        ? 'Wartet auf die Antwort des Kunden'
        : (task?.title ?? lead.case?.attentionReasons[0] ?? (lead.status === 'NEW' ? 'Kontakt aufnehmen und einordnen' : lead.status === 'QUALIFIED' ? 'Angebot oder Termin vorbereiten' : 'Keine – abgeschlossen'));
      return {
        id: lead.id,
        contactLabel,
        companyLabel: lead.company?.name,
        sourceLabel: SOURCE_LABELS[lead.source] ?? lead.source,
        statusLabel: status.label,
        statusTone: status.tone,
        nextStep,
        dueAt: task?.dueDate?.toISOString(),
        replyMissing,
        dueToday,
        crmLabel: lead.contact.crmExternalId ? 'Im CRM bestätigt' : 'Noch nicht mit dem CRM abgeglichen',
        createdAt: lead.createdAt.toISOString(),
        caseRef: lead.case ? { type: 'CASE', id: lead.case.id, label: lead.case.title, href: internalHref('CASE', lead.case.id) } : undefined,
        href: internalHref('LEAD', lead.id) as string,
        _open: lead.status === 'NEW' || lead.status === 'QUALIFIED',
      };
    });

    const searched = q ? rows.filter((row) => `${row.contactLabel} ${row.companyLabel ?? ''}`.toLowerCase().includes(q)) : rows;
    const matches = (row: (typeof rows)[number], filter: LeadFilter): boolean => {
      switch (filter) {
        case 'OPEN':
          return row._open;
        case 'NEW':
          return row.statusLabel === 'Neu';
        case 'REPLY_MISSING':
          return row.replyMissing;
        case 'DUE_TODAY':
          return row.dueToday;
        case 'DONE':
          return !row._open;
        default:
          return true;
      }
    };
    const counts = Object.fromEntries(FILTERS.map((filter) => [filter, searched.filter((row) => matches(row, filter)).length])) as Record<LeadFilter, number>;
    const items = searched.filter((row) => matches(row, input.filter)).map(({ _open, ...item }) => item);
    return { items: items.slice(0, 100), total: items.length, counts, generatedAt: now.toISOString() };
  }
}
