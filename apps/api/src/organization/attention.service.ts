import { Inject, Injectable, Logger } from '@nestjs/common';
import { loadBrandingConfig, type OrbitEnv } from '@orbit/config';
import {
  LIVE_DELIVERY_CHANNELS,
  NotFoundError,
  composeStaffNotice,
  escalationChain,
  escalationPhase,
  planDelivery,
  recipientsForPhase,
  resolveEscalationPolicy,
  responsibilityForCase,
  responsiblesFor,
  type AttentionKind,
  type DeliveryChannel,
  type EscalationPhase,
  type EscalationStep,
  type RoutableStaff,
} from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { ORBIT_ENV } from '../config/env.token';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../integrations/outbound-mail.port';
import { PrismaService } from '../prisma/prisma.service';

/** Zustände, in denen ein Vorgang auf einen Menschen wartet. */
const HUMAN_STATUSES = ['MANUAL_REVIEW', 'WAITING_FOR_APPROVAL', 'FAILED'] as const;
const FINAL_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'] as const;
/** Vorgänge, die älter sind, lösen beim Einschalten keine Meldungen aus (kein Rundumschlag über Altbestand). */
const MAX_AGE_MS = 3 * 24 * 3_600_000;
/** Eine fehlgeschlagene Zustellung wird frühestens nach so langer Zeit wiederholt, höchstens so oft. */
const RETRY_AFTER_MS = 30 * 60_000;
const MAX_ATTEMPTS = 4;

const STATUS_REASON: Record<string, string> = {
  MANUAL_REVIEW: 'Der Vorgang braucht eine Prüfung durch einen Menschen.',
  WAITING_FOR_APPROVAL: 'Eine Freigabe ist offen.',
  FAILED: 'Die Bearbeitung ist fehlgeschlagen und braucht eine Entscheidung.',
};

export interface AttentionSweepResult {
  tenants: number;
  opened: number;
  resolved: number;
  notified: number;
  failed: number;
}

export interface CaseAttentionView {
  id: string;
  kind: string;
  state: string;
  phase: string;
  emergency: boolean;
  since: string;
  acknowledgedAt: string | null;
  notifications: Array<{ person: string; role: string; phase: string; wantedChannel: string; deliveredVia: string | null; status: string; executionMode: string | null; note: string | null; at: string }>;
}

const fullName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`.trim();

/**
 * Vorgänge, die auf einen Menschen warten, und was ORBIT dann tut: die zuständige Person informieren, bei ausbleibender Reaktion erinnern (mit Vertretung, die
 * Person kann krank sein) und später den Vorgesetzten und die Leitung einbeziehen – ohne dass jemand eine Antwort schreiben muss. Der Abgleich ist zustandsbasiert
 * (der Vorgang IST im wartenden Zustand) und damit wiederholbar: ein verpasster Takt verschiebt Meldungen, verliert sie aber nicht, und jede Meldung entsteht
 * höchstens einmal je Person und Phase.
 *
 * Zugestellt wird heute per E-Mail über das verbundene Postfach; andere gewünschte Kanäle werden ehrlich als „per E-Mail zugestellt“ ausgewiesen.
 */
@Injectable()
export class AttentionService {
  private readonly logger = new Logger(AttentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OUTBOUND_MAIL) private readonly mail: OutboundMailPort,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /** Takt des Workers: alle Mandanten mit erfassten Mitarbeitern. */
  async sweep(now = new Date()): Promise<AttentionSweepResult> {
    const total: AttentionSweepResult = { tenants: 0, opened: 0, resolved: 0, notified: 0, failed: 0 };
    if (this.env.ESCALATION_ENABLED === 'false') return total;
    const tenantIds = await this.prisma.withRlsBypass(async (tx) => (await tx.staffMember.findMany({ where: { active: true }, distinct: ['tenantId'], select: { tenantId: true } })).map((r) => r.tenantId));
    for (const tenantId of tenantIds) {
      try {
        const result = await this.syncTenant(tenantId, now);
        total.tenants += 1;
        total.opened += result.opened;
        total.resolved += result.resolved;
        total.notified += result.notified;
        total.failed += result.failed;
      } catch (error) {
        this.logger.warn(`attention sync failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return total;
  }

  async syncTenant(tenantId: string, now = new Date()): Promise<Omit<AttentionSweepResult, 'tenants'>> {
    const db = this.prisma.forTenantId(tenantId);
    const [staffRows, profile] = await Promise.all([db.staffMember.findMany({ where: { tenantId } }), db.tenantProfile.findUnique({ where: { tenantId } })]);
    const staff = staffRows as RoutableStaff[];
    const policy = resolveEscalationPolicy(profile?.escalationPolicy);
    const result = { opened: 0, resolved: 0, notified: 0, failed: 0 };

    // 1. Wer wartet gerade auf einen Menschen?
    const waiting = await db.case.findMany({
      where: { tenantId, orchestrationStatus: { in: [...HUMAN_STATUSES] } },
      select: { id: true, title: true, type: true, orchestrationStatus: true, attentionReasons: true, updatedAt: true },
    });
    const emergencies = await db.intakeDecision.findMany({
      where: { tenantId, result: { path: ['urgency'], equals: 'CRITICAL' }, intakeEvent: { caseId: { not: null }, createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) } } },
      select: { intakeEvent: { select: { caseId: true } } },
    });
    const emergencyCaseIds = new Set(emergencies.map((e) => e.intakeEvent.caseId).filter((id): id is string => Boolean(id)));
    const emergencyCases = emergencyCaseIds.size
      ? await db.case.findMany({
          where: { tenantId, id: { in: [...emergencyCaseIds] }, orchestrationStatus: { notIn: [...FINAL_STATUSES] } },
          select: { id: true, title: true, type: true, orchestrationStatus: true, attentionReasons: true, updatedAt: true },
        })
      : [];

    const desired = new Map<string, { caseId: string; kind: AttentionKind; title: string; type: string; reason: string; updatedAt: Date }>();
    for (const c of emergencyCases) desired.set(`${c.id}:EMERGENCY`, { caseId: c.id, kind: 'EMERGENCY', title: c.title, type: c.type, reason: c.attentionReasons[0] ?? 'Als Notfall eingestuft (kritische Dringlichkeit).', updatedAt: c.updatedAt });
    for (const c of waiting) {
      if (emergencyCaseIds.has(c.id)) continue; // der Notfall-Eintrag deckt den Vorgang ab – eine zweite Meldung wäre Lärm
      desired.set(`${c.id}:${c.orchestrationStatus}`, { caseId: c.id, kind: c.orchestrationStatus as AttentionKind, title: c.title, type: c.type, reason: c.attentionReasons[0] ?? STATUS_REASON[c.orchestrationStatus] ?? '', updatedAt: c.updatedAt });
    }

    // 2. Einträge anlegen bzw. auflösen.
    const open = await db.attentionItem.findMany({ where: { tenantId, state: { not: 'RESOLVED' } } });
    for (const item of open) {
      if (!desired.has(`${item.caseId}:${item.kind}`)) {
        await db.attentionItem.update({ where: { id: item.id }, data: { state: 'RESOLVED', resolvedAt: now } });
        result.resolved += 1;
      }
    }
    const openKeys = new Set(open.map((i) => `${i.caseId}:${i.kind}`));
    const fresh = [...desired.entries()].filter(([key]) => !openKeys.has(key));
    if (fresh.length > 0) {
      const categories = await this.categoriesFor(
        tenantId,
        fresh.map(([, d]) => d.caseId),
      );
      for (const [, d] of fresh) {
        const emergency = d.kind === 'EMERGENCY';
        const stale = now.getTime() - d.updatedAt.getTime() > MAX_AGE_MS;
        await db.attentionItem.create({
          data: {
            tenantId,
            caseId: d.caseId,
            kind: d.kind,
            responsibility: responsibilityForCase({ category: categories.get(d.caseId), caseType: d.type, emergency }),
            emergency,
            reason: d.reason || null,
            state: stale && !emergency ? 'SUPPRESSED' : 'OPEN',
            firstSeenAt: now,
          },
        });
        result.opened += 1;
      }
    }

    // 3. Meldungen nach Wartezeit.
    const items = await db.attentionItem.findMany({ where: { tenantId, state: 'OPEN' }, include: { case: { select: { title: true } } } });
    for (const item of items) {
      const minutes = (now.getTime() - item.firstSeenAt.getTime()) / 60_000;
      const phase = escalationPhase(minutes, policy, item.emergency);
      const sent = await this.notifyPhase(tenantId, item, phase, staff, minutes, now);
      result.notified += sent.sent;
      result.failed += sent.failed;
      if (phase !== item.phase || sent.sent > 0) {
        await db.attentionItem.update({ where: { id: item.id }, data: { phase, ...(sent.sent > 0 ? { lastNotifiedAt: now } : {}) } });
        if (phase !== item.phase && phase !== 'INITIAL') {
          await this.audit.record({ tenantId, eventType: 'ATTENTION_ESCALATED', actorType: 'SYSTEM', entityType: 'Case', entityId: item.caseId, payload: { kind: item.kind, phase, waitingMinutes: Math.round(minutes) } });
        }
      }
    }
    return result;
  }

  /** Meldungen dieser Phase an die zuständigen Personen und – je nach Phase – Vertretung, Vorgesetzte und Leitung; je Person und Phase höchstens eine. */
  private async notifyPhase(
    tenantId: string,
    item: { id: string; caseId: string; kind: string; responsibility: string; emergency: boolean; reason: string | null; case: { title: string } },
    phase: EscalationPhase,
    staff: RoutableStaff[],
    waitingMinutes: number,
    now: Date,
  ): Promise<{ sent: number; failed: number }> {
    const db = this.prisma.forTenantId(tenantId);
    const responsibles = responsiblesFor(staff, item.responsibility as Parameters<typeof responsiblesFor>[1]);
    if (responsibles.length === 0) return { sent: 0, failed: 0 };

    // Je Person die höchste Rolle in der Kette (Vertretung vor Vorgesetztem vor Leitung) – die erste zuständige Person nennt die Meldung als Anlass.
    const targets = new Map<string, { step: EscalationStep; responsibleName: string }>();
    for (const responsible of responsibles) {
      for (const step of recipientsForPhase(escalationChain(staff, responsible.id), phase)) {
        if (!targets.has(step.staff.id)) targets.set(step.staff.id, { step, responsibleName: fullName(responsible) });
      }
    }

    const connected = new Set<DeliveryChannel>(LIVE_DELIVERY_CHANNELS);
    const appName = loadBrandingConfig().appName;
    let sent = 0;
    let failed = 0;
    for (const [staffId, { step, responsibleName }] of targets) {
      const existing = await db.staffNotification.findUnique({ where: { attentionItemId_staffMemberId_phase: { attentionItemId: item.id, staffMemberId: staffId, phase } } });
      if (existing && (existing.status !== 'FAILED' || existing.attempts >= MAX_ATTEMPTS || now.getTime() - existing.updatedAt.getTime() < RETRY_AFTER_MS)) continue;

      const plan = planDelivery(step.staff, connected);
      const notice = composeStaffNotice({
        phase,
        kind: item.kind as AttentionKind,
        role: step.role,
        recipientFirstName: step.staff.firstName,
        caseTitle: item.case.title,
        reason: item.reason,
        waitingMinutes,
        responsibleName: step.role === 'RESPONSIBLE' ? undefined : responsibleName,
        link: `${this.env.WEB_BASE_URL.replace(/\/$/, '')}/cases/${item.caseId}`,
        appName,
      });
      const base = { tenantId, attentionItemId: item.id, staffMemberId: staffId, phase, role: step.role, subject: notice.subject, wantedChannel: step.staff.preferredChannel };

      let outcome: { status: 'SENT' | 'FAILED' | 'SKIPPED'; deliveredVia?: string; executionMode?: string; note?: string; error?: string };
      if (!plan) {
        outcome = { status: 'SKIPPED', note: 'Keine erreichbare Adresse für einen angebundenen Kanal – bitte Kontaktdaten ergänzen.' };
      } else {
        try {
          const delivered = await this.mail.send(tenantId, { to: plan.address, subject: notice.subject, bodyText: notice.text });
          outcome = { status: 'SENT', deliveredVia: plan.via, executionMode: delivered.executionMode, note: plan.note };
        } catch (error) {
          outcome = { status: 'FAILED', deliveredVia: plan.via, error: (error instanceof Error ? error.message : String(error)).slice(0, 300), note: plan.note };
        }
      }
      const data = { ...base, status: outcome.status, deliveredVia: outcome.deliveredVia ?? null, executionMode: outcome.executionMode ?? null, note: outcome.note ?? null, error: outcome.error ?? null };
      if (existing) await db.staffNotification.update({ where: { id: existing.id }, data: { ...data, attempts: existing.attempts + 1 } });
      else await db.staffNotification.create({ data });

      if (outcome.status === 'SENT') {
        sent += 1;
        await this.audit.record({
          tenantId,
          eventType: 'ATTENTION_NOTIFIED',
          actorType: 'SYSTEM',
          entityType: 'Case',
          entityId: item.caseId,
          // Wer und über welchen Kanal – nie Adresse oder Textinhalt.
          payload: { staffMemberId: staffId, role: step.role, phase, wantedChannel: step.staff.preferredChannel, deliveredVia: outcome.deliveredVia, executionMode: outcome.executionMode },
        });
      } else if (outcome.status === 'FAILED') failed += 1;
    }
    return { sent, failed };
  }

  /** Die erkannte Kategorie je Vorgang (aus der Triage der zugehörigen Eingänge). */
  private async categoriesFor(tenantId: string, caseIds: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.forTenantId(tenantId).intakeEvent.findMany({
      where: { tenantId, caseId: { in: caseIds } },
      orderBy: { createdAt: 'asc' },
      select: { caseId: true, decision: { select: { result: true } } },
    });
    const map = new Map<string, string>();
    for (const row of rows) {
      const category = (row.decision?.result as { category?: string } | null | undefined)?.category;
      if (row.caseId && category && category !== 'UNKNOWN') map.set(row.caseId, category);
    }
    return map;
  }

  // ---------------------------------------------------------------- Oberfläche

  /** Was zu diesem Vorgang gemeldet wurde: offener Eintrag samt Meldungen (wer, wie, wann, ob zugestellt). */
  async forCase(tenantId: string, caseId: string): Promise<CaseAttentionView | null> {
    const db = this.prisma.forTenantId(tenantId);
    const item = await db.attentionItem.findFirst({
      where: { tenantId, caseId, state: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: { createdAt: 'desc' },
      include: { notifications: { orderBy: { createdAt: 'asc' }, include: { staffMember: { select: { firstName: true, lastName: true } } } } },
    });
    if (!item) return null;
    return {
      id: item.id,
      kind: item.kind,
      state: item.state,
      phase: item.phase,
      emergency: item.emergency,
      since: item.firstSeenAt.toISOString(),
      acknowledgedAt: item.acknowledgedAt?.toISOString() ?? null,
      notifications: item.notifications.map((n) => ({
        person: fullName(n.staffMember),
        role: n.role,
        phase: n.phase,
        wantedChannel: n.wantedChannel,
        deliveredVia: n.deliveredVia,
        status: n.status,
        executionMode: n.executionMode,
        note: n.note,
        at: n.createdAt.toISOString(),
      })),
    };
  }

  /** „Ich kümmere mich“: beendet Erinnerungen und Eskalation für diesen Eintrag. Der Vorgang bleibt, bis er tatsächlich bearbeitet ist. */
  async acknowledge(tenantId: string, userId: string, attentionItemId: string): Promise<CaseAttentionView> {
    const db = this.prisma.forTenantId(tenantId);
    const item = await db.attentionItem.findFirst({ where: { id: attentionItemId, tenantId, state: { in: ['OPEN', 'ACKNOWLEDGED'] } } });
    if (!item) throw new NotFoundError('Zu diesem Vorgang gibt es keine offene Meldung.', { id: attentionItemId });
    if (item.state === 'OPEN') {
      await db.attentionItem.update({ where: { id: item.id }, data: { state: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedByUserId: userId } });
      await this.audit.record({ tenantId, eventType: 'ATTENTION_ACKNOWLEDGED', actorType: 'USER', actorUserId: userId, entityType: 'Case', entityId: item.caseId, payload: { kind: item.kind, phase: item.phase } });
    }
    return (await this.forCase(tenantId, item.caseId)) as CaseAttentionView;
  }
}
