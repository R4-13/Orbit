import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Company } from '@orbit/domain';
import type { CrmConnector } from '@orbit/integration-core';
import { AuditService } from '../audit/audit.service';
import { CRM_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
}

/**
 * Company/Contact/Lead creation has no Policy Engine gate (unlike
 * Supplier creation in Phase 7): there's no SUPPLIER_CREATE-equivalent
 * POLICY_ACTIONS entry for CRM records (@orbit/shared/policy.ts) — a new
 * CRM contact carries none of the financial risk a new supplier does, so
 * it's always created directly and kept in sync with the CRM connector.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CRM_CONNECTOR) private readonly crmConnector: CrmConnector,
  ) {}

  async upsert(tenantId: string, actorUserId: string, input: UpsertCompanyInput): Promise<Company> {
    const existing = input.domain
      ? await this.prisma.forTenantId(tenantId).company.findFirst({ where: { domain: input.domain } })
      : null;
    if (existing) {
      return existing;
    }

    const crmCompany = await this.crmConnector.upsertCompany({ name: input.name, domain: input.domain });

    const company = await this.prisma.forTenantId(tenantId).company.create({
      data: {
        tenantId,
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        crmExternalId: crmCompany.externalId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'COMPANY_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Company',
      entityId: company.id,
      payload: { name: company.name },
    });

    return company;
  }

  findAll(tenantId: string): Promise<Company[]> {
    return this.prisma.forTenantId(tenantId).company.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(tenantId: string, id: string): Promise<Company> {
    const found = await this.prisma.forTenantId(tenantId).company.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Company not found.', { id });
    }
    return found;
  }
}
