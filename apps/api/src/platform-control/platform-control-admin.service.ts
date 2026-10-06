import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { CONNECTOR_REGISTRY } from '@orbit/integration-core';
import type { PlatformConnectorLifecycle, Prisma } from '@orbit/domain';
import {
  KILL_SWITCHES,
  KILL_SWITCH_DESCRIPTIONS,
  NotFoundError,
  TENANT_LIFECYCLE_STATUSES,
  TENANT_SUSPENSION_SCOPES,
  ValidationFailedError,
  confirmationTokenFor,
  describeTenantTarget,
  evaluateFlag,
  isKillSwitchKey,
  isReservedFlagKey,
  type FlagValue,
  type KillSwitchKey,
  type PlatformAuditEventType,
  type PlatformPrincipal,
} from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from '../platform/audit/platform-audit.service';
import { PlatformControlService } from './platform-control.service';

type Tx = Prisma.TransactionClient;

export interface FlagInput {
  description?: string;
  lifecycle?: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'RETIRED';
  defaultValue?: FlagValue;
  environmentOverrides?: Array<{ environment: string; value: FlagValue }>;
  cohortOverrides?: Array<{ cohort: string; value: FlagValue; percent?: number }>;
  tenantOverrides?: Array<{ tenantId: string; value: FlagValue }>;
  owner?: string;
  expiresAt?: Date | null;
  exposeToTenant?: boolean;
}

export interface FlagView {
  key: string;
  description: string;
  lifecycle: string;
  defaultValue: FlagValue;
  environmentOverrides: Array<{ environment: string; value: FlagValue }>;
  cohortOverrides: Array<{ cohort: string; value: FlagValue; percent?: number }>;
  tenantOverrides: Array<{ tenantId: string; value: FlagValue }>;
  owner: string;
  expiresAt: string | null;
  exposeToTenant: boolean;
  version: number;
  updatedAt: string;
}

function toFlagView(row: { key: string; description: string; lifecycle: string; defaultValue: unknown; environmentOverrides: unknown; cohortOverrides: unknown; tenantOverrides: unknown; owner: string; expiresAt: Date | null; exposeToTenant: boolean; version: number; updatedAt: Date }): FlagView {
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    key: row.key,
    description: row.description,
    lifecycle: row.lifecycle,
    defaultValue: row.defaultValue as FlagValue,
    environmentOverrides: list(row.environmentOverrides),
    cohortOverrides: list(row.cohortOverrides),
    tenantOverrides: list(row.tenantOverrides),
    owner: row.owner,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    exposeToTenant: row.exposeToTenant,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface TenantLifecyclePreview {
  tenantId: string;
  current: { status: string; suspensionScopes: string[]; featureCohorts: string[] };
  target: { status: string; suspensionScopes: string[]; featureCohorts: string[] };
  effects: string[];
  activeUsers: number;
  /** Muss unverändert an die Änderung gesendet werden: bindet die Bestätigung an genau diese beschriebene Wirkung (Amendment 03 §26.2). */
  confirmationToken: string;
}

const actorOf = (principal: PlatformPrincipal) => ({ userId: principal.userId, roles: principal.platformRoles });

/**
 * Schreibpfad der Plattformsteuerung (Amendment 03 §6, §13–§15, §26): Feature Flags, Kill Switches, Connector-Lifecycle, Mandantenlebenszyklus.
 * Jede Änderung ist versioniert (optimistisches Sperren), begründet, mit Vorher/Nachher auditiert und invalidiert die Laufzeit-Caches.
 * Weitreichende Mandantenänderungen verlangen eine Vorschau mit beschriebener Wirkung und ein daran gebundenes Bestätigungs-Token.
 */
@Injectable()
export class PlatformControlAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly control: PlatformControlService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  // ── Feature Flags ──────────────────────────────────────────────────────────────────────────────────────────────────

  async listFlags(): Promise<FlagView[]> {
    const rows = await this.prisma.withPlatformScope((tx) => tx.platformFeatureFlag.findMany({ orderBy: { key: 'asc' } }));
    return rows.map(toFlagView);
  }

  async createFlag(actor: PlatformPrincipal, key: string, input: FlagInput & { description: string; owner: string; defaultValue: FlagValue }): Promise<FlagView> {
    if (isReservedFlagKey(key)) throw new ValidationFailedError('Dieser Schlüssel ist für Sicherheitskontrollen reserviert und kann nicht als Feature Flag angelegt werden.', { key });
    this.validateOverrides(input);
    try {
      const created = await this.prisma.withPlatformScope(async (tx) => {
        const row = await tx.platformFeatureFlag.create({
          data: { key, description: input.description, lifecycle: input.lifecycle ?? 'DRAFT', defaultValue: input.defaultValue as Prisma.InputJsonValue, environmentOverrides: (input.environmentOverrides ?? []) as unknown as Prisma.InputJsonValue, cohortOverrides: (input.cohortOverrides ?? []) as unknown as Prisma.InputJsonValue, tenantOverrides: (input.tenantOverrides ?? []) as unknown as Prisma.InputJsonValue, owner: input.owner, expiresAt: input.expiresAt, exposeToTenant: input.exposeToTenant ?? false },
        });
        await this.record(tx, actor, 'PLATFORM_FEATURE_FLAG_CHANGED', 'PlatformFeatureFlag', key, null, toFlagView(row), 'Flag angelegt');
        return row;
      });
      this.control.invalidate();
      return toFlagView(created);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Dieses Feature Flag existiert bereits.');
      throw error;
    }
  }

  async updateFlag(actor: PlatformPrincipal, key: string, input: FlagInput & { expectedVersion: number; reason: string }): Promise<FlagView> {
    this.validateOverrides(input);
    const result = await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.platformFeatureFlag.findUnique({ where: { key } });
      if (!before) throw new NotFoundError('Feature Flag nicht gefunden.');
      const data: Prisma.PlatformFeatureFlagUpdateManyMutationInput = { version: { increment: 1 } };
      if (input.description !== undefined) data.description = input.description;
      if (input.lifecycle !== undefined) data.lifecycle = input.lifecycle;
      if (input.defaultValue !== undefined) data.defaultValue = input.defaultValue as Prisma.InputJsonValue;
      if (input.environmentOverrides !== undefined) data.environmentOverrides = input.environmentOverrides as unknown as Prisma.InputJsonValue;
      if (input.cohortOverrides !== undefined) data.cohortOverrides = input.cohortOverrides as unknown as Prisma.InputJsonValue;
      if (input.tenantOverrides !== undefined) data.tenantOverrides = input.tenantOverrides as unknown as Prisma.InputJsonValue;
      if (input.owner !== undefined) data.owner = input.owner;
      if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
      if (input.exposeToTenant !== undefined) data.exposeToTenant = input.exposeToTenant;
      const updated = await tx.platformFeatureFlag.updateMany({ where: { key, version: input.expectedVersion }, data });
      if (updated.count !== 1) throw new ConflictException('Das Feature Flag wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key } });
      await this.record(tx, actor, 'PLATFORM_FEATURE_FLAG_CHANGED', 'PlatformFeatureFlag', key, toFlagView(before), toFlagView(after), input.reason);
      return after;
    });
    this.control.invalidate();
    return toFlagView(result);
  }

  /** Vorschau (Amendment 03 §26.1): welche Mandanten das Flag im Moment mit welchem Wert und aus welcher Ebene bekommen. */
  async previewFlag(key: string) {
    const [flag, tenants] = await Promise.all([
      this.prisma.withPlatformScope((tx) => tx.platformFeatureFlag.findUnique({ where: { key } })),
      this.prisma.tenant.findMany({ select: { id: true, name: true, featureCohorts: true, status: true } }),
    ]);
    if (!flag) throw new NotFoundError('Feature Flag nicht gefunden.');
    const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    const definition = { key, lifecycle: flag.lifecycle, defaultValue: flag.defaultValue as FlagValue, environmentOverrides: list<{ environment: string; value: FlagValue }>(flag.environmentOverrides), cohortOverrides: list<{ cohort: string; value: FlagValue; percent?: number }>(flag.cohortOverrides), tenantOverrides: list<{ tenantId: string; value: FlagValue }>(flag.tenantOverrides), expiresAt: flag.expiresAt };
    const environment = this.env.ORBIT_ENVIRONMENT;
    const evaluations = tenants.map((t) => ({ tenantId: t.id, displayName: t.name, ...evaluateFlag(definition, { tenantId: t.id, cohorts: t.featureCohorts, environment }) }));
    const byValue = new Map<string, number>();
    for (const e of evaluations) byValue.set(JSON.stringify(e.value), (byValue.get(JSON.stringify(e.value)) ?? 0) + 1);
    return { key, version: flag.version, tenants: evaluations.length, distribution: [...byValue].map(([value, count]) => ({ value: JSON.parse(value) as FlagValue, count })), evaluations };
  }

  private validateOverrides(input: FlagInput): void {
    for (const cohort of input.cohortOverrides ?? []) {
      if (cohort.percent !== undefined && (cohort.percent < 1 || cohort.percent > 100)) throw new ValidationFailedError('Der Rollout-Anteil muss zwischen 1 und 100 liegen.', { cohort: cohort.cohort });
    }
  }

  // ── Kill Switches ──────────────────────────────────────────────────────────────────────────────────────────────────

  async listKillSwitches() {
    const rows = await this.prisma.withPlatformScope((tx) => tx.platformKillSwitch.findMany());
    return (Object.values(KILL_SWITCHES) as KillSwitchKey[]).map((key) => {
      const row = rows.find((r) => r.key === key);
      return { key, ...KILL_SWITCH_DESCRIPTIONS[key], engaged: row?.engaged ?? false, reason: row?.reason ?? null, changedAt: row?.changedAt?.toISOString() ?? null, changedByUserId: row?.changedByUserId ?? null, version: row?.version ?? 0 };
    });
  }

  async setKillSwitch(actor: PlatformPrincipal, key: string, input: { engaged: boolean; reason: string; expectedVersion?: number }) {
    if (!isKillSwitchKey(key)) throw new NotFoundError('Unbekannter Kill Switch.');
    const result = await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.platformKillSwitch.findUnique({ where: { key } });
      const now = new Date();
      if (!before) {
        if (input.expectedVersion !== undefined && input.expectedVersion !== 0) throw new ConflictException('Der Schalter wurde zwischenzeitlich geändert. Bitte neu laden.');
        await tx.platformKillSwitch.create({ data: { key, engaged: input.engaged, reason: input.reason, changedByUserId: actor.userId, changedAt: now } });
      } else {
        if (input.expectedVersion !== undefined && before.version !== input.expectedVersion) throw new ConflictException('Der Schalter wurde zwischenzeitlich geändert. Bitte neu laden.');
        await tx.platformKillSwitch.update({ where: { key }, data: { engaged: input.engaged, reason: input.reason, changedByUserId: actor.userId, changedAt: now, version: { increment: 1 } } });
      }
      const after = await tx.platformKillSwitch.findUniqueOrThrow({ where: { key } });
      await this.record(tx, actor, 'PLATFORM_KILL_SWITCH_CHANGED', 'PlatformKillSwitch', key, before ?? { engaged: false }, after, input.reason, { effect: KILL_SWITCH_DESCRIPTIONS[key].effect });
      return after;
    });
    this.control.invalidate();
    return { key, ...KILL_SWITCH_DESCRIPTIONS[key], engaged: result.engaged, reason: result.reason, changedAt: result.changedAt?.toISOString() ?? null, version: result.version };
  }

  // ── Connector-Lifecycle (Overlay auf dem einen Katalog) ────────────────────────────────────────────────────────────

  async listConnectors() {
    const rows = await this.prisma.withPlatformScope((tx) => tx.platformConnectorDefinition.findMany());
    const usage = await this.connectionUsage();
    return CONNECTOR_REGISTRY.map((meta) => {
      const row = rows.find((r) => r.connectorKey === meta.id);
      return {
        connectorKey: meta.id,
        name: meta.name,
        provider: meta.provider,
        category: meta.category,
        catalogueVersion: meta.version,
        authMethods: [meta.authentication.type],
        capabilityKeys: meta.capabilities,
        scopes: meta.scopes,
        lifecycle: row?.lifecycle ?? 'ACTIVE',
        reason: row?.reason ?? null,
        version: row?.version ?? 0,
        activeConnections: usage.get(meta.id)?.connections ?? 0,
        tenantsAffected: usage.get(meta.id)?.tenants ?? 0,
      };
    });
  }

  /** Wirkungsvorschau einer Sperre (Amendment 03 §26.1): „Sperren betrifft N aktive Verbindungen bei M Mandanten“. */
  async connectorImpact(connectorKey: string) {
    const meta = CONNECTOR_REGISTRY.find((c) => c.id === connectorKey);
    if (!meta) throw new NotFoundError('Connector nicht im Katalog.');
    const usage = (await this.connectionUsage()).get(connectorKey) ?? { connections: 0, tenants: 0 };
    return { connectorKey, activeConnections: usage.connections, tenantsAffected: usage.tenants, effect: 'Keine neuen Verbindungen, keine neuen Aktionen über diesen Connector; bestehende Verbindungen und die Historie bleiben erhalten; Vorgänge warten mit verständlichem Status.' };
  }

  async setConnectorLifecycle(actor: PlatformPrincipal, connectorKey: string, input: { to: PlatformConnectorLifecycle; reason: string; expectedVersion: number }) {
    if (!CONNECTOR_REGISTRY.some((c) => c.id === connectorKey)) throw new NotFoundError('Connector nicht im Katalog.');
    const result = await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.platformConnectorDefinition.findUnique({ where: { connectorKey } });
      if (!before) {
        if (input.expectedVersion !== 0) throw new ConflictException('Der Connector wurde zwischenzeitlich geändert. Bitte neu laden.');
        await tx.platformConnectorDefinition.create({ data: { connectorKey, lifecycle: input.to, reason: input.reason, changedByUserId: actor.userId } });
      } else {
        const updated = await tx.platformConnectorDefinition.updateMany({ where: { connectorKey, version: input.expectedVersion }, data: { lifecycle: input.to, reason: input.reason, changedByUserId: actor.userId, version: { increment: 1 } } });
        if (updated.count !== 1) throw new ConflictException('Der Connector wurde zwischenzeitlich geändert. Bitte neu laden.');
      }
      const after = await tx.platformConnectorDefinition.findUniqueOrThrow({ where: { connectorKey } });
      await this.record(tx, actor, 'PLATFORM_CONNECTOR_CHANGED', 'PlatformConnectorDefinition', connectorKey, before ?? { lifecycle: 'ACTIVE' }, after, input.reason);
      return after;
    });
    this.control.invalidate();
    return { connectorKey, lifecycle: result.lifecycle, reason: result.reason, version: result.version };
  }

  private async connectionUsage(): Promise<Map<string, { connections: number; tenants: number }>> {
    const rows = await this.prisma.withRlsBypass((tx) => tx.integration.groupBy({ by: ['connectorType', 'tenantId'], where: { status: 'CONNECTED' }, _count: { _all: true } }));
    const map = new Map<string, { connections: number; tenants: number }>();
    for (const row of rows) {
      const entry = map.get(row.connectorType) ?? { connections: 0, tenants: 0 };
      entry.connections += row._count._all;
      entry.tenants += 1;
      map.set(row.connectorType, entry);
    }
    return map;
  }

  // ── Mandantenlebenszyklus ──────────────────────────────────────────────────────────────────────────────────────────

  async previewTenantLifecycle(tenantId: string, input: { status?: string; suspensionScopes?: string[]; featureCohorts?: string[] }): Promise<TenantLifecyclePreview> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundError('Mandant nicht gefunden.');
    const target = this.validateTarget(tenant, input);
    const activeUsers = await this.prisma.withRlsBypass((tx) => tx.user.count({ where: { tenantId, status: 'ACTIVE' } }));
    const effects = describeTenantTarget({ status: target.status, scopes: target.suspensionScopes, cohorts: target.featureCohorts }, activeUsers);
    return {
      tenantId,
      current: { status: tenant.status, suspensionScopes: tenant.suspensionScopes, featureCohorts: tenant.featureCohorts },
      target,
      effects,
      activeUsers,
      confirmationToken: confirmationTokenFor(tenantId, { status: target.status, scopes: target.suspensionScopes, cohorts: target.featureCohorts }, effects),
    };
  }

  async applyTenantLifecycle(actor: PlatformPrincipal, tenantId: string, input: { status?: string; suspensionScopes?: string[]; featureCohorts?: string[]; reason: string; confirmationToken: string }) {
    const preview = await this.previewTenantLifecycle(tenantId, input);
    if (preview.confirmationToken !== input.confirmationToken) {
      throw new ValidationFailedError('Die Bestätigung passt nicht zur aktuellen Wirkungsvorschau. Bitte die Vorschau erneut abrufen und genau diese Wirkung bestätigen.', { effects: preview.effects });
    }
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { status: preview.target.status as never, suspensionScopes: preview.target.suspensionScopes, featureCohorts: preview.target.featureCohorts, lifecycleNote: input.reason } });
    await this.audit.record({ eventType: 'PLATFORM_TENANT_LIFECYCLE_CHANGED', actor: actorOf(actor), targetType: 'Tenant', targetId: tenantId, targetTenantId: tenantId, reason: input.reason, before: preview.current, after: preview.target, extra: { effects: preview.effects } });
    this.control.invalidate();
    return preview;
  }

  private validateTarget(current: { status: string; suspensionScopes: string[]; featureCohorts: string[] }, input: { status?: string; suspensionScopes?: string[]; featureCohorts?: string[] }) {
    const status = input.status ?? current.status;
    if (!(TENANT_LIFECYCLE_STATUSES as readonly string[]).includes(status)) throw new ValidationFailedError('Unbekannter Mandantenstatus.', { status });
    const scopes = [...new Set(input.suspensionScopes ?? current.suspensionScopes)];
    const unknown = scopes.filter((s) => !(TENANT_SUSPENSION_SCOPES as readonly string[]).includes(s));
    if (unknown.length > 0) throw new ValidationFailedError('Unbekannte Sperrart.', { unknown });
    const cohorts = [...new Set((input.featureCohorts ?? current.featureCohorts).map((c) => c.trim()).filter(Boolean))];
    if (cohorts.some((c) => !/^[a-z][a-z0-9_-]{1,40}$/.test(c))) throw new ValidationFailedError('Kohortennamen bestehen aus Kleinbuchstaben, Ziffern, _ und -.');
    return { status, suspensionScopes: scopes, featureCohorts: cohorts };
  }

  private async record(tx: Tx, actor: PlatformPrincipal, eventType: PlatformAuditEventType, targetType: string, targetId: string, before: unknown, after: unknown, reason: string, extra?: Record<string, unknown>): Promise<void> {
    await this.audit.record({ eventType, actor: actorOf(actor), targetType, targetId, reason, before, after, extra }, tx);
  }
}
