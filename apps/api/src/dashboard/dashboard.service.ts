import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import {
  CASE_ORCHESTRATION_LABELS,
  COMPLETED_ACTION_LABELS,
  DASHBOARD_METRIC_KEYS,
  PERMISSIONS,
  approvalEntityLabel,
  compareAttention,
  connectorLabel,
  deduplicateAttention,
  intakeStatusLabel,
  internalHref,
  policyActionLabel,
  type AttentionItem,
  type CaseOrchestrationStatusValue,
  type CompletedPreviewItem,
  type DashboardMetric,
  type DashboardPeriod,
  type DashboardSnapshot,
  type DashboardView,
  type EntityRef,
  type EntityType,
  type FinanceOverview,
  type InboxPreviewItem,
  type Permission,
  type SalesOverview,
  type TaskPreviewItem,
} from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { showExcludedIntakeByDefault } from '../intake/intake-visibility';
import { PrismaService } from '../prisma/prisma.service';
import { periodRange } from './dashboard-time';

/** Konfigurierbare Schätzung (§7: „keine Garantie“): Minuten, die ein ohne menschlichen Eingriff abgeschlossener Vorgang spart. */
export const MINUTES_SAVED_PER_AUTOMATED_CASE = 10;
export const INBOX_WINDOW_DAYS = 7;
const MAX_ATTENTION_CANDIDATES = 200;

const RELEVANT = ['BUSINESS_ACTIONABLE', 'BUSINESS_INFORMATIONAL', 'UNKNOWN_REQUIRES_REVIEW'] as const;
const EXCLUDED = ['NON_ACTIONABLE', 'PRIVATE_PERSONAL'] as const;

export interface DashboardViewer {
  tenantId: string;
  userId: string;
  permissions: readonly Permission[];
}

export interface DashboardOptions {
  view: DashboardView;
  period: DashboardPeriod;
  timezone: string;
  /** Obergrenzen je Vorschau; die Oberfläche passt sie an die verfügbare Höhe an (UI v2 §6.3). */
  limits?: { attention?: number; inbox?: number; tasks?: number; completed?: number };
}

function ref(type: EntityType, id: string, label: string): EntityRef {
  return { type, id, label, href: internalHref(type, id) };
}

function nextActionFor(status: CaseOrchestrationStatusValue | undefined, hasCase: boolean): string {
  if (!hasCase) return 'Entscheidung ansehen';
  switch (status) {
    case 'WAITING_FOR_APPROVAL':
      return 'Freigabe prüfen';
    case 'WAITING_FOR_INFORMATION':
      return 'Auf Antwort warten';
    case 'MANUAL_REVIEW':
      return 'Prüfen und entscheiden';
    case 'FAILED':
      return 'Fehler ansehen';
    case 'COMPLETED':
      return 'Ergebnis ansehen';
    default:
      return 'Fortschritt ansehen';
  }
}

/**
 * UI/UX v2 §26.2/DATA-01 — EIN autorisierter Abfragedienst für Home und Sonde. Mandant und Nutzer kommen aus dem
 * Authentifizierungskontext, jede Kennzahl und jede Vorschau wird nur mit dem passenden Leserecht berechnet
 * (fehlt das Recht, ist der Wert `null` bzw. der Bereich `null` – nie ein erfundenes 0).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /** Für Aufrufer ohne Request-Kontext (Sonde-Tools): Rechte des Nutzers aus seinen Rollen laden – nie aus Modell-Eingaben. */
  async viewerFor(tenantId: string, userId: string): Promise<DashboardViewer | undefined> {
    const user = await this.prisma.forTenantId(tenantId).user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    });
    if (!user || user.status === 'DEACTIVATED') return undefined;
    const permissions = [...new Set(user.roles.flatMap((userRole) => userRole.role.permissions.map((rp) => rp.permission)))] as Permission[];
    return { tenantId, userId, permissions };
  }

  async snapshot(viewer: DashboardViewer, options: DashboardOptions, now: Date = new Date()): Promise<DashboardSnapshot> {
    const { tenantId } = viewer;
    const db = this.prisma.forTenantId(tenantId);
    const has = (permission: Permission): boolean => viewer.permissions.includes(permission);
    const range = periodRange(options.period, now, options.timezone);
    const limits = {
      attention: options.limits?.attention ?? 5,
      inbox: options.limits?.inbox ?? 5,
      tasks: options.limits?.tasks ?? 3,
      completed: options.limits?.completed ?? 3,
    };

    const canCases = has(PERMISSIONS.CASE_READ);
    const canApprovals = has(PERMISSIONS.APPROVAL_READ);
    const canTasks = has(PERMISSIONS.TASK_READ);
    const canInvoices = has(PERMISSIONS.INVOICE_READ);
    const canCrm = has(PERMISSIONS.CRM_CONTACT_READ);
    const canInbox = has(PERMISSIONS.EMAIL_READ) || canCases;
    const canIntegrations = has(PERMISSIONS.INTEGRATION_CONFIGURE);

    const taskWhere = {
      status: 'OPEN' as const,
      ...(options.view === 'MINE' ? { OR: [{ assigneeId: viewer.userId }, { assigneeId: null }] } : {}),
    };

    const [pendingApprovals, attentionCases, unknownIntents, openTasks, riskInvoices, brokenIntegrations] = await Promise.all([
      canApprovals ? db.approval.findMany({ where: { status: 'PENDING' }, orderBy: { requestedAt: 'desc' }, take: MAX_ATTENTION_CANDIDATES }) : [],
      canCases
        ? db.case.findMany({
            where: { orchestrationStatus: { in: ['MANUAL_REVIEW', 'FAILED'] } },
            orderBy: { updatedAt: 'desc' },
            take: MAX_ATTENTION_CANDIDATES,
          })
        : [],
      canCases ? db.actionIntent.findMany({ where: { status: 'OUTCOME_UNKNOWN' }, orderBy: { updatedAt: 'desc' }, take: MAX_ATTENTION_CANDIDATES }) : [],
      canTasks ? db.task.findMany({ where: taskWhere, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: MAX_ATTENTION_CANDIDATES }) : [],
      canInvoices
        ? db.invoice.findMany({
            where: { status: { in: ['BANK_CHANGE_SUSPECTED', 'DUPLICATE_SUSPECTED'] } },
            include: { supplier: { select: { name: true } } },
            orderBy: { updatedAt: 'desc' },
            take: MAX_ATTENTION_CANDIDATES,
          })
        : [],
      canIntegrations ? db.integration.findMany({ where: { status: { in: ['AUTH_REQUIRED', 'ERROR'] } } }) : [],
    ]);

    // Cases, die für Anzeigenamen gebraucht werden (Freigaben über ActionIntent, Aufgaben, Fehler, ungewisse Wirkungen).
    const processApprovalIds = pendingApprovals.filter((a) => a.entityType === 'PROCESS_ACTION').map((a) => a.entityId);
    const approvalIntents = processApprovalIds.length > 0 ? await db.actionIntent.findMany({ where: { id: { in: processApprovalIds } } }) : [];
    const intentById = new Map(approvalIntents.map((intent) => [intent.id, intent]));
    const caseIds = new Set<string>([
      ...attentionCases.map((c) => c.id),
      ...unknownIntents.map((i) => i.caseId),
      ...approvalIntents.map((i) => i.caseId),
      ...openTasks.map((t) => t.caseId).filter((id): id is string => Boolean(id)),
    ]);
    const caseRows = caseIds.size > 0 ? await db.case.findMany({ where: { id: { in: [...caseIds] } } }) : [];
    const caseById = new Map(caseRows.map((c) => [c.id, c]));

    const items: AttentionItem[] = [];
    const push = (item: Omit<AttentionItem, 'id' | 'underlyingCount'> & { id: string }): void => {
      items.push({ ...item, underlyingCount: 1 });
    };

    for (const approval of pendingApprovals) {
      const intent = approval.entityType === 'PROCESS_ACTION' ? intentById.get(approval.entityId) : undefined;
      const linkedCase = intent ? caseById.get(intent.caseId) : undefined;
      const what = intent ? policyActionLabel(intent.capabilityKey) : policyActionLabel(approval.policyAction);
      const entity = approvalEntityLabel(approval.entityType);
      push({
        id: `approval:${approval.id}`,
        deduplicationKey: linkedCase ? `case:${linkedCase.id}` : `approval:${approval.id}`,
        title: linkedCase ? `${what}: ${linkedCase.title}` : `${what} (${entity})`,
        reason: approval.reason ?? 'Ihre Freigabe ist erforderlich, bevor ORBIT fortfährt.',
        priority: 'NORMAL',
        rank: 3,
        statusLabel: 'Freigabe erforderlich',
        primaryEntity: ref('APPROVAL', approval.id, what),
        relatedEntities: linkedCase ? [ref('CASE', linkedCase.id, linkedCase.title)] : [],
        availableActions: [{ key: 'review-approval', label: 'Prüfen', href: internalHref('APPROVAL', approval.id) }],
        createdAt: approval.requestedAt.toISOString(),
      });
    }

    for (const found of attentionCases) {
      const failed = found.orchestrationStatus === 'FAILED';
      push({
        id: `case:${found.id}`,
        deduplicationKey: `case:${found.id}`,
        title: found.title,
        reason: found.attentionReasons[0] ?? (failed ? 'Die Bearbeitung ist fehlgeschlagen und braucht eine Entscheidung.' : 'Der Vorgang braucht Ihre Prüfung.'),
        priority: failed ? 'HIGH' : 'NORMAL',
        rank: failed ? 1 : 3,
        statusLabel: CASE_ORCHESTRATION_LABELS[found.orchestrationStatus as CaseOrchestrationStatusValue] ?? 'Prüfung erforderlich',
        primaryEntity: ref('CASE', found.id, found.title),
        relatedEntities: [],
        availableActions: [{ key: 'open-case', label: failed ? 'Fehler ansehen' : 'Prüfen', href: internalHref('CASE', found.id) }],
        createdAt: found.updatedAt.toISOString(),
      });
    }

    for (const intent of unknownIntents) {
      const linkedCase = caseById.get(intent.caseId);
      push({
        id: `intent:${intent.id}`,
        deduplicationKey: `case:${intent.caseId}`,
        title: linkedCase ? `Ergebnis ungewiss: ${linkedCase.title}` : 'Ergebnis einer Aktion ungewiss',
        reason: `„${policyActionLabel(intent.capabilityKey)}“ wurde möglicherweise ausgeführt. Bitte Nachweise prüfen, bevor erneut gesendet wird.`,
        priority: 'CRITICAL',
        rank: 0,
        statusLabel: 'Ergebnis wird geprüft',
        primaryEntity: ref('CASE', intent.caseId, linkedCase?.title ?? 'Vorgang'),
        relatedEntities: [],
        availableActions: [{ key: 'reconcile', label: 'Nachweise prüfen', href: internalHref('CASE', intent.caseId) }],
        createdAt: intent.updatedAt.toISOString(),
      });
    }

    for (const task of openTasks) {
      if (!task.dueDate || task.dueDate >= range.endOfToday) continue;
      const overdue = task.dueDate < range.startOfToday;
      const linkedCase = task.caseId ? caseById.get(task.caseId) : undefined;
      push({
        id: `task:${task.id}`,
        deduplicationKey: linkedCase ? `case:${linkedCase.id}` : `task:${task.id}`,
        title: task.title,
        reason: overdue ? 'Die Frist ist überschritten.' : 'Heute fällig.',
        priority: overdue ? 'HIGH' : 'NORMAL',
        rank: overdue ? 1 : 2,
        dueAt: task.dueDate.toISOString(),
        statusLabel: overdue ? 'Überfällig' : 'Heute fällig',
        primaryEntity: ref('TASK', task.id, task.title),
        relatedEntities: linkedCase ? [ref('CASE', linkedCase.id, linkedCase.title)] : [],
        availableActions: [{ key: 'open-task', label: 'Aufgabe öffnen', href: internalHref('TASK', task.id) }],
        createdAt: task.createdAt.toISOString(),
      });
    }

    for (const invoice of riskInvoices) {
      const bank = invoice.status === 'BANK_CHANGE_SUSPECTED';
      const label = `${invoice.supplier?.name ?? 'Lieferant'}${invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ''}`;
      push({
        id: `invoice:${invoice.id}`,
        deduplicationKey: `invoice:${invoice.id}`,
        title: bank ? `Bankverbindung geändert: ${label}` : `Mögliche Dublette: ${label}`,
        reason: bank ? 'Die Bankverbindung weicht von der hinterlegten ab. Bitte vor jeder Zahlung prüfen.' : 'Diese Rechnung ähnelt einer bereits erfassten.',
        priority: bank ? 'CRITICAL' : 'HIGH',
        rank: bank ? 0 : 3,
        statusLabel: bank ? 'Bankverbindung geändert' : 'Mögliche Dublette',
        primaryEntity: ref('INVOICE', invoice.id, label),
        relatedEntities: [],
        availableActions: [{ key: 'review-invoice', label: 'Rechnung prüfen', href: internalHref('INVOICE', invoice.id) }],
        createdAt: invoice.updatedAt.toISOString(),
      });
    }

    for (const integration of brokenIntegrations) {
      const provider = connectorLabel(integration.connectorType);
      push({
        id: `integration:${integration.id}`,
        deduplicationKey: `integration:${integration.id}`,
        title: `${provider}: Verbindung erneuern`,
        reason: integration.status === 'AUTH_REQUIRED' ? `Die Anmeldung bei ${provider} ist abgelaufen.` : `Die Verbindung zu ${provider} ist gestört.`,
        priority: 'HIGH',
        rank: 1,
        statusLabel: integration.status === 'AUTH_REQUIRED' ? 'Anmeldung erforderlich' : 'Verbindung gestört',
        primaryEntity: ref('INTEGRATION', integration.id, provider),
        relatedEntities: [],
        availableActions: [{ key: 'renew-connection', label: 'Verbindung erneuern', href: '/integrations' }],
        createdAt: (integration.lastErrorAt ?? integration.updatedAt).toISOString(),
      });
    }

    const attention = deduplicateAttention(items);
    attention.sort(compareAttention);

    const [metrics, inbox, finance, sales, completed] = await Promise.all([
      this.metrics(viewer, range.start, now, pendingApprovals.length, canApprovals, attentionCases, unknownIntents),
      canInbox ? this.inboxPreview(tenantId, now, limits.inbox) : { items: [], total: 0 },
      canInvoices ? this.financeOverview(tenantId, range.start, riskInvoices) : null,
      canCrm ? this.salesOverview(tenantId, range.endOfToday) : null,
      canCases ? this.completedPreview(tenantId, limits.completed) : [],
    ]);

    const tasksSorted = [...openTasks].sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
    const tasksPreview: TaskPreviewItem[] = tasksSorted.slice(0, limits.tasks).map((task) => {
      const linkedCase = task.caseId ? caseById.get(task.caseId) : undefined;
      return {
        id: task.id,
        title: task.title,
        dueAt: task.dueDate?.toISOString(),
        overdue: Boolean(task.dueDate && task.dueDate < range.startOfToday),
        relatedCase: linkedCase ? ref('CASE', linkedCase.id, linkedCase.title) : undefined,
        href: internalHref('TASK', task.id) ?? '/tasks',
      };
    });

    return {
      generatedAt: now.toISOString(),
      snapshotId: randomUUID(),
      scope: {
        view: options.view,
        timezone: options.timezone,
        period: options.period,
        periodStart: range.start.toISOString(),
        periodEnd: range.end.toISOString(),
      },
      metrics,
      attentionPreview: attention.slice(0, limits.attention),
      attentionTotal: attention.length,
      inboxPreview: inbox.items,
      inboxTotal: inbox.total,
      inboxWindowDays: INBOX_WINDOW_DAYS,
      tasksPreview,
      tasksTotal: canTasks ? openTasks.length : 0,
      completedPreview: completed,
      finance,
      sales,
      assumptions: { minutesSavedPerAutomatedCase: MINUTES_SAVED_PER_AUTOMATED_CASE },
    };
  }

  private async metrics(
    viewer: DashboardViewer,
    periodStart: Date,
    now: Date,
    pendingApprovalCount: number,
    canApprovals: boolean,
    failedCases: Array<{ id: string; orchestrationStatus: string }>,
    unknownIntents: Array<{ caseId: string }>,
  ): Promise<DashboardMetric[]> {
    const db = this.prisma.forTenantId(viewer.tenantId);
    const canCases = viewer.permissions.includes(PERMISSIONS.CASE_READ);
    const canInbox = viewer.permissions.includes(PERMISSIONS.EMAIL_READ) || canCases;

    // DATA-03: gesichtet / ausgefiltert / Case gestartet / Prozess abgeschlossen bleiben getrennte Kategorien.
    const processed = canInbox
      ? await db.intakeEvent.count({
          where: {
            createdAt: { gte: periodStart, lte: now },
            relevance: { in: [...RELEVANT] },
            status: { in: ['ROUTED', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW'] },
          },
        })
      : null;

    let automated: number | null = null;
    if (canCases) {
      const completedCases = await db.case.findMany({
        where: { orchestrationStatus: 'COMPLETED', completedAt: { gte: periodStart, lte: now } },
        select: { id: true },
      });
      if (completedCases.length === 0) {
        automated = 0;
      } else {
        const ids = completedCases.map((c) => c.id);
        const intents = await db.actionIntent.findMany({ where: { caseId: { in: ids } }, select: { id: true, caseId: true } });
        const [humanTasks, humanApprovals] = await Promise.all([
          db.task.findMany({ where: { caseId: { in: ids } }, select: { caseId: true } }),
          intents.length > 0 ? db.approval.findMany({ where: { entityType: 'PROCESS_ACTION', entityId: { in: intents.map((i) => i.id) } }, select: { entityId: true } }) : [],
        ]);
        const touched = new Set<string>(humanTasks.map((t) => t.caseId).filter((id): id is string => Boolean(id)));
        const intentCase = new Map(intents.map((i) => [i.id, i.caseId]));
        for (const approval of humanApprovals) {
          const caseId = intentCase.get(approval.entityId);
          if (caseId) touched.add(caseId);
        }
        automated = ids.filter((id) => !touched.has(id)).length;
      }
    }

    const problemCaseIds = new Set<string>([...failedCases.filter((c) => c.orchestrationStatus === 'FAILED').map((c) => c.id), ...unknownIntents.map((i) => i.caseId)]);
    const orphanFailures = canInbox ? await db.intakeEvent.count({ where: { status: 'FAILED', caseId: null } }) : 0;
    const problems = canCases ? problemCaseIds.size + orphanFailures : null;

    const values: Record<(typeof DASHBOARD_METRIC_KEYS)[number], DashboardMetric> = {
      processed: { key: 'processed', value: processed, basis: 'PERIOD', definitionKey: 'intake.relevant.handled' },
      automated: { key: 'automated', value: automated, basis: 'PERIOD', definitionKey: 'case.completed.without_human' },
      approvalsOpen: { key: 'approvalsOpen', value: canApprovals ? pendingApprovalCount : null, basis: 'CURRENT', definitionKey: 'approval.pending' },
      problems: { key: 'problems', value: problems, basis: 'CURRENT', definitionKey: 'case.failed_or_outcome_unknown' },
      timeSaved: {
        key: 'timeSaved',
        value: automated === null ? null : automated * MINUTES_SAVED_PER_AUTOMATED_CASE,
        basis: 'PERIOD',
        definitionKey: 'estimate.minutes_per_automated_case',
      },
    };
    return DASHBOARD_METRIC_KEYS.map((key) => values[key]);
  }

  private async inboxPreview(tenantId: string, now: Date, limit: number): Promise<{ items: InboxPreviewItem[]; total: number }> {
    const db = this.prisma.forTenantId(tenantId);
    const showExcluded = showExcludedIntakeByDefault(this.env);
    const since = new Date(now.getTime() - INBOX_WINDOW_DAYS * 24 * 3600 * 1000);
    const where = {
      occurredAt: { gte: since },
      ...(showExcluded ? {} : { NOT: { OR: [{ relevance: { in: [...EXCLUDED] } }, { status: 'SKIPPED_NON_ACTIONABLE' as const }] } }),
    };
    const [events, total] = await Promise.all([
      db.intakeEvent.findMany({ where, orderBy: { occurredAt: 'desc' }, take: limit, include: { case: true } }),
      db.intakeEvent.count({ where }),
    ]);
    const items = events.map((event): InboxPreviewItem => {
      const sender = (event.senderRef ?? {}) as { address?: string; displayName?: string };
      const linkedCase = event.case;
      const onProcess = Boolean(linkedCase && (linkedCase.blueprintKey || linkedCase.orchestrationStatus !== 'RECEIVED'));
      const caseStatus = linkedCase?.orchestrationStatus as CaseOrchestrationStatusValue | undefined;
      return {
        id: event.id,
        source: 'EMAIL',
        senderLabel: sender.displayName?.trim() || sender.address || 'Unbekannter Absender',
        subject: event.subject?.trim() || 'Ohne Betreff',
        statusLabel: linkedCase && onProcess && caseStatus ? (CASE_ORCHESTRATION_LABELS[caseStatus] ?? intakeStatusLabel(event.status)) : intakeStatusLabel(event.status),
        occurredAt: event.occurredAt.toISOString(),
        nextActionLabel: nextActionFor(caseStatus, Boolean(linkedCase)),
        caseRef: linkedCase ? ref('CASE', linkedCase.id, linkedCase.title) : undefined,
        hasProcess: onProcess,
        href: internalHref('EMAIL', event.emailMessageId ?? event.id) ?? '/inbox',
      };
    });
    return { items, total };
  }

  private async financeOverview(
    tenantId: string,
    periodStart: Date,
    riskInvoices: Array<{ id: string; status: string; invoiceNumber: string | null; supplier: { name: string } | null }>,
  ): Promise<FinanceOverview> {
    const db = this.prisma.forTenantId(tenantId);
    const [toReview, approvalOpen, transferred] = await Promise.all([
      db.invoice.count({ where: { status: { in: ['RECEIVED', 'EXTRACTED', 'DUPLICATE_SUSPECTED', 'BANK_CHANGE_SUSPECTED'] } } }),
      db.invoice.count({ where: { status: 'PENDING_APPROVAL' } }),
      db.invoice.count({ where: { status: 'TRANSFERRED', updatedAt: { gte: periodStart } } }),
    ]);
    const bank = riskInvoices.find((invoice) => invoice.status === 'BANK_CHANGE_SUSPECTED');
    return {
      toReview,
      approvalOpen,
      transferred,
      hint: bank
        ? { text: `Bankverbindung geändert bei ${bank.supplier?.name ?? 'einem Lieferanten'}`, entity: ref('INVOICE', bank.id, bank.invoiceNumber ?? 'Rechnung') }
        : undefined,
    };
  }

  private async salesOverview(tenantId: string, endOfToday: Date): Promise<SalesOverview> {
    const db = this.prisma.forTenantId(tenantId);
    const [newInquiries, replyOpen, dueToday, newest] = await Promise.all([
      db.lead.count({ where: { status: 'NEW' } }),
      db.case.count({ where: { orchestrationStatus: 'WAITING_FOR_INFORMATION' } }),
      db.task.count({ where: { status: 'OPEN', dueDate: { lt: endOfToday }, case: { is: { type: 'SALES' } } } }),
      db.lead.findFirst({ where: { status: 'NEW' }, orderBy: { createdAt: 'desc' }, include: { contact: { select: { firstName: true, lastName: true } } } }),
    ]);
    return {
      newInquiries,
      replyOpen,
      dueToday,
      hint: newest
        ? { text: `Neue Anfrage von ${`${newest.contact.firstName} ${newest.contact.lastName}`.trim()}`, entity: ref('LEAD', newest.id, `${newest.contact.firstName} ${newest.contact.lastName}`.trim()) }
        : undefined,
    };
  }

  private async completedPreview(tenantId: string, limit: number): Promise<CompletedPreviewItem[]> {
    const db = this.prisma.forTenantId(tenantId);
    const [intents, cases] = await Promise.all([
      db.actionIntent.findMany({
        where: { status: 'CONFIRMED' },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        include: { receipts: { orderBy: { createdAt: 'desc' }, take: 1 }, case: { select: { id: true, title: true } } },
      }),
      db.case.findMany({ where: { orchestrationStatus: 'COMPLETED', completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, take: limit }),
    ]);
    const entries: CompletedPreviewItem[] = [];
    for (const intent of intents) {
      // Ein bestätigter Versand braucht einen Nachweis (Receipt); ohne ihn wird er nicht als erledigt gezeigt.
      const receipt = intent.receipts[0];
      if (!receipt || receipt.status !== 'CONFIRMED') continue;
      const mode = receipt.executionMode === 'SIMULATED' ? 'SIMULATED' : 'LIVE';
      const base = COMPLETED_ACTION_LABELS[intent.capabilityKey] ?? 'Aktion ausgeführt';
      entries.push({
        id: `intent:${intent.id}`,
        title: `${base}${mode === 'SIMULATED' ? ' (simuliert)' : ''}`,
        at: receipt.createdAt.toISOString(),
        executionMode: mode,
        entity: ref('CASE', intent.case.id, intent.case.title),
      });
    }
    for (const found of cases) {
      entries.push({ id: `case:${found.id}`, title: `Vorgang abgeschlossen: ${found.title}`, at: (found.completedAt as Date).toISOString(), entity: ref('CASE', found.id, found.title) });
    }
    return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
}
