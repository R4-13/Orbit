import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { NotFoundError, type AiRuntimeStatus } from '@orbit/shared';
import type { AIProviderConnection, AIProviderKey } from '@orbit/domain';
import { ORBIT_ENV } from '../config/env.token';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';
import { buildProviderAdapter } from './ai-provider-adapter-factory';
import { AiProviderResolverService } from './ai-provider-resolver.service';

export type AiProviderConnectionSummary = Omit<AIProviderConnection, 'encryptedCredentials'> & {
  hasCredentials: boolean;
};

export interface AiProviderStatus {
  /** Configuration kind only — says nothing about whether a model is actually reachable. */
  mode: 'ORBIT_MANAGED' | 'TENANT_MANAGED';
  connection: AiProviderConnectionSummary | null;
  /** What really serves requests right now, and whether that was verified (Amendment 02 §5.3). */
  runtime: AiRuntimeStatus;
}

function toSummary(connection: AIProviderConnection): AiProviderConnectionSummary {
  const { encryptedCredentials, ...rest } = connection;
  return { ...rest, hasCredentials: encryptedCredentials !== null };
}

function defaultModelFor(providerKey: AIProviderKey, env: OrbitEnv): string {
  return providerKey === 'ANTHROPIC' ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL;
}

/**
 * §35-44 des Unified-Evolution-Konzepts — Admin-CRUD für den optionalen,
 * pro Tenant höchstens einen aktiven BYOK-Provider (`AIProviderConnection`,
 * `@@unique(tenantId)`, siehe Schema-Kommentar). Fehlt die Zeile, läuft der
 * Tenant im ORBIT-Managed-Modus (Standard) — siehe `AiProviderResolverService`
 * für die tatsächliche Laufzeit-Auflösung.
 */
@Injectable()
export class AiProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: CredentialEncryptionService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
    private readonly resolver: AiProviderResolverService,
  ) {}

  /** Last on-demand verification of the platform-managed provider per tenant (process-local; BYOK keeps its own persisted test result). */
  private readonly platformVerification = new Map<string, AiRuntimeStatus['health']>();

  async getStatus(tenantId: string): Promise<AiProviderStatus> {
    const connection = await this.prisma.forTenantId(tenantId).aIProviderConnection.findUnique({ where: { tenantId } });
    const runtime = await this.describeRuntime(tenantId, connection);
    if (!connection || connection.status !== 'CONNECTED') {
      return { mode: 'ORBIT_MANAGED', connection: connection ? toSummary(connection) : null, runtime };
    }
    return { mode: 'TENANT_MANAGED', connection: toSummary(connection), runtime };
  }

  /**
   * Really calls the provider that serves this tenant (a 1-token completion for a live provider). A simulated
   * provider is reported as SIMULATED — it can never be "verified", because there is nothing external to verify.
   */
  async verifyRuntime(tenantId: string): Promise<AiRuntimeStatus> {
    const llm = await this.resolver.resolveForTenant(tenantId);
    if (llm.providerName.toLowerCase().includes('mock')) {
      return this.describeRuntime(tenantId, await this.prisma.forTenantId(tenantId).aIProviderConnection.findUnique({ where: { tenantId } }));
    }
    const validation = (await llm.validateConfiguration?.()) ?? { valid: true };
    this.platformVerification.set(tenantId, {
      state: validation.valid ? 'VERIFIED' : 'ERROR',
      checkedAt: new Date().toISOString(),
      detail: validation.valid ? null : (validation.error ?? 'Unbekannter Fehler'),
    });
    return this.describeRuntime(tenantId, await this.prisma.forTenantId(tenantId).aIProviderConnection.findUnique({ where: { tenantId } }));
  }

  private async describeRuntime(tenantId: string, connection: AIProviderConnection | null): Promise<AiRuntimeStatus> {
    const llm = await this.resolver.resolveForTenant(tenantId);
    const simulated = llm.providerName.toLowerCase().includes('mock');
    const base = { provider: llm.providerName, model: llm.modelName ?? null, executionMode: simulated ? ('SIMULATED' as const) : ('LIVE' as const) };
    if (simulated) {
      return { ...base, health: { state: 'SIMULATED', checkedAt: null, detail: 'Es wird kein echtes KI-Modell aufgerufen.' } };
    }
    if (connection?.status === 'CONNECTED') {
      const ok = connection.lastTestStatus === 'OK';
      return {
        ...base,
        health: {
          state: connection.lastTestedAt ? (ok ? 'VERIFIED' : 'ERROR') : 'NOT_VERIFIED',
          checkedAt: connection.lastTestedAt?.toISOString() ?? null,
          detail: ok ? null : (connection.lastTestStatus ?? null),
        },
      };
    }
    return { ...base, health: this.platformVerification.get(tenantId) ?? { state: 'NOT_VERIFIED', checkedAt: null, detail: 'Die Ausführbarkeit wurde noch nicht geprüft.' } };
  }

  /**
   * Stores the credential encrypted and immediately validates it against
   * the real provider (§41: "ORBIT validates and securely stores
   * credential") — a single round trip instead of a separate save-then-test
   * step, since a saved-but-unvalidated BYOK config would otherwise fail
   * silently at the next real agent run instead of at configuration time.
   */
  async upsertConnection(
    tenantId: string,
    actorUserId: string,
    providerKey: AIProviderKey,
    apiKey: string,
    model: string | undefined,
  ): Promise<AiProviderConnectionSummary> {
    const resolvedModel = model ?? defaultModelFor(providerKey, this.env);
    const validation = await buildProviderAdapter(providerKey, apiKey, resolvedModel).validateConfiguration?.();

    const encryptedCredentials = new Uint8Array(this.encryption.encrypt(apiKey));
    const now = new Date();
    const status = validation?.valid === false ? 'ERROR' : 'CONNECTED';

    const updated = await this.prisma.forTenantId(tenantId).aIProviderConnection.upsert({
      where: { tenantId },
      create: {
        tenantId,
        providerKey,
        status,
        encryptedCredentials,
        model: resolvedModel,
        lastTestedAt: now,
        lastTestStatus: validation?.valid === false ? validation.error : 'OK',
        createdByUserId: actorUserId,
      },
      update: {
        providerKey,
        status,
        encryptedCredentials,
        model: resolvedModel,
        lastTestedAt: now,
        lastTestStatus: validation?.valid === false ? validation.error : 'OK',
      },
    });

    if (validation?.valid === false) {
      await this.audit.record({
        tenantId,
        eventType: 'AI_PROVIDER_TEST_FAILED',
        actorType: 'USER',
        actorUserId,
        entityType: 'AIProviderConnection',
        entityId: updated.id,
        payload: { providerKey, error: validation.error },
      });
    } else {
      await this.audit.record({
        tenantId,
        eventType: 'AI_PROVIDER_CONNECTED',
        actorType: 'USER',
        actorUserId,
        entityType: 'AIProviderConnection',
        entityId: updated.id,
        payload: { providerKey, model: resolvedModel },
      });
    }

    return toSummary(updated);
  }

  async testConnection(tenantId: string, actorUserId: string): Promise<AiProviderConnectionSummary> {
    const existing = await this.prisma.forTenantId(tenantId).aIProviderConnection.findUnique({ where: { tenantId } });
    if (!existing || !existing.encryptedCredentials) {
      throw new NotFoundError('No BYOK provider connection configured for this tenant.');
    }

    const apiKey = this.encryption.decrypt(Buffer.from(existing.encryptedCredentials));
    const model = existing.model ?? defaultModelFor(existing.providerKey, this.env);
    const validation = await buildProviderAdapter(existing.providerKey, apiKey, model).validateConfiguration?.();

    const status = validation?.valid === false ? 'ERROR' : 'CONNECTED';
    const updated = await this.prisma.forTenantId(tenantId).aIProviderConnection.update({
      where: { tenantId },
      data: { status, lastTestedAt: new Date(), lastTestStatus: validation?.valid === false ? validation.error : 'OK' },
    });

    if (validation?.valid === false) {
      await this.audit.record({
        tenantId,
        eventType: 'AI_PROVIDER_TEST_FAILED',
        actorType: 'USER',
        actorUserId,
        entityType: 'AIProviderConnection',
        entityId: updated.id,
        payload: { providerKey: existing.providerKey, error: validation.error },
      });
    }

    return toSummary(updated);
  }

  async disconnect(tenantId: string, actorUserId: string): Promise<AiProviderConnectionSummary> {
    const existing = await this.prisma.forTenantId(tenantId).aIProviderConnection.findUnique({ where: { tenantId } });
    if (!existing) {
      throw new NotFoundError('No BYOK provider connection configured for this tenant.');
    }

    const updated = await this.prisma.forTenantId(tenantId).aIProviderConnection.update({
      where: { tenantId },
      data: { status: 'DISCONNECTED', encryptedCredentials: null },
    });

    await this.audit.record({
      tenantId,
      eventType: 'AI_PROVIDER_DISCONNECTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'AIProviderConnection',
      entityId: updated.id,
      payload: { providerKey: existing.providerKey },
    });

    return toSummary(updated);
  }
}
