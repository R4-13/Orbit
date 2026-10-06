import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import type { AIFallbackMode, AIModelDefinition, AIModelProfile, AIProviderDefinition, AIProviderRoute, PlatformAIConnection, Prisma } from '@orbit/domain';
import {
  DEFAULT_PROFILE_DEFINITIONS,
  NotFoundError,
  ValidationFailedError,
  checkRouteActivation,
  describeAiReason,
  effectiveHealth,
  type HealthState,
  type PlatformPrincipal,
  type PlatformAuditEventType,
} from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from '../platform/audit/platform-audit.service';
import { AiAdapterRegistry } from './ai-adapter-registry.service';
import { AiRegistryService } from './ai-registry.service';
import { PlatformSecretVaultService } from './platform-secret-vault.service';

type Tx = Prisma.TransactionClient;

export interface RouteActivationPreview {
  routeId: string;
  activatable: boolean;
  issues: Array<{ code: string; message: string }>;
  /** Wie viele Mandanten die Änderung betrifft (global: alle aktiven Mandanten, sonst 1). */
  affectedTenants: number;
  replaces?: { routeId: string; primaryModelId: string };
}

/** Modell mit Kosten als Zahl (Prisma liefert `Decimal`; die API und das Audit sprechen JSON-Zahlen). */
export type AiModelView = Omit<AIModelDefinition, 'costInputPerMtok' | 'costOutputPerMtok'> & { costInputPerMtok: number | null; costOutputPerMtok: number | null };

export function toModelView(model: AIModelDefinition): AiModelView {
  return { ...model, costInputPerMtok: model.costInputPerMtok === null ? null : Number(model.costInputPerMtok), costOutputPerMtok: model.costOutputPerMtok === null ? null : Number(model.costOutputPerMtok) };
}

const actorOf = (principal: PlatformPrincipal) => ({ userId: principal.userId, roles: principal.platformRoles });

/**
 * Schreibpfad der AI-Plattformregister (Amendment 03 §8–§12). Jede Änderung ist versioniert (optimistisches Sperren, OPS-28), auditiert mit
 * Vorher/Nachher (OAS-01) und nutzt – wo es Regeln gibt – die reine Entscheidungslogik aus `@orbit/shared` (z. B. `checkRouteActivation`).
 * Secrets verlassen diesen Pfad nie: sie gehen in den Plattform-Tresor und werden nur als Referenz/Status wieder angezeigt.
 */
@Injectable()
export class AiRegistryAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly vault: PlatformSecretVaultService,
    private readonly adapters: AiAdapterRegistry,
    private readonly registry: AiRegistryService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  // ── Anbieter ───────────────────────────────────────────────────────────────────────────────────────────────────────

  async listProviders(): Promise<AIProviderDefinition[]> {
    return this.prisma.withPlatformScope((tx) => tx.aIProviderDefinition.findMany({ orderBy: { providerKey: 'asc' } }));
  }

  async createProvider(actor: PlatformPrincipal, input: { providerKey: string; displayName: string; adapterKey: string; supportedRegions?: string[]; supportedCapabilities?: string[]; supportedCredentialTypes?: string[]; dataPolicyRefs?: string[] }): Promise<AIProviderDefinition> {
    if (!this.adapters.has(input.adapterKey)) throw new ValidationFailedError('Für diesen Adapter-Schlüssel ist im Code kein Adapter registriert.', { adapterKey: input.adapterKey, available: this.adapters.keys() });
    try {
      return await this.prisma.withPlatformScope(async (tx) => {
        const created = await tx.aIProviderDefinition.create({
          data: { providerKey: input.providerKey, displayName: input.displayName, adapterKey: input.adapterKey, supportedRegions: input.supportedRegions ?? [], supportedCapabilities: input.supportedCapabilities ?? [], supportedCredentialTypes: input.supportedCredentialTypes ?? ['API_KEY'], dataPolicyRefs: input.dataPolicyRefs ?? [] },
        });
        await this.auditChange(tx, actor, 'PLATFORM_AI_PROVIDER_CHANGED', 'AIProviderDefinition', created.providerKey, null, created);
        return created;
      });
    } catch (error) {
      throw this.mapUnique(error, 'Dieser Anbieter existiert bereits.');
    }
  }

  async transitionProvider(actor: PlatformPrincipal, providerKey: string, input: { to: AIProviderDefinition['lifecycle']; expectedVersion: number; reason: string }): Promise<AIProviderDefinition> {
    return this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.aIProviderDefinition.findUnique({ where: { providerKey } });
      if (!before) throw new NotFoundError('Anbieter nicht gefunden.');
      const updated = await tx.aIProviderDefinition.updateMany({ where: { providerKey, version: input.expectedVersion }, data: { lifecycle: input.to, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Der Anbieter wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.aIProviderDefinition.findUniqueOrThrow({ where: { providerKey } });
      await this.auditChange(tx, actor, 'PLATFORM_AI_PROVIDER_CHANGED', 'AIProviderDefinition', providerKey, before, after, input.reason);
      return after;
    });
  }

  // ── Modelle ────────────────────────────────────────────────────────────────────────────────────────────────────────

  async listModels(providerKey?: string): Promise<AiModelView[]> {
    const rows = await this.prisma.withPlatformScope((tx) => tx.aIModelDefinition.findMany({ where: providerKey ? { providerKey } : undefined, orderBy: [{ providerKey: 'asc' }, { providerModelId: 'asc' }] }));
    return rows.map(toModelView);
  }

  async createModel(
    actor: PlatformPrincipal,
    input: { providerKey: string; providerModelId: string; displayName: string; capabilityTags?: string[]; contextLimit?: number; toolUseSupported?: boolean; structuredOutputSupported?: boolean; regionAvailability?: string[]; dataPolicyRefs?: string[]; costInputPerMtok?: number; costOutputPerMtok?: number; costCurrency?: string },
  ): Promise<AiModelView> {
    try {
      return await this.prisma.withPlatformScope(async (tx) => {
        if (!(await tx.aIProviderDefinition.findUnique({ where: { providerKey: input.providerKey } }))) throw new NotFoundError('Anbieter nicht gefunden.');
        const created = await tx.aIModelDefinition.create({
          data: {
            providerKey: input.providerKey,
            providerModelId: input.providerModelId,
            displayName: input.displayName,
            capabilityTags: input.capabilityTags ?? ['chat'],
            contextLimit: input.contextLimit,
            toolUseSupported: input.toolUseSupported ?? false,
            structuredOutputSupported: input.structuredOutputSupported ?? false,
            regionAvailability: input.regionAvailability ?? [],
            dataPolicyRefs: input.dataPolicyRefs ?? [],
            costInputPerMtok: input.costInputPerMtok,
            costOutputPerMtok: input.costOutputPerMtok,
            costCurrency: input.costCurrency ?? 'EUR',
          },
        });
        await this.auditChange(tx, actor, 'PLATFORM_AI_MODEL_CHANGED', 'AIModelDefinition', created.id, null, toModelView(created));
        return toModelView(created);
      });
    } catch (error) {
      throw this.mapUnique(error, 'Dieses Modell existiert für den Anbieter bereits.');
    }
  }

  async recordEvaluation(actor: PlatformPrincipal, modelId: string, input: { result: 'PASSED' | 'FAILED'; expectedVersion: number; note: string }): Promise<AiModelView> {
    return this.mutateModel(actor, modelId, input.expectedVersion, { evaluationStatus: input.result }, input.note);
  }

  /** Freigabe verlangt eine bestandene Evaluation (Amendment 03 §8.5); Sperren/Veralten ist jederzeit möglich. */
  async transitionModel(actor: PlatformPrincipal, modelId: string, input: { to: AIModelDefinition['lifecycle']; expectedVersion: number; reason: string }): Promise<AiModelView> {
    const current = await this.prisma.withPlatformScope((tx) => tx.aIModelDefinition.findUnique({ where: { id: modelId } }));
    if (!current) throw new NotFoundError('Modell nicht gefunden.');
    if (input.to === 'APPROVED' && current.evaluationStatus !== 'PASSED') throw new ValidationFailedError('Ein Modell kann erst nach bestandener Evaluation freigegeben werden.', { evaluationStatus: current.evaluationStatus });
    const now = new Date();
    return this.mutateModel(actor, modelId, input.expectedVersion, { lifecycle: input.to, ...(input.to === 'APPROVED' ? { approvedAt: now } : {}), ...(input.to === 'DEPRECATED' || input.to === 'RETIRED' || input.to === 'BLOCKED' ? { deprecatedAt: now } : {}) }, input.reason);
  }

  private async mutateModel(actor: PlatformPrincipal, modelId: string, expectedVersion: number, data: Prisma.AIModelDefinitionUpdateManyMutationInput, reason: string): Promise<AiModelView> {
    return this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.aIModelDefinition.findUnique({ where: { id: modelId } });
      if (!before) throw new NotFoundError('Modell nicht gefunden.');
      const updated = await tx.aIModelDefinition.updateMany({ where: { id: modelId, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Das Modell wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.aIModelDefinition.findUniqueOrThrow({ where: { id: modelId } });
      await this.auditChange(tx, actor, 'PLATFORM_AI_MODEL_CHANGED', 'AIModelDefinition', modelId, toModelView(before), toModelView(after), reason);
      return toModelView(after);
    });
  }

  // ── Profile ────────────────────────────────────────────────────────────────────────────────────────────────────────

  async listProfiles(): Promise<AIModelProfile[]> {
    return this.prisma.withPlatformScope((tx) => tx.aIModelProfile.findMany({ orderBy: [{ profileKey: 'asc' }, { version: 'desc' }] }));
  }

  /** Neue Entwurfsversion (nächste Versionsnummer). Veröffentlichte Versionen werden nie geändert (DB-Trigger). */
  async createProfileDraft(actor: PlatformPrincipal, input: { profileKey: string; purpose: string; requiredCapabilities: string[]; fallbackMode?: AIFallbackMode; maxLatencyMs?: number; requiredDataPolicyRefs?: string[] }): Promise<AIModelProfile> {
    return this.prisma.withPlatformScope(async (tx) => {
      const latest = await tx.aIModelProfile.findFirst({ where: { profileKey: input.profileKey }, orderBy: { version: 'desc' } });
      const created = await tx.aIModelProfile.create({
        data: { profileKey: input.profileKey, version: (latest?.version ?? 0) + 1, purpose: input.purpose, requiredCapabilities: input.requiredCapabilities, fallbackMode: input.fallbackMode ?? 'NO_FALLBACK', maxLatencyMs: input.maxLatencyMs, requiredDataPolicyRefs: input.requiredDataPolicyRefs ?? [], createdByUserId: actor.userId },
      });
      await this.auditChange(tx, actor, 'PLATFORM_AI_PROFILE_PUBLISHED', 'AIModelProfile', created.id, null, created, 'Entwurf angelegt');
      return created;
    });
  }

  async publishProfile(actor: PlatformPrincipal, profileKey: string, version: number, reason: string): Promise<AIModelProfile> {
    return this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.aIModelProfile.findUnique({ where: { profileKey_version: { profileKey, version } } });
      if (!before) throw new NotFoundError('Profilversion nicht gefunden.');
      if (before.lifecycle === 'PUBLISHED' || before.lifecycle === 'DEPRECATED') throw new ConflictException('Diese Profilversion ist bereits veröffentlicht und unveränderlich.');
      const after = await tx.aIModelProfile.update({ where: { id: before.id }, data: { lifecycle: 'PUBLISHED', publishedAt: new Date() } });
      await this.auditChange(tx, actor, 'PLATFORM_AI_PROFILE_PUBLISHED', 'AIModelProfile', after.id, before, after, reason);
      return after;
    });
  }

  // ── Routen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  async listRoutes(): Promise<AIProviderRoute[]> {
    return this.prisma.withPlatformScope((tx) => tx.aIProviderRoute.findMany({ orderBy: [{ modelProfileKey: 'asc' }, { createdAt: 'desc' }] }));
  }

  async createRoute(
    actor: PlatformPrincipal,
    input: { modelProfileKey: string; environment: string; tenantScope?: string; primaryModelId: string; fallbackModelIds?: string[]; fallbackMode?: AIFallbackMode; trafficPercent?: number; activeFrom?: Date; activeUntil?: Date },
  ): Promise<AIProviderRoute> {
    return this.prisma.withPlatformScope(async (tx) => {
      if (!(await tx.aIModelDefinition.findUnique({ where: { id: input.primaryModelId } }))) throw new NotFoundError('Primäres Modell nicht gefunden.');
      const created = await tx.aIProviderRoute.create({
        data: { modelProfileKey: input.modelProfileKey, environment: input.environment, tenantScope: input.tenantScope ?? null, primaryModelId: input.primaryModelId, fallbackModelIds: input.fallbackModelIds ?? [], fallbackMode: input.fallbackMode ?? 'NO_FALLBACK', trafficPercent: input.trafficPercent ?? 100, activeFrom: input.activeFrom, activeUntil: input.activeUntil, createdByUserId: actor.userId },
      });
      await this.auditChange(tx, actor, 'PLATFORM_AI_ROUTE_CHANGED', 'AIProviderRoute', created.id, null, created, 'Route angelegt (inaktiv)');
      return created;
    });
  }

  /** Vorschau (Amendment 03 §26.1): Vorbedingungen, betroffene Mandanten, ersetzte Route – ohne etwas zu ändern. */
  async previewActivation(routeId: string): Promise<RouteActivationPreview> {
    return this.prisma.withPlatformScope((tx) => this.previewIn(tx, routeId));
  }

  private async previewIn(tx: Tx, routeId: string): Promise<RouteActivationPreview> {
    const route = await tx.aIProviderRoute.findUnique({ where: { id: routeId } });
    if (!route) throw new NotFoundError('Route nicht gefunden.');
    const profile = await tx.aIModelProfile.findFirst({ where: { profileKey: route.modelProfileKey, lifecycle: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    const ids = [route.primaryModelId, ...route.fallbackModelIds];
    const models = await tx.aIModelDefinition.findMany({ where: { id: { in: ids } }, include: { provider: true } });
    const byId = new Map(models.map((m) => [m.id, m]));
    const connections = await tx.platformAIConnection.findMany({ where: { providerKey: { in: [...new Set(models.map((m) => m.providerKey))] }, environment: route.environment } });
    const healthRows = await tx.aIProviderHealth.findMany({ where: { providerKey: { in: [...new Set(models.map((m) => m.providerKey))] }, environment: route.environment } });
    const entry = (id: string) => {
      const model = byId.get(id);
      if (!model) return null;
      const health = healthRows.find((h) => h.providerKey === model.providerKey && h.modelRef === '*');
      const state: HealthState | null = health ? { status: health.status, consecutiveFailures: health.consecutiveFailures, lastFailureAt: health.lastFailureAt } : null;
      return { model, provider: model.provider, connection: connections.find((c) => c.providerKey === model.providerKey) ?? null, health: { status: effectiveHealth(state, new Date()) === 'UNKNOWN' ? ('UP' as const) : effectiveHealth(state, new Date()) } };
    };
    const issues = checkRouteActivation({
      profile: profile ? { key: profile.profileKey, lifecycle: profile.lifecycle, fallbackMode: profile.fallbackMode, requiredCapabilities: profile.requiredCapabilities, requiredDataPolicyRefs: profile.requiredDataPolicyRefs } : null,
      route: { fallbackMode: route.fallbackMode, primaryModelId: route.primaryModelId, fallbackModelIds: route.fallbackModelIds, environment: route.environment, trafficPercent: route.trafficPercent },
      primary: entry(route.primaryModelId),
      fallbacks: route.fallbackModelIds.map(entry).filter((e): e is NonNullable<ReturnType<typeof entry>> => e !== null),
      tenantRegion: this.registry.tenantRegion(route.tenantScope ?? ''),
    });
    const current = await tx.aIProviderRoute.findFirst({ where: { modelProfileKey: route.modelProfileKey, environment: route.environment, tenantScope: route.tenantScope, active: true, id: { not: route.id } } });
    const affectedTenants = route.tenantScope ? 1 : await this.countTenants();
    return {
      routeId,
      activatable: issues.length === 0,
      issues: issues.map((code) => ({ code, message: describeAiReason(code) })),
      affectedTenants,
      replaces: current ? { routeId: current.id, primaryModelId: current.primaryModelId } : undefined,
    };
  }

  private async countTenants(): Promise<number> {
    return this.prisma.withRlsBypass((tx) => tx.tenant.count({ where: { status: 'ACTIVE' } }));
  }

  /** Aktiviert eine Route atomar: Vorbedingungen prüfen, vorherige aktive Route desselben Scopes ablösen, Version prüfen, auditieren. */
  async activateRoute(actor: PlatformPrincipal, routeId: string, input: { expectedVersion: number; reason: string }): Promise<{ route: AIProviderRoute; preview: RouteActivationPreview }> {
    return this.prisma.withPlatformScope(async (tx) => {
      const preview = await this.previewIn(tx, routeId);
      if (!preview.activatable) throw new ValidationFailedError('Die Route kann nicht aktiviert werden.', { issues: preview.issues });
      const before = await tx.aIProviderRoute.findUniqueOrThrow({ where: { id: routeId } });
      const replaced = await tx.aIProviderRoute.findFirst({ where: { modelProfileKey: before.modelProfileKey, environment: before.environment, tenantScope: before.tenantScope, active: true, id: { not: routeId } } });
      if (replaced) {
        await tx.aIProviderRoute.update({ where: { id: replaced.id }, data: { active: false, version: { increment: 1 } } });
        await this.auditChange(tx, actor, 'PLATFORM_AI_ROUTE_CHANGED', 'AIProviderRoute', replaced.id, replaced, { ...replaced, active: false }, `abgelöst durch ${routeId}`);
      }
      const updated = await tx.aIProviderRoute.updateMany({ where: { id: routeId, version: input.expectedVersion }, data: { active: true, version: { increment: 1 }, policyVersion: String(Number(before.policyVersion) + 1) } });
      if (updated.count !== 1) throw new ConflictException('Die Route wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.aIProviderRoute.findUniqueOrThrow({ where: { id: routeId } });
      await this.auditChange(tx, actor, 'PLATFORM_AI_ROUTE_CHANGED', 'AIProviderRoute', routeId, before, after, input.reason, { affectedTenants: preview.affectedTenants, replaced: replaced?.id ?? null });
      return { route: after, preview };
    });
  }

  async deactivateRoute(actor: PlatformPrincipal, routeId: string, input: { expectedVersion: number; reason: string }): Promise<AIProviderRoute> {
    return this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.aIProviderRoute.findUnique({ where: { id: routeId } });
      if (!before) throw new NotFoundError('Route nicht gefunden.');
      const updated = await tx.aIProviderRoute.updateMany({ where: { id: routeId, version: input.expectedVersion }, data: { active: false, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Die Route wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.aIProviderRoute.findUniqueOrThrow({ where: { id: routeId } });
      await this.auditChange(tx, actor, 'PLATFORM_AI_ROUTE_CHANGED', 'AIProviderRoute', routeId, before, after, input.reason);
      return after;
    });
  }

  // ── Plattformverbindungen ──────────────────────────────────────────────────────────────────────────────────────────

  async listConnections(): Promise<Array<PlatformAIConnection & { secret: Awaited<ReturnType<PlatformSecretVaultService['describe']>> }>> {
    const rows = await this.prisma.withPlatformScope((tx) => tx.platformAIConnection.findMany({ orderBy: [{ providerKey: 'asc' }, { environment: 'asc' }] }));
    // Das Secret selbst wird nie ausgegeben – nur Referenzart, Konfiguriert-Status, Version, Änderungszeit.
    return Promise.all(rows.map(async (row) => ({ ...row, secretRef: this.maskReference(row.secretRef), secret: await this.vault.describe(row.secretRef) })));
  }

  async createConnection(actor: PlatformPrincipal, input: { providerKey: string; environment: string; regionKey?: string; secretValue?: string; secretRef?: string; allowedProfileKeys?: string[] }): Promise<PlatformAIConnection> {
    if (!input.secretValue && !input.secretRef) throw new ValidationFailedError('Ein Secret oder eine Secret-Referenz (env:NAME) ist erforderlich.');
    if (input.secretValue && input.secretRef) throw new ValidationFailedError('Entweder ein Secret ODER eine Referenz angeben, nicht beides.');
    if (input.secretRef && !/^env:[A-Z][A-Z0-9_]{2,}$/.test(input.secretRef)) throw new ValidationFailedError('Zulässig ist nur eine Referenz der Form env:NAME.');
    const secretRef = input.secretRef ?? (await this.vault.store({ apiKey: input.secretValue }, actor.userId));
    try {
      return await this.prisma.withPlatformScope(async (tx) => {
        if (!(await tx.aIProviderDefinition.findUnique({ where: { providerKey: input.providerKey } }))) throw new NotFoundError('Anbieter nicht gefunden.');
        const created = await tx.platformAIConnection.create({ data: { providerKey: input.providerKey, environment: input.environment, regionKey: input.regionKey, secretRef, allowedProfileKeys: input.allowedProfileKeys ?? [], createdByUserId: actor.userId, updatedByUserId: actor.userId } });
        await this.auditChange(tx, actor, 'PLATFORM_SECRET_CHANGED', 'PlatformAIConnection', created.id, null, { ...created, secretRef: this.maskReference(created.secretRef) }, 'Plattformverbindung angelegt');
        return { ...created, secretRef: this.maskReference(created.secretRef) };
      });
    } catch (error) {
      throw this.mapUnique(error, 'Für diesen Anbieter existiert in dieser Umgebung bereits eine Plattformverbindung.');
    }
  }

  /** Rotation ohne Businesscode-Änderung: neues Secret ablegen, optional sofort validieren; Referenz bleibt gleich. */
  async rotateConnectionSecret(actor: PlatformPrincipal, connectionId: string, input: { secretValue: string; expectedVersion: number; reason: string }): Promise<PlatformAIConnection> {
    const connection = await this.prisma.withPlatformScope((tx) => tx.platformAIConnection.findUnique({ where: { id: connectionId } }));
    if (!connection) throw new NotFoundError('Plattformverbindung nicht gefunden.');
    if (connection.version !== input.expectedVersion) throw new ConflictException('Die Verbindung wurde zwischenzeitlich geändert. Bitte neu laden.');
    if (connection.secretRef.startsWith('env:')) throw new ValidationFailedError('Eine env:-Referenz wird per Deployment rotiert, nicht über die Plattform.');
    const secretVersion = await this.vault.rotate(connection.secretRef, { apiKey: input.secretValue });
    return this.prisma.withPlatformScope(async (tx) => {
      const updated = await tx.platformAIConnection.updateMany({ where: { id: connectionId, version: input.expectedVersion }, data: { version: { increment: 1 }, updatedByUserId: actor.userId, lastValidatedAt: null, lifecycle: 'CONFIGURING' } });
      if (updated.count !== 1) throw new ConflictException('Die Verbindung wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.platformAIConnection.findUniqueOrThrow({ where: { id: connectionId } });
      await this.auditChange(tx, actor, 'PLATFORM_SECRET_CHANGED', 'PlatformAIConnection', connectionId, { version: connection.version, secretVersion: secretVersion - 1 }, { version: after.version, secretVersion }, input.reason);
      return { ...after, secretRef: this.maskReference(after.secretRef) };
    });
  }

  /** Echte Prüfung gegen den Anbieter (1-Token-Aufruf). Erst eine bestandene Prüfung macht die Verbindung ACTIVE. */
  async validateConnection(actor: PlatformPrincipal, connectionId: string): Promise<{ connection: PlatformAIConnection; valid: boolean; detail?: string }> {
    const row = await this.prisma.withPlatformScope((tx) => tx.platformAIConnection.findUnique({ where: { id: connectionId }, include: { provider: { include: { models: { where: { lifecycle: { in: ['APPROVED', 'VALIDATING'] } }, take: 1 } } } } }));
    if (!row) throw new NotFoundError('Plattformverbindung nicht gefunden.');
    const model = row.provider.models[0];
    let valid = false;
    let detail: string | undefined;
    if (!model) detail = 'Für diesen Anbieter ist noch kein Modell registriert, gegen das geprüft werden könnte.';
    else {
      try {
        const secret = await this.vault.read(row.secretRef);
        const adapter = this.adapters.build(row.provider.adapterKey, { apiKey: String(secret.apiKey ?? ''), providerModelId: model.providerModelId });
        const result = (await adapter.validateConfiguration?.()) ?? { valid: true };
        valid = result.valid;
        detail = result.valid ? undefined : 'Der Anbieter hat die Zugangsdaten abgelehnt oder war nicht erreichbar.';
      } catch {
        detail = 'Die Prüfung konnte nicht durchgeführt werden.';
      }
    }
    const connection = await this.prisma.withPlatformScope(async (tx) => {
      const after = await tx.platformAIConnection.update({
        where: { id: connectionId },
        data: { lastValidatedAt: new Date(), lastHealthStatus: valid ? 'OK' : 'FAILED', lifecycle: valid ? (row.lifecycle === 'CONFIGURING' || row.lifecycle === 'DEGRADED' ? 'ACTIVE' : row.lifecycle) : row.lifecycle === 'ACTIVE' ? 'DEGRADED' : row.lifecycle, updatedByUserId: actor.userId },
      });
      await this.auditChange(tx, actor, 'PLATFORM_AI_PROVIDER_CHANGED', 'PlatformAIConnection', connectionId, { lifecycle: row.lifecycle }, { lifecycle: after.lifecycle, valid }, 'Verbindung geprüft');
      return after;
    });
    return { connection: { ...connection, secretRef: this.maskReference(connection.secretRef) }, valid, detail };
  }

  async setConnectionLifecycle(actor: PlatformPrincipal, connectionId: string, input: { to: PlatformAIConnection['lifecycle']; expectedVersion: number; reason: string }): Promise<PlatformAIConnection> {
    return this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.platformAIConnection.findUnique({ where: { id: connectionId } });
      if (!before) throw new NotFoundError('Plattformverbindung nicht gefunden.');
      const updated = await tx.platformAIConnection.updateMany({ where: { id: connectionId, version: input.expectedVersion }, data: { lifecycle: input.to, version: { increment: 1 }, updatedByUserId: actor.userId } });
      if (updated.count !== 1) throw new ConflictException('Die Verbindung wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.platformAIConnection.findUniqueOrThrow({ where: { id: connectionId } });
      await this.auditChange(tx, actor, 'PLATFORM_AI_PROVIDER_CHANGED', 'PlatformAIConnection', connectionId, { lifecycle: before.lifecycle }, { lifecycle: after.lifecycle }, input.reason);
      return { ...after, secretRef: this.maskReference(after.secretRef) };
    });
  }

  // ── Health / Nutzung ───────────────────────────────────────────────────────────────────────────────────────────────

  async listHealth() {
    return this.prisma.withPlatformScope((tx) => tx.aIProviderHealth.findMany({ orderBy: [{ providerKey: 'asc' }, { modelRef: 'asc' }] }));
  }

  /** Anbieter ausdrücklich deaktivieren/freigeben (Notbremse, auditiert). DISABLED sperrt das Routing, bis es aufgehoben wird. */
  async setProviderDisabled(actor: PlatformPrincipal, providerKey: string, disabled: boolean, reason: string): Promise<void> {
    const environment = this.env.ORBIT_ENVIRONMENT;
    await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.aIProviderHealth.findUnique({ where: { providerKey_modelRef_environment: { providerKey, modelRef: '*', environment } } });
      const status = disabled ? 'DISABLED' : 'UNKNOWN';
      await tx.aIProviderHealth.upsert({ where: { providerKey_modelRef_environment: { providerKey, modelRef: '*', environment } }, create: { providerKey, modelRef: '*', environment, status, consecutiveFailures: 0 }, update: { status, consecutiveFailures: 0 } });
      await this.auditChange(tx, actor, 'PLATFORM_AI_PROVIDER_CHANGED', 'AIProviderHealth', `${providerKey}|*|${environment}`, { status: before?.status ?? 'UNKNOWN' }, { status }, reason);
    });
  }

  async usageSummary(input: { from: Date; to: Date; groupBy: 'profileKey' | 'providerKey' | 'tenantId' | 'modelId' }) {
    const rows = await this.prisma.withPlatformScope((tx) =>
      tx.aIUsageRecord.groupBy({
        by: [input.groupBy],
        where: { createdAt: { gte: input.from, lt: input.to } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, estimatedCost: true },
        _avg: { latencyMs: true },
      }),
    );
    return rows.map((row) => ({
      key: (row as Record<string, unknown>)[input.groupBy] as string,
      requests: row._count._all,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
      estimatedCost: row._sum.estimatedCost === null ? null : Number(row._sum.estimatedCost),
      avgLatencyMs: row._avg.latencyMs === null ? null : Math.round(row._avg.latencyMs),
    }));
  }

  // ── Bootstrap aus der Umgebung ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Legt – idempotent – das Register für den aktuell per Umgebung konfigurierten Anbieter an (Anbieter, Modell, sechs Standardprofile v1 veröffentlicht,
   * Verbindung als env:-Referenz, je Profil eine Route). Das ist ein bewusster Einstieg, kein Verstecken: alles ist danach im Register sichtbar,
   * versioniert, und die Evaluation des Modells bleibt „NONE“, bis jemand sie belegt (die Aktivierung der Routen erfordert PASSED – daher werden die Routen
   * hier angelegt, aber NICHT aktiviert, sofern die Evaluation nicht belegt ist).
   */
  async bootstrapFromEnvironment(actor: PlatformPrincipal): Promise<{ provider?: string; model?: string; profilesCreated: number; routesCreated: number; note: string }> {
    const llm = this.env.LLM_PROVIDER;
    if (llm === 'mock') return { profilesCreated: 0, routesCreated: 0, note: 'Mit LLM_PROVIDER=mock gibt es nichts zu übernehmen.' };
    const providerKey = llm;
    const modelId = llm === 'anthropic' ? this.env.ANTHROPIC_MODEL : this.env.OPENAI_MODEL;
    const secretRef = llm === 'anthropic' ? 'env:ANTHROPIC_API_KEY' : 'env:OPENAI_API_KEY';
    let profilesCreated = 0;
    let routesCreated = 0;
    await this.prisma.withPlatformScope(async (tx) => {
      const provider = (await tx.aIProviderDefinition.findUnique({ where: { providerKey } })) ?? (await tx.aIProviderDefinition.create({ data: { providerKey, displayName: providerKey === 'anthropic' ? 'Anthropic' : 'OpenAI', adapterKey: providerKey, lifecycle: 'ACTIVE', supportedCredentialTypes: ['API_KEY'], supportedRegions: [], supportedCapabilities: ['chat', 'tool_use', 'structured_output'] } }));
      const model = (await tx.aIModelDefinition.findUnique({ where: { providerKey_providerModelId: { providerKey, providerModelId: modelId } } })) ?? (await tx.aIModelDefinition.create({ data: { providerKey, providerModelId: modelId, displayName: modelId, lifecycle: 'APPROVED', capabilityTags: ['chat'], toolUseSupported: true, structuredOutputSupported: true, approvedAt: new Date() } }));
      if (!(await tx.platformAIConnection.findUnique({ where: { providerKey_environment: { providerKey, environment: this.env.ORBIT_ENVIRONMENT } } }))) {
        await tx.platformAIConnection.create({ data: { providerKey, environment: this.env.ORBIT_ENVIRONMENT, secretRef, lifecycle: 'ACTIVE', createdByUserId: actor.userId, updatedByUserId: actor.userId } });
      }
      for (const def of DEFAULT_PROFILE_DEFINITIONS) {
        if (!(await tx.aIModelProfile.findFirst({ where: { profileKey: def.key } }))) {
          await tx.aIModelProfile.create({ data: { profileKey: def.key, version: 1, purpose: def.purpose, requiredCapabilities: def.requiredCapabilities, fallbackMode: def.fallbackMode, lifecycle: 'PUBLISHED', publishedAt: new Date(), createdByUserId: actor.userId } });
          profilesCreated += 1;
        }
        const existing = await tx.aIProviderRoute.findFirst({ where: { modelProfileKey: def.key, environment: this.env.ORBIT_ENVIRONMENT, tenantScope: null } });
        if (!existing) {
          await tx.aIProviderRoute.create({ data: { modelProfileKey: def.key, environment: this.env.ORBIT_ENVIRONMENT, primaryModelId: model.id, fallbackMode: 'NO_FALLBACK', createdByUserId: actor.userId } });
          routesCreated += 1;
        }
      }
      await this.auditChange(tx, actor, 'PLATFORM_AI_PROVIDER_CHANGED', 'AIProviderDefinition', provider.providerKey, null, { providerKey, modelId, profilesCreated, routesCreated }, 'Register aus der Umgebung übernommen');
    });
    return { provider: providerKey, model: modelId, profilesCreated, routesCreated, note: 'Routen wurden angelegt, aber nicht aktiviert: Zuerst die Evaluation des Modells belegen und freigeben, dann je Profil die Route aktivieren. Bis dahin bedient weiterhin der Umgebungs-Standard.' };
  }

  // ── Hilfen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private maskReference(reference: string): string {
    return reference.startsWith('env:') ? reference : 'vault:••••••••';
  }

  private mapUnique(error: unknown, message: string): unknown {
    return (error as { code?: string }).code === 'P2002' ? new ConflictException(message) : error;
  }

  private async auditChange(tx: Tx, actor: PlatformPrincipal, eventType: PlatformAuditEventType, targetType: string, targetId: string, before: unknown, after: unknown, reason?: string, extra?: Record<string, unknown>): Promise<void> {
    await this.audit.record({ eventType, actor: actorOf(actor), targetType, targetId, reason, before, after, extra }, tx);
  }
}
