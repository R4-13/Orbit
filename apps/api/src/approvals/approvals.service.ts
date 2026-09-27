import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Approval, ApprovalEntityType, ApprovalStatus } from '@orbit/domain';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateApprovalInput {
  entityType: ApprovalEntityType;
  entityId: string;
  policyAction: string;
  requestedByUserId?: string;
  reason?: string;
}

export interface QueryApprovalsInput {
  status?: ApprovalStatus;
  entityType?: ApprovalEntityType;
}

/**
 * The approval inbox: a read-oriented, denormalized view across every
 * entity type that can require a human decision (Supplier, Invoice,
 * BookingProposal, ...). Deciding an approval happens on the owning
 * entity's own endpoint (e.g. `PATCH /v1/suppliers/:id/approve`), which
 * updates both the entity's status and the matching Approval row in one
 * place — see SuppliersService.decideApproval() — rather than through a
 * generic decide-anything endpoint here. That keeps the "what does
 * approving this actually do" logic next to the entity it affects instead
 * of behind a dispatch table this module would otherwise need to own.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  create(tenantId: string, input: CreateApprovalInput): Promise<Approval> {
    return this.prisma.forTenantId(tenantId).approval.create({
      data: {
        tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        policyAction: input.policyAction,
        requestedByUserId: input.requestedByUserId,
        reason: input.reason,
      },
    });
  }

  findAll(tenantId: string, query: QueryApprovalsInput): Promise<Approval[]> {
    return this.prisma.forTenantId(tenantId).approval.findMany({
      where: { status: query.status, entityType: query.entityType },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Approval> {
    const found = await this.prisma.forTenantId(tenantId).approval.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Approval not found.', { id });
    }
    return found;
  }

  /** Used by owning-entity services (e.g. SuppliersService) when their entity is approved/rejected. */
  async markDecided(
    tenantId: string,
    entityType: ApprovalEntityType,
    entityId: string,
    actorUserId: string,
    status: 'APPROVED' | 'REJECTED',
  ): Promise<void> {
    const scoped = this.prisma.forTenantId(tenantId);
    // `updateMany()` doesn't return the affected rows' prior state, and
    // `approval_wait_time_seconds` needs `requestedAt` — fetched first,
    // matching docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §64's
    // approval_wait_time metric. In practice at most one row ever matches
    // (entityType+entityId+PENDING).
    const pending = await scoped.approval.findMany({ where: { entityType, entityId, status: 'PENDING' } });

    await scoped.approval.updateMany({
      where: { entityType, entityId, status: 'PENDING' },
      data: { status, decidedByUserId: actorUserId, decidedAt: new Date() },
    });

    const decidedAt = Date.now();
    for (const approval of pending) {
      this.metrics.approvalWaitTime.observe(
        { entity_type: entityType, decision: status },
        (decidedAt - approval.requestedAt.getTime()) / 1000,
      );
    }
  }
}
