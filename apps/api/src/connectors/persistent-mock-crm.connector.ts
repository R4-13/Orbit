import { randomUUID } from 'node:crypto';
import type {
  CreateLeadInput,
  CreateLeadResult,
  CrmCompanyRecord,
  CrmConnector,
  CrmContactRecord,
  LogActivityInput,
  UpsertCompanyInput,
  UpsertContactInput,
} from '@orbit/integration-core';
import type { Prisma } from '@orbit/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Postgres-backed test System-of-Record for `CRM_CONNECTOR=mock` (Amendment
 * 02 §12.5). The in-memory `MockCrmConnector` forgot every contact on a
 * worker/container restart while ORBIT kept the issued `crmExternalId` in
 * Postgres — a returning sender's `create_lead` then failed. Here every
 * reference lives in `mock_crm_records`, is looked up per call, and is
 * tenant-bound twice (explicit `tenantId` filter + RLS):
 *
 * - an id the mock never issued (including a formally similar one),
 * - an id from another tenant, and
 * - an id whose backing record was deleted
 *
 * are all rejected — nothing is silently reconstructed. It is a clearly
 * labelled test SoR (`providerName = 'mock-persistent'`), not a real CRM.
 */
export class PersistentMockCrmConnector implements CrmConnector {
  readonly providerName = 'mock-persistent';

  constructor(private readonly prisma: PrismaService) {}

  async testConnection(): Promise<boolean> {
    return true;
  }

  async upsertContact(input: UpsertContactInput): Promise<CrmContactRecord> {
    const scoped = this.prisma.forTenantId(input.tenantId);
    const existing = input.email
      ? await scoped.mockCrmRecord.findFirst({ where: { tenantId: input.tenantId, kind: 'CONTACT', matchKey: input.email } })
      : null;
    const externalId = existing?.externalId ?? `mock-contact-${randomUUID()}`;
    const data = { firstName: input.firstName, lastName: input.lastName } as Prisma.InputJsonValue;
    if (existing) {
      await scoped.mockCrmRecord.update({ where: { id: existing.id }, data: { data } });
    } else {
      await scoped.mockCrmRecord.create({
        data: { tenantId: input.tenantId, kind: 'CONTACT', externalId, matchKey: input.email, data },
      });
    }
    return { externalId, email: input.email, firstName: input.firstName, lastName: input.lastName };
  }

  async upsertCompany(input: UpsertCompanyInput): Promise<CrmCompanyRecord> {
    const scoped = this.prisma.forTenantId(input.tenantId);
    const existing = input.domain
      ? await scoped.mockCrmRecord.findFirst({ where: { tenantId: input.tenantId, kind: 'COMPANY', matchKey: input.domain } })
      : null;
    const externalId = existing?.externalId ?? `mock-company-${randomUUID()}`;
    const data = { name: input.name } as Prisma.InputJsonValue;
    if (existing) {
      await scoped.mockCrmRecord.update({ where: { id: existing.id }, data: { data } });
    } else {
      await scoped.mockCrmRecord.create({
        data: { tenantId: input.tenantId, kind: 'COMPANY', externalId, matchKey: input.domain, data },
      });
    }
    return { externalId, name: input.name };
  }

  async createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    await this.assertContactExists(input.tenantId, input.contactExternalId);
    const externalId = `mock-lead-${randomUUID()}`;
    await this.prisma.forTenantId(input.tenantId).mockCrmRecord.create({
      data: {
        tenantId: input.tenantId,
        kind: 'LEAD',
        externalId,
        data: { contactExternalId: input.contactExternalId, source: input.source, notes: input.notes ?? null } as Prisma.InputJsonValue,
      },
    });
    return { externalId };
  }

  async logActivity(input: LogActivityInput): Promise<void> {
    await this.assertContactExists(input.tenantId, input.contactExternalId);
    await this.prisma.forTenantId(input.tenantId).mockCrmRecord.create({
      data: {
        tenantId: input.tenantId,
        kind: 'ACTIVITY',
        externalId: `mock-activity-${randomUUID()}`,
        data: {
          contactExternalId: input.contactExternalId,
          activityType: input.activityType,
          summary: input.summary,
          occurredAt: input.occurredAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async assertContactExists(tenantId: string, contactExternalId: string): Promise<void> {
    const found = await this.prisma
      .forTenantId(tenantId)
      .mockCrmRecord.findFirst({ where: { tenantId, kind: 'CONTACT', externalId: contactExternalId } });
    if (!found) {
      throw new Error(`Mock CRM: unknown contact "${contactExternalId}".`);
    }
  }
}
