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
/** Die Durchsetzung liest einen kurz zwischengespeicherten Stand – ein KI-Aufruf löst keine Abfrage über den ganzen Monat aus. */
const ENFORCEMENT_CACHE_MS = 30_000;

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
  private enforcement?: { at: number; exceeded: CostLimitView[] };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  invalidate(): void {
    this.enforcement = undefined;
  }

  // ── Lesen und Bewerten ───────────────────────────────────────────────────────────────────────────────────────────

  async list(now = new Date()): Promise<CostLimitEvaluation[]> {
    const rows = await this.prisma.withPlatformScope((tx) => tx.aICostLimit.findMany({ orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }] }));
    return Promise.all(rows.map((row) => this.evaluate(toView(row), now)));
  }

  private async evaluate(view: CostLimitView, now: Date): Promise<CostLimitEvaluation> {
    const periodStart = costPeriodStart(now);
    const scoped: Prisma.AIUsageRecordWhereInput = {
      createdAt: { gte: periodStart },
      source: { in: PLATFORM_PAID_SOURCES },
      ...(view.scope === 'TENANT' && view.targetTenantId ? { tenantId: view.targetTenantId } : {}),
      ...(view.scope === 'PROFILE' && view.profileKey ? { profileKey: view.profileKey } : {}),
    };
    const [measured, unmeasured] = await this.prisma.withPlatformScope((tx) =>
      Promise.all([
        tx.aIUsageRecord.aggregate({ where: { ...scoped, estimatedCost: { not: null }, costCurrency: view.currency }, _sum: { estimatedCost: true } }),
        tx.aIUsageRecord.count({ where: { ...scoped, estimatedCost: null } }),
      ]),
    );
    const spent = Number(measured._sum.estimatedCost?.toString() ?? 0);
    return { ...view, periodStart: periodStart.toISOString(), spent: Math.round(spent * 1e6) / 1e6, state: costLimitState(spent, view), unmeasuredRequests: unmeasured };
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

  /**
   * Vor jedem plattformfinanzierten KI-Aufruf: ist ein durchgesetztes Hard-Limit, das für diesen Aufruf gilt, erreicht, wird der Aufruf ehrlich abgewiesen
   * (`AiProviderUnavailableError`, Grund `COST_LIMIT_HARD`) – die bestehenden Aufrufer behandeln das als „KI vorübergehend nicht verfügbar“.
   */
  async assertWithinBudget(tenantId: string, profileKey: string): Promise<void> {
    const exceeded = await this.exceededHardLimits();
    const hit = exceeded.find((limit) => costLimitApplies(limit, { tenantId, profileKey }));
    if (hit) {
      throw new AiProviderUnavailableError('Das Kostenlimit für die KI-Nutzung ist erreicht. Neue KI-Aufrufe sind vorübergehend nicht möglich; laufende Vorgänge warten.', {
        mode: 'COST_LIMIT',
        profileKey,
        reasons: ['COST_LIMIT_HARD'],
        limitScope: hit.scope,
      });
    }
  }

  private async exceededHardLimits(): Promise<CostLimitView[]> {
    if (this.enforcement && Date.now() - this.enforcement.at < ENFORCEMENT_CACHE_MS) return this.enforcement.exceeded;
    const rows = await this.prisma.withPlatformScope((tx) => tx.aICostLimit.findMany({ where: { hardEnforced: true } }));
    const now = new Date();
    const evaluated = await Promise.all(rows.map((row) => this.evaluate(toView(row), now)));
    const exceeded = evaluated.filter((e) => e.state === 'HARD_EXCEEDED');
    this.enforcement = { at: Date.now(), exceeded };
    return exceeded;
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
    this.invalidate();
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
    this.invalidate();
  }
}

export { definitionOf as costLimitDefinitionOf };
