import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Integration, IntegrationConnectorType, Prisma } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';

export type IntegrationSummary = Omit<Integration, 'encryptedCredentials'> & { hasCredentials: boolean };

function toSummary(integration: Integration): IntegrationSummary {
  const { encryptedCredentials, ...rest } = integration;
  return { ...rest, hasCredentials: encryptedCredentials !== null };
}

/**
 * §39/§52: per-tenant connector credential storage. Credentials are
 * encrypted at rest (CredentialEncryptionService, AES-256-GCM) and never
 * read back out over the API — `findAll()`/`upsertCredentials()` both
 * return only `hasCredentials: boolean`, never the plaintext or even the
 * ciphertext. Decrypting is for a real connector adapter's own internal
 * use only (none exist yet — every connector is still a mock, see
 * docs/INTEGRATIONS.md), not exposed as an endpoint.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  findAll(tenantId: string): Promise<IntegrationSummary[]> {
    return this.prisma
      .forTenantId(tenantId)
      .integration.findMany({ orderBy: { connectorType: 'asc' } })
      .then((rows) => rows.map(toSummary));
  }

  async upsertCredentials(
    tenantId: string,
    actorUserId: string,
    connectorType: IntegrationConnectorType,
    credentials: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<IntegrationSummary> {
    // Prisma's generated `Bytes` type wants a Uint8Array<ArrayBuffer>
    // specifically; Node's Buffer is typed as Uint8Array<ArrayBufferLike>
    // (which also admits SharedArrayBuffer), so a plain Buffer doesn't
    // structurally match under strict lib.dom typings — copy into a fresh
    // Uint8Array to satisfy that without an unsafe cast.
    const encryptedCredentials = new Uint8Array(this.encryption.encrypt(JSON.stringify(credentials)));

    const updated = await this.prisma.forTenantId(tenantId).integration.upsert({
      where: { tenantId_connectorType: { tenantId, connectorType } },
      create: {
        tenantId,
        connectorType,
        status: 'CONNECTED',
        encryptedCredentials,
        config: config as Prisma.InputJsonValue | undefined,
      },
      update: {
        status: 'CONNECTED',
        encryptedCredentials,
        config: config as Prisma.InputJsonValue | undefined,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'INTEGRATION_CONNECTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Integration',
      entityId: updated.id,
      payload: { connectorType },
    });

    return toSummary(updated);
  }

  async disconnect(tenantId: string, actorUserId: string, connectorType: IntegrationConnectorType): Promise<IntegrationSummary> {
    const existing = await this.prisma
      .forTenantId(tenantId)
      .integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType } } });
    if (!existing) {
      throw new NotFoundError('Integration not configured.', { connectorType });
    }

    const updated = await this.prisma.forTenantId(tenantId).integration.update({
      where: { tenantId_connectorType: { tenantId, connectorType } },
      data: { status: 'DISCONNECTED', encryptedCredentials: null },
    });

    await this.audit.record({
      tenantId,
      eventType: 'INTEGRATION_DISCONNECTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Integration',
      entityId: updated.id,
      payload: { connectorType },
    });

    return toSummary(updated);
  }
}
