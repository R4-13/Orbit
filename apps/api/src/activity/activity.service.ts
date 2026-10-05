import { Injectable } from '@nestjs/common';
import {
  COMPLETED_ACTION_LABELS,
  internalHref,
  type ActivityEntry,
  type ActivityFeed,
  type EntityRef,
  type EntityType,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

type Area = 'ALL' | 'FINANCE' | 'SALES';

interface EventPresentation {
  title: string;
  area: Exclude<Area, 'ALL'> | 'GENERAL';
  /** true = bestätigtes Ergebnis/Entscheidung; false = Zwischenereignis (nur in „Alle Ereignisse“). */
  result: boolean;
}

/**
 * UI v2 §17 — nur fachlich lesbare Ereignisse. Technische Ereignisse (Tool-Aufrufe, Policy-Entscheidungen, Agent-Läufe, Anmeldungen,
 * Konfigurationsänderungen) stehen bewusst nicht im Standard-Feed; sie sind Admin-Diagnostik.
 */
const PRESENTATIONS: Record<string, EventPresentation> = {
  EMAIL_RECEIVED: { title: 'Nachricht eingegangen', area: 'GENERAL', result: false },
  INVOICE_CREATED: { title: 'Rechnung erfasst', area: 'FINANCE', result: true },
  DUPLICATE_INVOICE_DETECTED: { title: 'Mögliche Dublette erkannt', area: 'FINANCE', result: false },
  BOOKING_PROPOSED: { title: 'Buchungsvorschlag erstellt', area: 'FINANCE', result: true },
  APPROVAL_REQUESTED: { title: 'Freigabe angefordert', area: 'GENERAL', result: false },
  APPROVAL_GRANTED: { title: 'Freigabe erteilt', area: 'GENERAL', result: true },
  APPROVAL_REJECTED: { title: 'Freigabe abgelehnt', area: 'GENERAL', result: true },
  FINANCE_TRANSFER_COMPLETED: { title: 'Rechnung zur Buchhaltung übertragen', area: 'FINANCE', result: true },
  FINANCE_TRANSFER_FAILED: { title: 'Übertragung zur Buchhaltung fehlgeschlagen', area: 'FINANCE', result: true },
  SUPPLIER_CREATED: { title: 'Lieferant angelegt', area: 'FINANCE', result: true },
  SUPPLIER_BANK_DETAILS_CHANGED: { title: 'Bankverbindung eines Lieferanten geändert', area: 'FINANCE', result: true },
  LEAD_CREATED: { title: 'Interessent angelegt', area: 'SALES', result: true },
  OPPORTUNITY_CREATED: { title: 'Verkaufschance angelegt', area: 'SALES', result: true },
  CONTACT_CREATED: { title: 'Kontakt angelegt', area: 'SALES', result: true },
  COMPANY_CREATED: { title: 'Unternehmen angelegt', area: 'SALES', result: true },
  MEETING_PROPOSED: { title: 'Termin vorgeschlagen', area: 'SALES', result: false },
  MEETING_CREATED: { title: 'Termin angelegt', area: 'SALES', result: true },
  TASK_CREATED: { title: 'Aufgabe angelegt', area: 'GENERAL', result: false },
  TASK_COMPLETED: { title: 'Aufgabe erledigt', area: 'GENERAL', result: true },
  CASE_CREATED: { title: 'Vorgang angelegt', area: 'GENERAL', result: false },
  INTAKE_DECISION_OVERRIDDEN: { title: 'Einstufung eines Eingangs korrigiert', area: 'GENERAL', result: true },
};

const ENTITY_TYPES: Record<string, EntityType> = {
  Invoice: 'INVOICE',
  Supplier: 'SUPPLIER',
  Case: 'CASE',
  Task: 'TASK',
  Lead: 'LEAD',
  Contact: 'CONTACT',
  Company: 'COMPANY',
  Opportunity: 'OPPORTUNITY',
  Approval: 'APPROVAL',
  EmailMessage: 'EMAIL',
};

const ENTITY_NOUN: Partial<Record<EntityType, string>> = {
  INVOICE: 'Rechnung',
  SUPPLIER: 'Lieferant',
  CASE: 'Vorgang',
  TASK: 'Aufgabe',
  LEAD: 'Interessent',
  CONTACT: 'Kontakt',
  COMPANY: 'Unternehmen',
  OPPORTUNITY: 'Verkaufschance',
  APPROVAL: 'Freigabe',
  EMAIL: 'Nachricht',
};

export const ACTIVITY_PAGE_SIZE = 30;

function areaMatches(area: Area, presentation: EventPresentation): boolean {
  return area === 'ALL' || presentation.area === area || presentation.area === 'GENERAL';
}

/**
 * Aktivitäten als belegbarer Ablauf: Zeit, Handelnde/System, Objektlink und – bei externen Wirkungen – der Nachweis (Receipt)
 * mit Betriebsmodus. Ein bestätigter Versand kommt ausschließlich aus einem Receipt; ein bloßes Ereignis gilt nie als Beleg.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(tenantId: string, input: { area: Area; days: number; resultsOnly: boolean; page: number; caseId?: string }, now: Date = new Date()): Promise<ActivityFeed> {
    const db = this.prisma.forTenantId(tenantId);
    const since = new Date(now.getTime() - input.days * 24 * 3600 * 1000);
    const types = Object.entries(PRESENTATIONS)
      .filter(([, presentation]) => (!input.resultsOnly || presentation.result) && areaMatches(input.area, presentation))
      .map(([key]) => key);

    const [logs, receipts] = await Promise.all([
      db.auditLog.findMany({
        where: { eventType: { in: types }, createdAt: { gte: since }, ...(input.caseId ? { entityType: 'Case', entityId: input.caseId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      input.area === 'FINANCE'
        ? []
        : db.actionReceipt.findMany({
            where: { createdAt: { gte: since }, ...(input.caseId ? { intent: { is: { caseId: input.caseId } } } : {}) },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: { intent: { include: { case: { select: { id: true, title: true } } } } },
          }),
    ]);

    const userIds = [...new Set(logs.map((log) => log.actorUserId).filter((id): id is string => Boolean(id)))];
    const caseIds = [...new Set(logs.filter((log) => log.entityType === 'Case' && log.entityId).map((log) => log.entityId as string))];
    const invoiceIds = [...new Set(logs.filter((log) => log.entityType === 'Invoice' && log.entityId).map((log) => log.entityId as string))];
    const [users, cases, invoices] = await Promise.all([
      userIds.length > 0 ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
      caseIds.length > 0 ? db.case.findMany({ where: { id: { in: caseIds } }, select: { id: true, title: true } }) : [],
      invoiceIds.length > 0 ? db.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNumber: true, supplier: { select: { name: true } } } }) : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    const caseTitle = new Map(cases.map((c) => [c.id, c.title]));
    const invoiceLabel = new Map(invoices.map((i) => [i.id, `${i.supplier?.name ?? 'Rechnung'}${i.invoiceNumber ? ` · ${i.invoiceNumber}` : ''}`]));

    const entries: ActivityEntry[] = [];
    for (const log of logs) {
      const presentation = PRESENTATIONS[log.eventType];
      if (!presentation) continue;
      const type = log.entityType ? ENTITY_TYPES[log.entityType] : undefined;
      let entity: EntityRef | undefined;
      if (type && log.entityId) {
        const label = type === 'CASE' ? caseTitle.get(log.entityId) : type === 'INVOICE' ? invoiceLabel.get(log.entityId) : undefined;
        entity = { type, id: log.entityId, label: label ?? ENTITY_NOUN[type] ?? 'Objekt', href: internalHref(type, log.entityId) };
      }
      entries.push({
        id: `audit:${log.id}`,
        at: log.createdAt.toISOString(),
        title: presentation.title,
        actorLabel: log.actorType === 'USER' ? (log.actorUserId ? (userName.get(log.actorUserId) ?? 'Nutzer') : 'Nutzer') : log.actorType === 'AGENT' ? 'ORBIT (Assistent)' : 'ORBIT',
        actorType: log.actorType,
        kind: presentation.result ? 'RESULT' : 'EVENT',
        entity,
      });
    }

    for (const receipt of receipts) {
      const base = COMPLETED_ACTION_LABELS[receipt.intent.capabilityKey] ?? 'Aktion ausgeführt';
      const simulated = receipt.executionMode === 'SIMULATED';
      const confirmed = receipt.status === 'CONFIRMED';
      const unknown = receipt.status === 'OUTCOME_UNKNOWN';
      const title = confirmed ? `${base}${simulated ? ' (simuliert)' : ''}` : unknown ? `${base}: Zustellung unbekannt – Ergebnis wird geprüft` : `${base}: fehlgeschlagen`;
      entries.push({
        id: `receipt:${receipt.id}`,
        at: receipt.createdAt.toISOString(),
        title,
        actorLabel: 'ORBIT',
        actorType: 'SYSTEM',
        kind: 'RESULT',
        entity: { type: 'CASE', id: receipt.intent.case.id, label: receipt.intent.case.title, href: internalHref('CASE', receipt.intent.case.id) },
        evidence: { label: confirmed ? 'Nachweis vorhanden' : unknown ? 'Kein Nachweis' : 'Fehlgeschlagen', executionMode: simulated ? 'SIMULATED' : 'LIVE', providerRef: receipt.providerRef ?? undefined, confirmed },
      });
    }

    entries.sort((a, b) => b.at.localeCompare(a.at));
    const page = Math.max(1, input.page);
    return {
      entries: entries.slice((page - 1) * ACTIVITY_PAGE_SIZE, page * ACTIVITY_PAGE_SIZE),
      total: entries.length,
      page,
      pageSize: ACTIVITY_PAGE_SIZE,
      generatedAt: now.toISOString(),
    };
  }
}
