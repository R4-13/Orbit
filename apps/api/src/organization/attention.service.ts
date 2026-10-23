import { Inject, Injectable, Logger } from '@nestjs/common';
import type { StaffNotification } from '@orbit/domain';
import { loadBrandingConfig, type OrbitEnv } from '@orbit/config';
import {
  DIGEST_MIN_ITEMS,
  LIVE_DELIVERY_CHANNELS,
  NotFoundError,
  composeStaffDigest,
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

    // Ein Kundeneintrag fehlt (oder das System war nicht erreichbar): ein Mensch soll ihn anlegen. Gilt unabhängig vom Prozesszustand des Vorgangs.
    const missing = await db.customerRecordWatch.findMany({
      where: { tenantId, status: { not: 'FOUND' }, case: { orchestrationStatus: { notIn: [...FINAL_STATUSES] } } },
      select: { caseId: true, status: true, reason: true, displayName: true, email: true, case: { select: { title: true, type: true, updatedAt: true } } },
    });
    for (const m of missing) {
      if (emergencyCaseIds.has(m.caseId)) continue; // wie oben: ein Notfall wird einmal gemeldet; der fehlende Kundeneintrag steht am Vorgang
      desired.set(`${m.caseId}:CUSTOMER_RECORD_MISSING`, {
        caseId: m.caseId,
        kind: 'CUSTOMER_RECORD_MISSING',
        title: m.case.title,
        type: m.case.type,
        reason: m.status === 'UNAVAILABLE' ? `Der Kundenstamm war nicht erreichbar${m.reason ? ` (${m.reason})` : ''}.` : `${m.displayName?.trim() || m.email} ist im Kundenstamm nicht vorhanden. ${m.reason ?? ''}`.trim(),
        updatedAt: m.case.updatedAt,
      });
    }

    // Ausdrücklich angeforderte Benachrichtigungen (Fähigkeit „staff.notify“) bleiben offen, bis der Vorgang beendet ist oder jemand übernimmt.
    const requested = await db.attentionItem.findMany({
      where: { tenantId, kind: 'NOTIFY_REQUEST', state: { not: 'RESOLVED' }, case: { orchestrationStatus: { notIn: [...FINAL_STATUSES] } } },
      select: { caseId: true, reason: true, case: { select: { title: true, type: true, updatedAt: true } } },
    });
    for (const r of requested) if (!emergencyCaseIds.has(r.caseId)) desired.set(`${r.caseId}:NOTIFY_REQUEST`, { caseId: r.caseId, kind: 'NOTIFY_REQUEST', title: r.case.title, type: r.case.type, reason: r.reason ?? '', updatedAt: r.case.updatedAt });

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
    // Viele neue Meldungen an dieselbe Person im selben Takt: eine Zusammenfassung statt vieler Einzelmails (AUT-05).
    const handled = await this.sendDigests(tenantId, items, staff, policy, now, result);
    for (const item of items) {
      const minutes = (now.getTime() - item.firstSeenAt.getTime()) / 60_000;
      const phase = escalationPhase(minutes, policy, item.emergency);
      const sent = await this.notifyPhase(tenantId, item, phase, staff, minutes, now, handled.get(item.id));
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

  /**
   * Wer in dieser Phase noch eine Meldung zu diesem Eintrag braucht: die Empfänger der Kette (je Person die höchste Rolle – die erste zuständige Person nennt die Meldung als Anlass),
   * ohne die, die in dieser Phase schon eine bekommen haben (fehlgeschlagene Zustellungen werden nach Abstand und höchstens begrenzt oft wiederholt).
   */
  private async pendingTargets(
    tenantId: string,
    item: { id: string; responsibility: string },
    phase: EscalationPhase,
    staff: RoutableStaff[],
    now: Date,
  ): Promise<Array<{ staffId: string; step: EscalationStep; responsibleName: string; existing: StaffNotification | undefined }>> {
    const responsibles = responsiblesFor(staff, item.responsibility as Parameters<typeof responsiblesFor>[1]);
    if (responsibles.length === 0) return [];
    const targets = new Map<string, { step: EscalationStep; responsibleName: string }>();
    for (const responsible of responsibles) {
      for (const step of recipientsForPhase(escalationChain(staff, responsible.id, now), phase)) {
        if (!targets.has(step.staff.id)) targets.set(step.staff.id, { step, responsibleName: fullName(responsible) });
      }
    }
    // Alle bisherigen Meldungen dieses Eintrags in der Phase mit einer Abfrage (statt eine je Person).
    const already = new Map((await this.prisma.forTenantId(tenantId).staffNotification.findMany({ where: { attentionItemId: item.id, phase } })).map((n) => [n.staffMemberId, n]));
    const out: Array<{ staffId: string; step: EscalationStep; responsibleName: string; existing: StaffNotification | undefined }> = [];
    for (const [staffId, { step, responsibleName }] of targets) {
      const existing = already.get(staffId);
      if (existing && (existing.status !== 'FAILED' || existing.attempts >= MAX_ATTEMPTS || now.getTime() - existing.updatedAt.getTime() < RETRY_AFTER_MS)) continue;
      out.push({ staffId, step, responsibleName, existing });
    }
    return out;
  }

  /**
   * Fasst neue Erstmeldungen zusammen (AUT-05): bekommt eine Person im selben Takt `DIGEST_MIN_ITEMS` oder mehr neue, nicht dringende Meldungen, geht **eine** Mail mit allen hinaus.
   * Jede Meldung wird trotzdem einzeln festgehalten (mit Hinweis auf die Zusammenfassung); Erinnerung und Eskalation sind nicht betroffen. Notfälle werden nie gebündelt.
   * Rückgabe: je Eintrag die Personen, die schon versorgt sind.
   */
  private async sendDigests(
    tenantId: string,
    items: Array<{ id: string; caseId: string; kind: string; responsibility: string; emergency: boolean; reason: string | null; firstSeenAt: Date; case: { title: string } }>,
    staff: RoutableStaff[],
    policy: ReturnType<typeof resolveEscalationPolicy>,
    now: Date,
    result: { notified: number; failed: number },
  ): Promise<Map<string, Set<string>>> {
    const handled = new Map<string, Set<string>>();
    const pending = new Map<string, Array<{ item: (typeof items)[number]; step: EscalationStep; existing: StaffNotification | undefined }>>();
    for (const item of items) {
      if (item.emergency) continue;
      const minutes = (now.getTime() - item.firstSeenAt.getTime()) / 60_000;
      if (escalationPhase(minutes, policy, false) !== 'INITIAL') continue;
      for (const target of await this.pendingTargets(tenantId, item, 'INITIAL', staff, now)) {
        pending.set(target.staffId, [...(pending.get(target.staffId) ?? []), { item, step: target.step, existing: target.existing }]);
      }
    }
    const db = this.prisma.forTenantId(tenantId);
    const connected = new Set<DeliveryChannel>(LIVE_DELIVERY_CHANNELS);
    const appName = loadBrandingConfig().appName;
    for (const [staffId, entries] of pending) {
      if (entries.length < DIGEST_MIN_ITEMS) continue;
      const recipient = entries[0]!.step.staff;
      const plan = planDelivery(recipient, connected);
      const digest = composeStaffDigest({
        recipientFirstName: recipient.firstName,
        entries: entries.map((e) => ({ kind: e.item.kind as AttentionKind, caseTitle: e.item.case.title, reason: e.item.reason, link: `${this.env.WEB_BASE_URL.replace(/\/$/, '')}/cases/${e.item.caseId}` })),
        appName,
      });
      let outcome: { status: 'SENT' | 'FAILED' | 'SKIPPED'; deliveredVia?: string; executionMode?: string; note?: string; error?: string };
      if (!plan) {
        outcome = { status: 'SKIPPED', note: 'Keine erreichbare Adresse für einen angebundenen Kanal – bitte Kontaktdaten ergänzen.' };
      } else {
        try {
          const delivered = await this.mail.send(tenantId, { to: plan.address, subject: digest.subject, bodyText: digest.text });
          outcome = { status: 'SENT', deliveredVia: plan.via, executionMode: delivered.executionMode, note: plan.note };
        } catch (error) {
          outcome = { status: 'FAILED', deliveredVia: plan.via, error: (error instanceof Error ? error.message : String(error)).slice(0, 300), note: plan.note };
        }
      }
      const note = [`In einer Zusammenfassung mit ${entries.length} Vorgängen gemeldet.`, outcome.note].filter(Boolean).join(' ');
      for (const { item, step, existing } of entries) {
        const data = { tenantId, attentionItemId: item.id, staffMemberId: staffId, phase: 'INITIAL', role: step.role, subject: digest.subject, wantedChannel: step.staff.preferredChannel, status: outcome.status, deliveredVia: outcome.deliveredVia ?? null, executionMode: outcome.executionMode ?? null, note, error: outcome.error ?? null };
        if (existing) await db.staffNotification.update({ where: { id: existing.id }, data: { ...data, attempts: existing.attempts + 1 } });
        else await db.staffNotification.create({ data });
        if (outcome.status === 'SENT') {
          result.notified += 1;
          await db.attentionItem.update({ where: { id: item.id }, data: { lastNotifiedAt: now } });
          await this.audit.record({ tenantId, eventType: 'ATTENTION_NOTIFIED', actorType: 'SYSTEM', entityType: 'Case', entityId: item.caseId, payload: { staffMemberId: staffId, role: step.role, phase: 'INITIAL', wantedChannel: step.staff.preferredChannel, deliveredVia: outcome.deliveredVia, executionMode: outcome.executionMode, digest: true } });
        }
        // Gelungen oder dauerhaft nicht zustellbar: der Einzelweg soll nicht zusätzlich senden. Fehlgeschlagen: der Einzelweg wiederholt nach Abstand wie gewohnt.
        if (outcome.status !== 'FAILED') handled.set(item.id, new Set([...(handled.get(item.id) ?? []), staffId]));
      }
      if (outcome.status === 'FAILED') result.failed += 1;
    }
    return handled;
  }

  /** Meldungen dieser Phase an die zuständigen Personen und – je nach Phase – Vertretung, Vorgesetzte und Leitung; je Person und Phase höchstens eine. */
  private async notifyPhase(
    tenantId: string,
    item: { id: string; caseId: string; kind: string; responsibility: string; emergency: boolean; reason: string | null; case: { title: string } },
    phase: EscalationPhase,
    staff: RoutableStaff[],
    waitingMinutes: number,
    now: Date,
    skipStaffIds?: ReadonlySet<string>,
  ): Promise<{ sent: number; failed: number }> {
    const db = this.prisma.forTenantId(tenantId);
    const connected = new Set<DeliveryChannel>(LIVE_DELIVERY_CHANNELS);
    const appName = loadBrandingConfig().appName;
    let sent = 0;
    let failed = 0;
    for (const { staffId, step, responsibleName, existing } of await this.pendingTargets(tenantId, item, phase, staff, now)) {
      if (skipStaffIds?.has(staffId)) continue; // bereits in einer Zusammenfassung gemeldet

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
        standInFor: step.standIn ? responsibleName : undefined,
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

  /**
   * Bittet ausdrücklich um Aufmerksamkeit für einen Vorgang (Fähigkeit „staff.notify“): ein Eintrag je Vorgang, dessen Text bei erneutem Aufruf aktualisiert wird.
   * Die Meldung selbst, Erinnerung und Eskalation übernimmt derselbe Takt wie bei den anderen Fällen.
   */
  async raise(tenantId: string, caseId: string, input: { message: string; urgent: boolean; relayTo?: 'DISPATCH' }): Promise<{ id: string; responsibility: string; created: boolean }> {
    const db = this.prisma.forTenantId(tenantId);
    // Die Weitergabe an Monteure ist ein eigener Auftrag: gibt es dafür niemanden im Verzeichnis, wird nicht still an die Leitung gemeldet (das wäre ein anderes, leichteres Ziel).
    if (input.relayTo === 'DISPATCH') {
      const directory = await db.staffMember.findMany({ where: { tenantId, active: true } });
      if (!directory.some((s) => s.responsibilities.includes('DISPATCH'))) throw new Error('Im Mitarbeiterverzeichnis ist niemand für die Weitergabe an Monteure zuständig.');
    }
    const existing = await db.attentionItem.findFirst({ where: { tenantId, caseId, kind: 'NOTIFY_REQUEST', state: { not: 'RESOLVED' }, ...(input.relayTo ? { responsibility: input.relayTo } : {}) } });
    if (existing) {
      if (existing.reason !== input.message) await db.attentionItem.update({ where: { id: existing.id }, data: { reason: input.message, emergency: existing.emergency || input.urgent } });
      return { id: existing.id, responsibility: existing.responsibility, created: false };
    }
    const row = await db.case.findUnique({ where: { id: caseId }, select: { type: true } });
    const categories = await this.categoriesFor(tenantId, [caseId]);
    const responsibility = input.relayTo ?? responsibilityForCase({ category: categories.get(caseId), caseType: row?.type, emergency: input.urgent });
    const created = await db.attentionItem.create({ data: { tenantId, caseId, kind: 'NOTIFY_REQUEST', responsibility, emergency: input.urgent, reason: input.message, state: 'OPEN', firstSeenAt: new Date() } });
    return { id: created.id, responsibility, created: true };
  }

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
