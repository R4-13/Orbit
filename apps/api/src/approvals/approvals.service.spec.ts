import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from './approvals.service';

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let metrics: MetricsService;
  let scoped: {
    approval: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    scoped = {
      approval: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        MetricsService,
      ],
    }).compile();
    service = moduleRef.get(ApprovalsService);
    metrics = moduleRef.get(MetricsService);
  });

  it('create() persists a PENDING approval request for the given entity', async () => {
    scoped.approval.create.mockResolvedValue({ id: 'approval_1' });

    await service.create('tenant_1', {
      entityType: 'SUPPLIER',
      entityId: 'supplier_1',
      policyAction: 'supplier.create',
      requestedByUserId: 'agent',
    });

    expect(scoped.approval.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant_1',
        entityType: 'SUPPLIER',
        entityId: 'supplier_1',
        policyAction: 'supplier.create',
        requestedByUserId: 'agent',
        reason: undefined,
      },
    });
  });

  it('findOne() throws NotFoundError for a missing approval', async () => {
    scoped.approval.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
  });

  it('markDecided() only updates rows that are still PENDING for that exact entity', async () => {
    await service.markDecided('tenant_1', 'SUPPLIER', 'supplier_1', 'user_1', 'APPROVED');

    expect(scoped.approval.updateMany).toHaveBeenCalledWith({
      where: { entityType: 'SUPPLIER', entityId: 'supplier_1', status: 'PENDING' },
      data: { status: 'APPROVED', decidedByUserId: 'user_1', decidedAt: expect.any(Date) },
    });
  });

  it('markDecided() records approval_wait_time_seconds for the matched, previously-pending row', async () => {
    const requestedAt = new Date(Date.now() - 5000);
    scoped.approval.findMany.mockResolvedValue([{ requestedAt }]);
    const observeSpy = jest.spyOn(metrics.approvalWaitTime, 'observe');

    await service.markDecided('tenant_1', 'SUPPLIER', 'supplier_1', 'user_1', 'APPROVED');

    expect(observeSpy).toHaveBeenCalledWith({ entity_type: 'SUPPLIER', decision: 'APPROVED' }, expect.any(Number));
    const [, observedSeconds] = observeSpy.mock.calls[0] as unknown as [unknown, number];
    expect(observedSeconds).toBeGreaterThanOrEqual(5);
  });
});
