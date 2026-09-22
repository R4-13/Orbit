import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Opportunity, OpportunityStage } from '@orbit/domain';
import { AuditService, type AuditActorType } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateOpportunityInput {
  leadId?: string;
  companyId?: string;
  contactId?: string;
  name: string;
  value?: number;
  currency?: string;
}

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string | undefined,
    input: CreateOpportunityInput,
    actorType: AuditActorType = 'USER',
  ): Promise<Opportunity> {
    const opportunity = await this.prisma.forTenantId(tenantId).opportunity.create({
      data: {
        tenantId,
        leadId: input.leadId,
        companyId: input.companyId,
        contactId: input.contactId,
        name: input.name,
        value: input.value,
        currency: input.currency ?? 'EUR',
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'OPPORTUNITY_CREATED',
      actorType,
      actorUserId,
      entityType: 'Opportunity',
      entityId: opportunity.id,
      payload: { name: opportunity.name },
    });

    return opportunity;
  }

  findAll(tenantId: string, stage?: OpportunityStage): Promise<Opportunity[]> {
    return this.prisma.forTenantId(tenantId).opportunity.findMany({
      where: { stage },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Read-only lookup — used by the Sales Agent's `update_opportunity` tool to decide create-vs-update. */
  findByLeadId(tenantId: string, leadId: string): Promise<Opportunity | null> {
    return this.prisma.forTenantId(tenantId).opportunity.findFirst({ where: { leadId } });
  }

  async findOne(tenantId: string, id: string): Promise<Opportunity> {
    const found = await this.prisma.forTenantId(tenantId).opportunity.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Opportunity not found.', { id });
    }
    return found;
  }

  async updateStage(
    tenantId: string,
    actorUserId: string | undefined,
    id: string,
    stage: OpportunityStage,
    actorType: AuditActorType = 'USER',
  ): Promise<Opportunity> {
    const existing = await this.findOne(tenantId, id);

    const updated = await this.prisma.forTenantId(tenantId).opportunity.update({
      where: { id },
      data: { stage },
    });

    await this.audit.record({
      tenantId,
      eventType: 'OPPORTUNITY_UPDATED',
      actorType,
      actorUserId,
      entityType: 'Opportunity',
      entityId: id,
      payload: { from: existing.stage, to: stage },
    });

    return updated;
  }
}
