import { ConflictException, Injectable } from '@nestjs/common';
import type { AICostLimit, Prisma } from '@orbit/domain';
import {
  AiProviderUnavailableError,
  NotFoundError,
  ValidationFailedError,
  costLimitApplies,
  costLimitScopeKey,
  costLimitState,
  costPeriodStart,
  detectUsageAnomaly,
  validateCostLimit,
  type CostLimitDefinition,
  type CostLimitScope,
  type CostLimitState,
  type PlatformPrincipal,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from '../platform/audit/platform-audit.service';

/** Plattformfinanzierte Aufrufe: nur sie zählen gegen die Limits. Mit eigenem Schlüssel (BYOK) trägt der Mandant die Kosten selbst. */
const PLATFORM_PAID_SOURCES = ['ORBIT_MANAGED', 'ENV_BOOTSTRAP'];
/** Eine Reservierung verfällt von selbst, falls ein Prozess zwischen Beginn und Ende eines Aufrufs stirbt (der Anbieter-Client bricht spätestens nach zehn Minuten ab). */
const RESERVATION_TTL_MS = 12 * 60_000;
/** Erledigte und verfallene Reservierungen werden beiläufig nach einer Woche entfernt. */
const RESERVATION_KEEP_MS = 7 * 24 * 3_600_000;

export interface CostLimitView {
  id: string;
  scope: CostLimitScope;
  targetTenantId: string | null;
  profileKey: string | null;
  currency: string;
  warnAmount: number | null;
  softAmount: number | null;
  hardAmount: number | null;
  hardEnforced: boolean;
  version: number;
  note: string | null;
  updatedAt: string;
}

export interface CostLimitEvaluation extends CostLimitView {
  periodStart: string;
  /** Bisher aufgelaufene, messbare Kosten im Monat (nur Aufrufe mit Kostenprofil in der Währung des Limits). */
  spent: number;
  state: CostLimitState;
  /** Aufrufe im Monat ohne Kostenprofil: ihr Betrag ist unbekannt und steckt nicht in `spent`. */
  unmeasuredRequests: number;
  /** Schlimmster Fall der gerade laufenden Aufrufe, der für die Durchsetzung zu `spent` hinzugerechnet wird. */
  reserved: number;
}

/** Geschätzter schlimmster Fall eines Aufrufs; `null` = Preis des Modells unbekannt. */
export interface CallEstimate {
  amount: number;
  currency: string;
}

/** Eine offene Reservierung für einen laufenden Aufruf; `release` gibt sie frei (nachdem der tatsächliche Verbrauch gemessen wurde). */
export interface CostTicket {
  release(): Promise<void>;
}

export interface CostAnomaly {
  tenantId: string;
  requestsLast24h: number;
  costLast24h: number;
  baselineDailyRequests: number;
  factor: number;
}

const num = (value: { toString(): string } | null): number | null => (value === null ? null : Number(value.toString()));

function toView(row: AICostLimit): CostLimitView {
  return {
    id: row.id,
    scope: row.scope as CostLimitScope,
    targetTenantId: row.targetTenantId,
    profileKey: row.profileKey,
    currency: row.currency,
    warnAmount: num(row.warnAmount),
    softAmount: num(row.softAmount),
    hardAmount: num(row.hardAmount),
    hardEnforced: row.hardEnforced,
    version: row.version,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const definitionOf = (view: CostLimitView): CostLimitDefinition => ({ scope: view.scope, targetTenantId: view.targetTenantId, profileKey: view.profileKey, warnAmount: view.warnAmount, softAmount: view.softAmount, hardAmount: view.hardAmount, hardEnforced: view.hardEnforced });

/**
 * Kosten-Leitplanken der KI-Nutzung (Amendment 03 §12.3): Limits je Plattform, Mandant oder Profil mit Warnschwelle, Soft- und Hard-Limit, Bewertung auf den echten
 * Messwerten des laufenden Monats und – nur wenn ausdrücklich so konfiguriert – Durchsetzung des Hard-Limits als **ehrlicher Block** (der Aufruf wird abgewiesen
 * und der Vorgang bekommt den Zustand „KI vorübergehend nicht verfügbar“, nie ein stilles „erledigt“). Eigene Schlüssel der Mandanten (BYOK) sind ausgenommen.
 */
@Injectable()
export class AiCostGuardrailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  // ── Lesen und Bewerten ───────────────────────────────────────────────────────────────────────────────────────────

  async list(now = new Date()): Promise<CostLimitEvaluation[]> {
    const rows = await this.prisma.withPlatformScope((tx) => tx.aICostLimit.findMany({ orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }] }));
    return Promise.all(rows.map((row) => this.evaluate(toView(row), now)));
  }

  private scopeWhere(view: CostLimitView): { tenantId?: string; profileKey?: string } {
    return { ...(view.scope === 'TENANT' && view.targetTenantId ? { tenantId: view.targetTenantId } : {}), ...(view.scope === 'PROFILE' && view.profileKey ? { profileKey: view.profileKey } : {}) };
  }

  /** Gemessene Kosten des Monats (nur Aufrufe mit Kostenprofil in der Währung des Limits). */
  private async spentOf(tx: Prisma.TransactionClient, view: CostLimitView, now: Date): Promise<{ spent: number; unmeasured: number }> {
    const scoped: Prisma.AIUsageRecordWhereInput = { createdAt: { gte: costPeriodStart(now) }, source: { in: PLATFORM_PAID_SOURCES }, ...this.scopeWhere(view) };
    const [measured, unmeasured] = await Promise.all([
      tx.aIUsageRecord.aggregate({ where: { ...scoped, estimatedCost: { not: null }, costCurrency: view.currency }, _sum: { estimatedCost: true } }),
      tx.aIUsageRecord.count({ where: { ...scoped, estimatedCost: null } }),
    ]);
    return { spent: Number(measured._sum.estimatedCost?.toString() ?? 0), unmeasured };
  }

  private reservationScope(view: CostLimitView): { targetTenantId?: string; profileKey?: string } {
    const scope = this.scopeWhere(view);
    return { ...(scope.tenantId ? { targetTenantId: scope.tenantId } : {}), ...(scope.profileKey ? { profileKey: scope.profileKey } : {}) };
  }

  /** Summe der offenen, nicht verfallenen Reservierungen im Geltungsbereich des Limits. */
  private async reservedOf(tx: Prisma.TransactionClient, view: CostLimitView, now: Date): Promise<number> {
    const sum = await tx.aICostReservation.aggregate({ where: { status: 'RESERVED', expiresAt: { gt: now }, currency: view.currency, ...this.reservationScope(view) }, _sum: { amount: true } });
    return Number(sum._sum.amount?.toString() ?? 0);
  }

  private async evaluate(view: CostLimitView, now: Date): Promise<CostLimitEvaluation> {
    const periodStart = costPeriodStart(now);
    const { spent, unmeasured, reserved } = await this.prisma.withPlatformScope(async (tx) => ({ ...(await this.spentOf(tx, view, now)), reserved: await this.reservedOf(tx, view, now) }));
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    return { ...view, periodStart: periodStart.toISOString(), spent: round(spent), state: costLimitState(spent, view), unmeasuredRequests: unmeasured, reserved: round(reserved) };
  }

  /** Ungewöhnliche Nutzung je Mandant: letzte 24 Stunden gegen den Tagesdurchschnitt der sieben Tage davor (nur plattformfinanzierte Aufrufe). */
  async anomalies(now = new Date()): Promise<CostAnomaly[]> {
    const dayMs = 24 * 3_600_000;
    const since = new Date(now.getTime() - 8 * dayMs);
    const rows = await this.prisma.withPlatformScope((tx) =>
      tx.aIUsageRecord.findMany({ where: { createdAt: { gte: since }, source: { in: PLATFORM_PAID_SOURCES } }, select: { tenantId: true, createdAt: true, estimatedCost: true } }),
    );
    const byTenant = new Map<string, { recent: number; cost: number; days: number[] }>();
    for (const row of rows) {
      const entry = byTenant.get(row.tenantId) ?? { recent: 0, cost: 0, days: Array.from({ length: 7 }, () => 0) };
      const age = now.getTime() - row.createdAt.getTime();
      if (age < dayMs) {
        entry.recent += 1;
        entry.cost += Number(row.estimatedCost?.toString() ?? 0);
      } else {
        const day = Math.min(6, Math.floor((age - dayMs) / dayMs));
        entry.days[6 - day] = (entry.days[6 - day] ?? 0) + 1;
      }
      byTenant.set(row.tenantId, entry);
    }
    const out: CostAnomaly[] = [];
    for (const [tenantId, entry] of byTenant) {
      const verdict = detectUsageAnomaly({ recent: { requests: entry.recent, cost: entry.cost }, baselineDailyRequests: entry.days });
      if (verdict.anomalous && verdict.factor !== null) out.push({ tenantId, requestsLast24h: entry.recent, costLast24h: Math.round(entry.cost * 1e6) / 1e6, baselineDailyRequests: verdict.baselineAverage, factor: verdict.factor });
    }
    return out.sort((a, b) => b.factor - a.factor);
  }

  // ── Durchsetzung (nur Hard-Limit, nur wenn ausdrücklich durchgesetzt) ──────────────────────────────────────────

  private unavailable(limit: Pick<CostLimitView, 'scope'>, profileKey: string, reason: string, extra: Record<string, unknown> = {}): AiProviderUnavailableError {
    return new AiProviderUnavailableError('Das Kostenlimit für die KI-Nutzung ist erreicht oder lässt sich nicht sicher prüfen. Neue KI-Aufrufe sind vorübergehend nicht möglich; laufende Vorgänge warten.', {
      mode: 'COST_LIMIT',
      profileKey,
      reasons: [reason],
      limitScope: limit.scope,
      ...extra,
    });
  }

  private async enforcedLimitsFor(tenantId: string, profileKey: string): Promise<CostLimitView[]> {
    const rows = await this.prisma.withPlatformScope((tx) => tx.aICostLimit.findMany({ where: { hardEnforced: true } }));
    return rows.map(toView).filter((limit) => costLimitApplies(limit, { tenantId, profileKey }));
  }

  /**
   * Nur Prüfung ohne Reservierung (Verbrauch allein, ohne Zwischenspeicher): ist ein durchgesetztes Hard-Limit, das für diesen Aufruf gilt, erreicht, wird ehrlich abgewiesen
   * (`AiProviderUnavailableError`, Grund `COST_LIMIT_HARD`). Der Aufrufweg nutzt `reserveCall`, das zusätzlich die laufenden Aufrufe und den schlimmsten Fall des neuen Aufrufs einrechnet.
   */
  async assertWithinBudget(tenantId: string, profileKey: string): Promise<void> {
    const limits = await this.enforcedLimitsFor(tenantId, profileKey);
    const now = new Date();
    for (const limit of limits) {
      const { spent } = await this.prisma.withPlatformScope((tx) => this.spentOf(tx, limit, now));
      if (costLimitState(spent, limit) === 'HARD_EXCEEDED') throw this.unavailable(limit, profileKey, 'COST_LIMIT_HARD');
    }
  }

  /**
   * Vor jedem plattformfinanzierten KI-Aufruf: gilt für den Aufruf ein durchgesetztes Hard-Limit, wird atomar (eine Sperre für alle Prozesse, API und Worker) geprüft, ob Verbrauch des Monats
   * PLUS die offenen Reservierungen laufender Aufrufe PLUS der schlimmste Fall dieses Aufrufs das Limit überschreiten würde – dann beginnt der Aufruf nicht (Grund `COST_LIMIT_HARD`). Sonst wird der
   * schlimmste Fall reserviert; die Reservierung gibt der Aufrufer nach der Messung des tatsächlichen Verbrauchs frei. Ist der Preis des Modells unbekannt (`estimate` leer) oder weicht die Währung
   * ab, wird nicht geraten, sondern abgewiesen (`COST_PRICE_UNKNOWN`, `COST_CURRENCY_MISMATCH`). Gilt kein durchgesetztes Limit, passiert nichts (kein Zusatzaufwand).
   */
  async reserveCall(tenantId: string, profileKey: string, estimate: CallEstimate | null): Promise<CostTicket | undefined> {
    const applicable = await this.enforcedLimitsFor(tenantId, profileKey);
    if (applicable.length === 0) return undefined;
    const reservationId = await this.prisma.withPlatformScope(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('orbit:ai-cost-reserve'))`;
      const now = new Date();
      // Limits unter der Sperre neu lesen: eine zwischenzeitliche Änderung gilt sofort.
      const limits = (await tx.aICostLimit.findMany({ where: { hardEnforced: true } })).map(toView).filter((limit) => costLimitApplies(limit, { tenantId, profileKey }));
      if (limits.length === 0) return null;
      for (const limit of limits) {
        if (!estimate) throw this.unavailable(limit, profileKey, 'COST_PRICE_UNKNOWN');
        if (estimate.currency !== limit.currency) throw this.unavailable(limit, profileKey, 'COST_CURRENCY_MISMATCH', { limitCurrency: limit.currency, priceCurrency: estimate.currency });
        const { spent } = await this.spentOf(tx, limit, now);
        const reserved = await this.reservedOf(tx, limit, now);
        const hard = limit.hardAmount as number;
        if (spent + reserved + estimate.amount > hard) {
          throw this.unavailable(limit, profileKey, 'COST_LIMIT_HARD', { spent: Math.round(spent * 1e6) / 1e6, reserved: Math.round(reserved * 1e6) / 1e6, requested: Math.round(estimate.amount * 1e6) / 1e6, hardAmount: hard });
        }
      }
      await tx.aICostReservation.deleteMany({ where: { OR: [{ status: 'RELEASED', releasedAt: { lt: new Date(now.getTime() - RESERVATION_KEEP_MS) } }, { expiresAt: { lt: new Date(now.getTime() - RESERVATION_KEEP_MS) } }] } });
      const created = await tx.aICostReservation.create({ data: { targetTenantId: tenantId, profileKey, currency: (estimate as CallEstimate).currency, amount: (estimate as CallEstimate).amount, expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS) } });
      return created.id;
    });
    if (reservationId === null) return undefined;
    return { release: () => this.releaseReservation(reservationId) };
  }

  private async releaseReservation(id: string): Promise<void> {
    await this.prisma.withPlatformScope((tx) => tx.aICostReservation.updateMany({ where: { id, status: 'RESERVED' }, data: { status: 'RELEASED', releasedAt: new Date() } }));
  }

  // ── Schreiben (auditiert, versioniert) ───────────────────────────────────────────────────────────────────────────

  async upsert(
    actor: PlatformPrincipal,
    input: { scope: CostLimitScope; targetTenantId?: string; profileKey?: string; currency?: string; warnAmount?: number; softAmount?: number; hardAmount?: number; hardEnforced?: boolean; expectedVersion?: number; reason: string },
  ): Promise<CostLimitView> {
    const definition: CostLimitDefinition = { scope: input.scope, targetTenantId: input.targetTenantId ?? null, profileKey: input.profileKey ?? null, warnAmount: input.warnAmount ?? null, softAmount: input.softAmount ?? null, hardAmount: input.hardAmount ?? null, hardEnforced: input.hardEnforced === true };
    const issues = validateCostLimit(definition);
    if (issues.length > 0) throw new ValidationFailedError('Das Kostenlimit ist nicht zulässig.', { issues });
    if (definition.scope === 'TENANT') {
      const tenant = await this.prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { id: definition.targetTenantId as string }, select: { id: true } }));
      if (!tenant) throw new NotFoundError('Mandant nicht gefunden.');
    }
    const scopeKey = costLimitScopeKey(definition);
    const currency = (input.currency ?? 'USD').toUpperCase();
    const data = { warnAmount: definition.warnAmount, softAmount: definition.softAmount, hardAmount: definition.hardAmount, hardEnforced: definition.hardEnforced, currency, note: input.reason, updatedByUserId: actor.userId };

    const view = await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.aICostLimit.findUnique({ where: { scopeKey } });
      if (!before) {
        if (input.expectedVersion !== undefined && input.expectedVersion !== 0) throw new ConflictException('Das Limit wurde zwischenzeitlich geändert oder entfernt. Bitte neu laden.');
        const created = await tx.aICostLimit.create({ data: { scope: definition.scope, scopeKey, targetTenantId: definition.targetTenantId, profileKey: definition.profileKey, createdByUserId: actor.userId, ...data } });
        await this.audit.record({ eventType: 'PLATFORM_AI_COST_LIMIT_CHANGED', actor: { userId: actor.userId, roles: actor.platformRoles }, targetType: 'AICostLimit', targetId: created.id, targetTenantId: definition.targetTenantId ?? undefined, reason: input.reason, before: null, after: toView(created) }, tx);
        return toView(created);
      }
      if (input.expectedVersion === undefined || input.expectedVersion !== before.version) throw new ConflictException('Das Limit wurde zwischenzeitlich geändert. Bitte neu laden.');
      const updated = await tx.aICostLimit.updateMany({ where: { id: before.id, version: before.version }, data: { ...data, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Das Limit wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.aICostLimit.findUniqueOrThrow({ where: { id: before.id } });
      await this.audit.record({ eventType: 'PLATFORM_AI_COST_LIMIT_CHANGED', actor: { userId: actor.userId, roles: actor.platformRoles }, targetType: 'AICostLimit', targetId: after.id, targetTenantId: definition.targetTenantId ?? undefined, reason: input.reason, before: toView(before), after: toView(after) }, tx);
      return toView(after);
    });
    return view;
  }

  async remove(actor: PlatformPrincipal, id: string, input: { expectedVersion: number; reason: string }): Promise<void> {
    await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.aICostLimit.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Limit nicht gefunden.');
      const deleted = await tx.aICostLimit.deleteMany({ where: { id, version: input.expectedVersion } });
      if (deleted.count !== 1) throw new ConflictException('Das Limit wurde zwischenzeitlich geändert. Bitte neu laden.');
      await this.audit.record({ eventType: 'PLATFORM_AI_COST_LIMIT_CHANGED', actor: { userId: actor.userId, roles: actor.platformRoles }, targetType: 'AICostLimit', targetId: id, targetTenantId: before.targetTenantId ?? undefined, reason: input.reason, before: toView(before), after: null }, tx);
    });
  }
}

export { definitionOf as costLimitDefinitionOf };
