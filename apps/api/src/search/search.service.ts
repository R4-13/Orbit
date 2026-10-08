import { Injectable } from '@nestjs/common';
import { CASE_ORCHESTRATION_LABELS, PERMISSIONS, internalHref, type CaseOrchestrationStatusValue, type EntityType, type Permission } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchResult {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string;
  statusLabel?: string;
  href: string;
}

const PER_TYPE = 5;

/**
 * UI v2 §5.3 — die globale Suche findet berechtigte Vorgänge, Rechnungen, Kontakte und Aufgaben. Jede Gruppe wird nur mit
 * dem jeweiligen Leserecht durchsucht, der Mandant kommt aus dem Authentifizierungskontext, das Linkziel wird serverseitig aus
 * der zentralen Routentabelle gebildet.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(tenantId: string, permissions: readonly Permission[], rawQuery: string): Promise<SearchResult[]> {
    const q = rawQuery.trim().slice(0, 80);
    if (q.length < 2) return [];
    const db = this.prisma.forTenantId(tenantId);
    const has = (permission: Permission) => permissions.includes(permission);
    const contains = { contains: q, mode: 'insensitive' as const };

    const [cases, invoices, contacts, companies, tasks] = await Promise.all([
      has(PERMISSIONS.CASE_READ) ? db.case.findMany({ where: { title: contains }, orderBy: { updatedAt: 'desc' }, take: PER_TYPE }) : [],
      has(PERMISSIONS.INVOICE_READ)
        ? db.invoice.findMany({
            where: { OR: [{ invoiceNumber: contains }, { supplier: { is: { name: contains } } }] },
            include: { supplier: { select: { name: true } } },
            orderBy: { updatedAt: 'desc' },
            take: PER_TYPE,
          })
        : [],
      has(PERMISSIONS.CRM_CONTACT_READ)
        ? db.contact.findMany({ where: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] }, orderBy: { updatedAt: 'desc' }, take: PER_TYPE })
        : [],
      has(PERMISSIONS.CRM_CONTACT_READ) ? db.company.findMany({ where: { name: contains }, orderBy: { updatedAt: 'desc' }, take: PER_TYPE }) : [],
      has(PERMISSIONS.TASK_READ) ? db.task.findMany({ where: { title: contains }, orderBy: { updatedAt: 'desc' }, take: PER_TYPE }) : [],
    ]);

    const results: SearchResult[] = [];
    for (const found of cases) {
      results.push({ type: 'CASE', id: found.id, title: found.title, statusLabel: CASE_ORCHESTRATION_LABELS[found.orchestrationStatus as CaseOrchestrationStatusValue], href: internalHref('CASE', found.id) as string });
    }
    for (const invoice of invoices) {
      results.push({
        type: 'INVOICE',
        id: invoice.id,
        title: `${invoice.supplier?.name ?? 'Rechnung'}${invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ''}`,
        statusLabel: invoice.status,
        href: internalHref('INVOICE', invoice.id) as string,
      });
    }
    for (const contact of contacts) {
      results.push({ type: 'CONTACT', id: contact.id, title: `${contact.firstName} ${contact.lastName}`.trim(), subtitle: contact.email ?? undefined, href: `/sales/contacts?focus=${encodeURIComponent(contact.id)}` });
    }
    for (const company of companies) {
      results.push({ type: 'COMPANY', id: company.id, title: company.name, subtitle: 'Kontakte des Unternehmens', href: `/sales/contacts?company=${encodeURIComponent(company.id)}` });
    }
    for (const task of tasks) {
      results.push({ type: 'TASK', id: task.id, title: task.title, statusLabel: task.status, href: internalHref('TASK', task.id) as string });
    }
    return results;
  }
}
