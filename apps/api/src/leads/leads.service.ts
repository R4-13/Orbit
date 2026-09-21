import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Lead, LeadSource, LeadStatus } from '@orbit/domain';
import type { CrmConnector } from '@orbit/integration-core';
import { AuditService } from '../audit/audit.service';
import { CRM_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';

export interface CreateLeadInput {
  contactId: string;
  companyId?: string;
  source: LeadSource;
  notes?: string;
  caseId?: string;
}

/**
 * Creating a Lead always also creates a follow-up Task for the sales rep
 * (PRODUCT_CONTEXT.md: "... ein Lead erzeugt, Folgeaufgaben ... erstellt")
 * — reuses TasksService (Phase 4) rather than a parallel notion of
 * "follow-up" living only in this module.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
    @Inject(CRM_CONNECTOR) private readonly crmConnector: CrmConnector,
  ) {}

  async create(tenantId: string, actorUserId: string, input: CreateLeadInput): Promise<Lead> {
    const contact = await this.prisma.forTenantId(tenantId).contact.findUnique({
      where: { id: input.contactId },
    });
    if (!contact) {
      throw new NotFoundError('Contact not found.', { id: input.contactId });
    }

    const crmLead = await this.crmConnector.createLead({
      contactExternalId: contact.crmExternalId ?? contact.id,
      companyExternalId: input.companyId,
      source: input.source,
      notes: input.notes,
    });

    const lead = await this.prisma.forTenantId(tenantId).lead.create({
      data: {
        tenantId,
        caseId: input.caseId,
        contactId: input.contactId,
        companyId: input.companyId,
        source: input.source,
        notes: input.notes,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'LEAD_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Lead',
      entityId: lead.id,
      payload: { source: lead.source, crmExternalId: crmLead.externalId },
    });

    await this.tasks.create(tenantId, actorUserId, {
      title: `Neuen Lead kontaktieren: ${contact.firstName} ${contact.lastName}`,
      description: input.notes,
      caseId: input.caseId,
    });

    return lead;
  }

  findAll(tenantId: string, status?: LeadStatus): Promise<Lead[]> {
    return this.prisma.forTenantId(tenantId).lead.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Lead> {
    const found = await this.prisma.forTenantId(tenantId).lead.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Lead not found.', { id });
    }
    return found;
  }

  async updateStatus(tenantId: string, id: string, status: LeadStatus): Promise<Lead> {
    await this.findOne(tenantId, id);
    return this.prisma.forTenantId(tenantId).lead.update({ where: { id }, data: { status } });
  }
}
