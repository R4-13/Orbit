import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Case, CaseStatus, CaseType } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCaseInput {
  type: CaseType;
  title: string;
  description?: string;
}

export interface QueryCasesInput {
  type?: CaseType;
  status?: CaseStatus;
}

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, actorUserId: string, input: CreateCaseInput): Promise<Case> {
    const created = await this.prisma.forTenantId(tenantId).case.create({
      data: {
        tenantId,
        type: input.type,
        title: input.title,
        description: input.description,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'CASE_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Case',
      entityId: created.id,
      payload: { type: created.type, title: created.title },
    });

    return created;
  }

  findAll(tenantId: string, query: QueryCasesInput): Promise<Case[]> {
    return this.prisma.forTenantId(tenantId).case.findMany({
      where: { type: query.type, status: query.status },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Includes every related record a Case detail screen needs (§11: "jeder
   * Vorgang muss von Anfang bis Ende nachvollziehbar sein") — tasks,
   * documents, invoices, leads, inbound/outbound emails, and agent runs
   * with their individual tool invocations.
   */
  async findOne(tenantId: string, id: string): Promise<Case> {
    const found = await this.prisma.forTenantId(tenantId).case.findUnique({
      where: { id },
      include: {
        tasks: { orderBy: { createdAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } },
        emailMessages: { orderBy: { createdAt: 'desc' } },
        invoices: { orderBy: { createdAt: 'desc' } },
        leads: { orderBy: { createdAt: 'desc' } },
        agentRuns: {
          orderBy: { startedAt: 'desc' },
          include: { toolInvocations: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!found) {
      throw new NotFoundError('Case not found.', { id });
    }
    return found;
  }

  async updateStatus(
    tenantId: string,
    id: string,
    actorUserId: string,
    status: CaseStatus,
  ): Promise<Case> {
    const existing = await this.findOne(tenantId, id);

    const updated = await this.prisma.forTenantId(tenantId).case.update({
      where: { id },
      data: { status },
    });

    await this.audit.record({
      tenantId,
      eventType: 'CASE_STATUS_CHANGED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Case',
      entityId: id,
      payload: { from: existing.status, to: status },
    });

    return updated;
  }
}
