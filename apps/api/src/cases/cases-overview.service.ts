import { Injectable } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import {
  CASE_ORCHESTRATION_LABELS,
  NotFoundError,
  caseTypeDisplay,
  internalHref,
  type CaseListFilter,
  type CaseListItem,
  type CaseListResponse,
  type CaseOrchestrationStatusValue,
  type EntityRef,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

export const CASE_PAGE_SIZE = 25;

const TERMINAL = ['COMPLETED', 'REJECTED', 'CANCELLED'] as const;
const ATTENTION_STATES = ['MANUAL_REVIEW', 'WAITING_FOR_APPROVAL', 'FAILED'] as const;

const TONES: Record<CaseOrchestrationStatusValue, CaseListItem['statusTone']> = {
  RECEIVED: 'neutral',
  READY: 'info',
  IN_PROGRESS: 'info',
  WAITING_FOR_INFORMATION: 'warning',
  WAITING_FOR_APPROVAL: 'warning',
  WAITING_FOR_EXTERNAL_SYSTEM: 'warning',
  PAUSED: 'neutral',
  MANUAL_REVIEW: 'warning',
  COMPLETED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

const NEXT_STEPS: Record<CaseOrchestrationStatusValue, string> = {
  RECEIVED: 'Wird geprüft',
  READY: 'Bearbeitung startet',
  IN_PROGRESS: 'ORBIT arbeitet daran',
  WAITING_FOR_INFORMATION: 'Wartet auf eine Antwort oder fehlende Angaben',
  WAITING_FOR_APPROVAL: 'Ihre Freigabe ist erforderlich',
  WAITING_FOR_EXTERNAL_SYSTEM: 'Wartet auf ein externes System',
  PAUSED: 'Angehalten – Fortsetzen möglich',
  MANUAL_REVIEW: 'Bitte prüfen und entscheiden',
  COMPLETED: 'Abgeschlossen',
  REJECTED: 'Abgelehnt',
  CANCELLED: 'Abgebrochen',
  FAILED: 'Bearbeitung fehlgeschlagen – bitte ansehen',
};

function whereFor(filter: CaseListFilter, type: 'FINANCE' | 'SALES' | undefined, search: string | undefined): Prisma.CaseWhereInput {
  const and: Prisma.CaseWhereInput[] = [];
  if (type) and.push({ type });
  const q = search?.trim();
  if (q && q.length >= 2) and.push({ title: { contains: q, mode: 'insensitive' } });
  switch (filter) {
    case 'OPEN':
      and.push({ orchestrationStatus: { notIn: [...TERMINAL] }, status: { notIn: ['DONE', 'CANCELLED'] } });
      break;
    case 'ATTENTION':
      and.push({ orchestrationStatus: { in: [...ATTENTION_STATES] } });
      break;
    case 'DONE':
      and.push({ OR: [{ orchestrationStatus: { in: [...TERMINAL] } }, { status: { in: ['DONE', 'CANCELLED'] } }] });
      break;
    default:
      break;
  }
  return and.length > 0 ? { AND: and } : {};
}

/** UI v2 §16.1 — die Vorgangsübersicht: fachlicher Titel, Gegenüber, Status, nächster Schritt, Verantwortlicher, Aktualität (keine Agentlauf-IDs). */
@Injectable()
export class CasesOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, input: { filter: CaseListFilter; type?: 'FINANCE' | 'SALES'; page: number; search?: string }, now: Date = new Date()): Promise<CaseListResponse> {
    const db = this.prisma.forTenantId(tenantId);
    const page = Math.max(1, input.page);
    const where = whereFor(input.filter, input.type, input.search);
    const filters: CaseListFilter[] = ['OPEN', 'ATTENTION', 'DONE', 'ALL'];

    const [rows, total, ...counts] = await Promise.all([
      db.case.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * CASE_PAGE_SIZE, take: CASE_PAGE_SIZE, include: { assignee: { select: { firstName: true, lastName: true } } } }),
      db.case.count({ where }),
      ...filters.map((filter) => db.case.count({ where: whereFor(filter, input.type, input.search) })),
    ]);

    const items = await this.present(tenantId, rows);

    return {
      items,
      total,
      page,
      pageSize: CASE_PAGE_SIZE,
      counts: Object.fromEntries(filters.map((filter, index) => [filter, counts[index] ?? 0])) as CaseListResponse['counts'],
      generatedAt: now.toISOString(),
    };
  }

  private async present(tenantId: string, rows: Array<Prisma.CaseGetPayload<{ include: { assignee: { select: { firstName: true; lastName: true } } } }>>): Promise<CaseListItem[]> {
    const db = this.prisma.forTenantId(tenantId);
    const ids = rows.map((row) => row.id);
    const [leads, invoices] = await Promise.all([
      ids.length > 0 ? db.lead.findMany({ where: { caseId: { in: ids } }, include: { contact: { select: { firstName: true, lastName: true } }, company: { select: { name: true } } } }) : [],
      ids.length > 0 ? db.invoice.findMany({ where: { caseId: { in: ids } }, include: { supplier: { select: { id: true, name: true } } } }) : [],
    ]);
    const counterparty = new Map<string, EntityRef>();
    for (const lead of leads) {
      if (!lead.caseId) continue;
      const company = lead.company?.name;
      const person = `${lead.contact.firstName} ${lead.contact.lastName}`.trim();
      counterparty.set(lead.caseId, { type: 'LEAD', id: lead.id, label: company ? `${company} · ${person}` : person, href: internalHref('LEAD', lead.id) });
    }
    for (const invoice of invoices) {
      if (!invoice.caseId || !invoice.supplier || counterparty.has(invoice.caseId)) continue;
      counterparty.set(invoice.caseId, { type: 'SUPPLIER', id: invoice.supplier.id, label: invoice.supplier.name, href: internalHref('SUPPLIER', invoice.supplier.id) });
    }

    return rows.map((row): CaseListItem => {
      const status = row.orchestrationStatus as CaseOrchestrationStatusValue;
      const owner = row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}`.trim() : undefined;
      return {
        id: row.id,
        title: row.title,
        typeLabel: caseTypeDisplay(row.type),
        counterparty: counterparty.get(row.id),
        statusLabel: CASE_ORCHESTRATION_LABELS[status] ?? 'In Bearbeitung',
        statusTone: TONES[status] ?? 'neutral',
        nextStep: row.attentionReasons[0] ?? NEXT_STEPS[status] ?? 'Fortschritt ansehen',
        ownerLabel: owner,
        updatedAt: row.updatedAt.toISOString(),
        needsAttention: (ATTENTION_STATES as readonly string[]).includes(status),
        hasProcess: Boolean(row.blueprintKey) || status !== 'RECEIVED',
        href: internalHref('CASE', row.id) as string,
      };
    });
  }

  async summary(tenantId: string, id: string): Promise<CaseListItem> {
    const row = await this.prisma.forTenantId(tenantId).case.findUnique({ where: { id }, include: { assignee: { select: { firstName: true, lastName: true } } } });
    if (!row) throw new NotFoundError('Case not found.', { id });
    return (await this.present(tenantId, [row]))[0] as CaseListItem;
  }
}
