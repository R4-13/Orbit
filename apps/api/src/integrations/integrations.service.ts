import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Integration, IntegrationConnectorType, Prisma } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialVaultService } from '../security/credential-vault.service';

export type IntegrationSummary = Omit<Integration, 'credentialReference'> & { hasCredentials: boolean };

function toSummary(integration: Integration): IntegrationSummary {
  const { credentialReference, ...rest } = integration;
  return { ...rest, hasCredentials: credentialReference !== null };
}

/**
 * §39/§52, erweitert um das Integration-Framework-Amendment
 * (ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_01, §6): per-tenant Connector-
 * Verbindungsstatus (`IntegrationConnection`). Secrets selbst werden
 * ausschließlich über `CredentialVaultService` gespeichert/gelesen —
 * dieser Service sieht nie ein Klartext-Secret, nur die opake
 * `credentialReference`-ID. `findAll()`/`upsertCredentials()` geben
 * entsprechend nur `hasCredentials: boolean` zurück, nie die Referenz
 * selbst oder gar das Secret.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vault: CredentialVaultService,
  ) {}

  findAll(tenantId: string): Promise<IntegrationSummary[]> {
    return this.prisma
      .forTenantId(tenantId)
      .integration.findMany({ orderBy: { connectorType: 'asc' } })
      .then((rows) => rows.map(toSummary));
  }

  /** Die Kalender, aus denen Terminvorschläge entstehen (nur mit der Berechtigung „Verfügbarkeit lesen“ sinnvoll); Duplikate werden entfernt. */
  async updateCalendarIds(tenantId: string, actorUserId: string, calendarIds: string[]): Promise<IntegrationSummary> {
    const existing = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    if (!existing) throw new NotFoundError('Gmail ist nicht verbunden.', { connectorType: 'GMAIL' });
    const ids = [...new Set(calendarIds.map((id) => id.trim()).filter(Boolean))];
    const config = { ...((existing.config ?? {}) as Record<string, unknown>), calendarIds: ids };
    const updated = await this.prisma.forTenantId(tenantId).integration.update({ where: { id: existing.id }, data: { config: config as Prisma.InputJsonValue } });
    await this.audit.record({
      tenantId,
      eventType: 'INTEGRATION_CONFIG_UPDATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Integration',
      entityId: 'GMAIL',
      payload: { connectorType: 'GMAIL', calendarCount: ids.length },
    });
    return toSummary(updated);
  }

  async upsertCredentials(
    tenantId: string,
    actorUserId: string,
    connectorType: IntegrationConnectorType,
    credentials: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<IntegrationSummary> {
    const existing = await this.prisma
      .forTenantId(tenantId)
      .integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType } } });

    let credentialReference: string;
    if (existing?.credentialReference != null) {
      await this.vault.updateSecret(tenantId, existing.credentialReference, { tenantId, value: credentials });
      credentialReference = existing.credentialReference;
    } else {
      credentialReference = await this.vault.storeSecret({ tenantId, value: credentials });
    }

    const updated = await this.prisma.forTenantId(tenantId).integration.upsert({
      where: { tenantId_connectorType: { tenantId, connectorType } },
      create: {
        tenantId,
        connectorType,
        status: 'CONNECTED',
        credentialReference,
        config: config as Prisma.InputJsonValue | undefined,
      },
      update: {
        status: 'CONNECTED',
        credentialReference,
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

    if (existing.credentialReference) {
      await this.vault.deleteSecret(tenantId, existing.credentialReference);
    }

    const updated = await this.prisma.forTenantId(tenantId).integration.update({
      where: { tenantId_connectorType: { tenantId, connectorType } },
      data: { status: 'DISCONNECTED', credentialReference: null },
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
