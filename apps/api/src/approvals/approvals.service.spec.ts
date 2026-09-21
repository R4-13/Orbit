import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from './approvals.service';

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let scoped: {
    approval: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    scoped = {
      approval: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
      ],
    }).compile();
    service = moduleRef.get(ApprovalsService);
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
});
