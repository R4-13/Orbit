import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import { SHADOW_PLAN_LIMIT_PER_TENANT, SHADOW_QUOTA_MAX_PER_GRANT } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface ShadowQuotaGrantView {
  id: string;
  tenantId: string;
  amount: number;
  purpose: string;
  decidedBy: string;
  status: 'INACTIVE' | 'ACTIVE' | 'REVOKED';
  activatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Verbrauchte Einheiten dieses Kontingents (Reservierungen, Ergebnisse und nicht mögliche Planungen zählen alle). */
  consumed: number;
  /** Davon: Planung läuft noch (reserviert) / Ergebnis liegt vor / Planung nicht möglich / ausdrückliche Wiederholungen. */
  reserved: number;
  done: number;
  unavailable: number;
  repeats: number;
  remaining: number;
}

export interface ShadowQuotaStatus {
  /** Bisheriger, unveränderlicher Zähler (Grundgrenze). */
  base: { used: number; limit: number };
  grants: ShadowQuotaGrantView[];
}

export interface QuotaUnit {
  grantId: string;
  ledgerId: string;
  kind: 'FIRST' | 'REPEAT';
  attempt: number;
}

/**
 * Zusätzliches Kontingent an Schattenplanungen (Prüfplan D9). Ein Kontingent ist eine **protokollierte Entscheidung** (wer, wofür, wie viele) mit festem Höchstwert; es entsteht INAKTIV, wirkt erst nach
 * ausdrücklicher Aktivierung und nur, wenn die feste Grundgrenze (`SHADOW_PLAN_LIMIT_PER_TENANT`) erreicht ist. Der bisherige Zähler bleibt unberührt: Planungen aus einem Kontingent zählen im Hauptbuch
 * (`shadow_quota_ledger`), nie in der Grundzählung. Verbrauch, Reservierung (Planung läuft) und ausdrückliche Wiederholungen sind einzeln nachvollziehbar und überleben das Löschen von Testvorgängen.
 */
@Injectable()
export class ShadowQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Entscheidung festhalten ─────────────────────────────────────────────────────────────────────────────────────

  async create(tenantId: string, input: { amount: number; purpose: string; decidedBy: string }): Promise<ShadowQuotaGrantView> {
    if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > SHADOW_QUOTA_MAX_PER_GRANT) throw new BadRequestException(`Das Kontingent muss zwischen 1 und ${SHADOW_QUOTA_MAX_PER_GRANT} liegen.`);
    if (input.purpose.trim().length < 10) throw new BadRequestException('Der Zweck ist anzugeben (mindestens 10 Zeichen).');
    if (input.decidedBy.trim().length < 5) throw new BadRequestException('Wer das Kontingent beschlossen hat (Name/Rolle und Datum), ist anzugeben.');
    const grantId = await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const grant = await tx.shadowQuotaGrant.create({ data: { tenantId, amount: input.amount, purpose: input.purpose.trim(), decidedBy: input.decidedBy.trim() } });
      await this.audit(tx, tenantId, grant.id, 'SHADOW_QUOTA_GRANT_CREATED', { amount: grant.amount, purpose: grant.purpose, decidedBy: grant.decidedBy, status: grant.status });
      return grant.id;
    });
    return this.view(tenantId, grantId);
  }

  /** Höchstens ein aktives Kontingent je Mandant; Aktivierung nur aus INACTIVE. */
  async activate(tenantId: string, grantId: string, activatedBy: string): Promise<ShadowQuotaGrantView> {
    if (activatedBy.trim().length < 5) throw new BadRequestException('Wer das Kontingent aktiviert (Name/Rolle und Datum), ist anzugeben.');
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shadow:${tenantId}`}))`;
      const grant = await tx.shadowQuotaGrant.findFirst({ where: { id: grantId, tenantId } });
      if (!grant) throw new NotFoundException('Kontingent nicht gefunden.');
      if (grant.status !== 'INACTIVE') throw new ConflictException(`Das Kontingent ist ${grant.status} und kann nicht aktiviert werden.`);
      if (await tx.shadowQuotaGrant.findFirst({ where: { tenantId, status: 'ACTIVE' }, select: { id: true } })) throw new ConflictException('Für diesen Mandanten ist bereits ein Kontingent aktiv.');
      await tx.shadowQuotaGrant.update({ where: { id: grantId }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      await this.audit(tx, tenantId, grantId, 'SHADOW_QUOTA_GRANT_ACTIVATED', { activatedBy: activatedBy.trim() });
    });
    return this.view(tenantId, grantId);
  }

  /** Beendet ein Kontingent endgültig; bereits Verbrauchtes bleibt im Hauptbuch. */
  async revoke(tenantId: string, grantId: string, reason: string): Promise<ShadowQuotaGrantView> {
    if (reason.trim().length < 5) throw new BadRequestException('Ein Grund ist anzugeben.');
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shadow:${tenantId}`}))`;
      const grant = await tx.shadowQuotaGrant.findFirst({ where: { id: grantId, tenantId } });
      if (!grant) throw new NotFoundException('Kontingent nicht gefunden.');
      if (grant.status === 'REVOKED') throw new ConflictException('Das Kontingent ist bereits beendet.');
      await tx.shadowQuotaGrant.update({ where: { id: grantId }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await this.audit(tx, tenantId, grantId, 'SHADOW_QUOTA_GRANT_REVOKED', { reason: reason.trim(), wasStatus: grant.status });
    });
    return this.view(tenantId, grantId);
  }

  // ── Lesen ───────────────────────────────────────────────────────────────────────────────────────────────────────

  async status(tenantId: string): Promise<ShadowQuotaStatus> {
    return this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const grants = await tx.shadowQuotaGrant.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
      const ledger = await tx.shadowQuotaLedger.findMany({ where: { tenantId }, select: { grantId: true, kind: true, state: true } });
      return {
        base: { used: await this.baseUsedInTx(tx, tenantId), limit: SHADOW_PLAN_LIMIT_PER_TENANT },
        grants: grants.map((g) => this.toView(g, ledger.filter((l) => l.grantId === g.id))),
      };
    });
  }

  private async view(tenantId: string, grantId: string): Promise<ShadowQuotaGrantView> {
    const status = await this.status(tenantId);
    const grant = status.grants.find((g) => g.id === grantId);
    if (!grant) throw new NotFoundException('Kontingent nicht gefunden.');
    return grant;
  }

  private toView(g: { id: string; tenantId: string; amount: number; purpose: string; decidedBy: string; status: string; activatedAt: Date | null; revokedAt: Date | null; createdAt: Date }, ledger: Array<{ kind: string; state: string }>): ShadowQuotaGrantView {
    const count = (predicate: (l: { kind: string; state: string }) => boolean) => ledger.filter(predicate).length;
    return {
      id: g.id,
      tenantId: g.tenantId,
      amount: g.amount,
      purpose: g.purpose,
      decidedBy: g.decidedBy,
      status: g.status as ShadowQuotaGrantView['status'],
      activatedAt: g.activatedAt?.toISOString() ?? null,
      revokedAt: g.revokedAt?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
      consumed: ledger.length,
      reserved: count((l) => l.state === 'RESERVED'),
      done: count((l) => l.state === 'DONE'),
      unavailable: count((l) => l.state === 'UNAVAILABLE'),
      repeats: count((l) => l.kind === 'REPEAT'),
      remaining: Math.max(0, g.amount - ledger.length),
    };
  }

  // ── Verbrauch (unter der Mandantensperre der Schattenplanung) ───────────────────────────────────────────────────

  /** Die bisherige Grundzählung (unverändert): Planungen ohne die aus einem Kontingent; maßgeblich ist der größere von Ereignis- und Auditzählung. */
  async baseUsedInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const grantEvents = await this.grantEventIdsInTx(tx, tenantId);
    const events = await tx.caseEvent.count({ where: { tenantId, type: 'shadow.plan_proposed', ...(grantEvents.length > 0 ? { id: { notIn: grantEvents } } : {}) } });
    const audited = await tx.auditLog.count({ where: { tenantId, eventType: 'SHADOW_PLAN_CONSUMED' } });
    return Math.max(events, audited);
  }

  /** Ereignisse, die aus einem Kontingent stammen: sie zählen nicht in der Grundzählung. */
  async grantEventIdsInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<string[]> {
    const rows = await tx.shadowQuotaLedger.findMany({ where: { tenantId, caseEventId: { not: null } }, select: { caseEventId: true } });
    return rows.flatMap((r) => (r.caseEventId ? [r.caseEventId] : []));
  }

  /**
   * Nimmt eine Einheit aus dem aktiven Kontingent des Mandanten (oder nichts, wenn keines aktiv oder aufgebraucht ist). Die Einheit steht danach als RESERVED im Hauptbuch; der Aufrufer trägt das
   * Ereignis nach (`attach`) und schließt sie mit `finish` ab. Aufzurufen unter der Sperre `shadow:<Mandant>`.
   */
  async takeInTx(tx: Prisma.TransactionClient, tenantId: string, caseId: string, kind: 'FIRST' | 'REPEAT'): Promise<{ unit: QuotaUnit } | { unit: null; reason: 'NO_ACTIVE_GRANT' | 'EXHAUSTED' }> {
    const grant = await tx.shadowQuotaGrant.findFirst({ where: { tenantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    if (!grant) return { unit: null, reason: 'NO_ACTIVE_GRANT' };
    const used = await tx.shadowQuotaLedger.count({ where: { grantId: grant.id } });
    if (used >= grant.amount) return { unit: null, reason: 'EXHAUSTED' };
    // Nummer der Planung dieses Vorgangs: die wievielte Schattenplanung (aus Grundzählung oder Kontingent) es ist.
    const planned = await tx.caseEvent.count({ where: { tenantId, caseId, type: 'shadow.plan_proposed' } });
    const attempt = planned + 1;
    if (kind === 'FIRST' && planned > 0) throw new ConflictException('Für diesen Vorgang liegt bereits eine Schattenplanung vor.');
    const row = await tx.shadowQuotaLedger.create({ data: { tenantId, grantId: grant.id, caseId, kind, attempt, state: 'RESERVED' } });
    await this.audit(tx, tenantId, grant.id, 'SHADOW_QUOTA_UNIT_RESERVED', { caseId, kind, attempt, consumedAfter: used + 1, amount: grant.amount });
    return { unit: { grantId: grant.id, ledgerId: row.id, kind, attempt } };
  }

  async attachInTx(tx: Prisma.TransactionClient, ledgerId: string, caseEventId: string): Promise<void> {
    await tx.shadowQuotaLedger.update({ where: { id: ledgerId }, data: { caseEventId } });
  }

  /** Schließt eine reservierte Einheit ab. Eine nicht mögliche Planung verbraucht die Einheit trotzdem (der Planeraufruf wurde versucht). */
  async finish(tenantId: string, ledgerId: string, state: 'DONE' | 'UNAVAILABLE'): Promise<void> {
    await this.prisma.forTenantId(tenantId).shadowQuotaLedger.update({ where: { id: ledgerId }, data: { state } });
  }

  private async audit(tx: Prisma.TransactionClient, tenantId: string, grantId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    await tx.auditLog.create({ data: { tenantId, eventType, actorType: 'SYSTEM', entityType: 'shadow_quota_grant', entityId: grantId, payload: payload as Prisma.InputJsonValue } });
  }
}
