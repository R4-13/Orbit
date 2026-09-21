import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('writes through the tenant-scoped client, not the raw one', async () => {
    const auditLogCreate = jest.fn().mockResolvedValue({});
    const scopedClient = { auditLog: { create: auditLogCreate } };
    const forTenantId = jest.fn().mockReturnValue(scopedClient);

    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: { forTenantId } }],
    }).compile();

    const service = moduleRef.get(AuditService);

    await service.record({
      tenantId: 'tenant_1',
      eventType: 'CASE_CREATED',
      actorType: 'USER',
      actorUserId: 'user_1',
      entityType: 'Case',
      entityId: 'case_1',
      payload: { title: 'Neue Rechnung eingegangen' },
    });

    expect(forTenantId).toHaveBeenCalledWith('tenant_1');
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant_1',
        eventType: 'CASE_CREATED',
        actorType: 'USER',
        actorUserId: 'user_1',
        entityType: 'Case',
        entityId: 'case_1',
        payload: { title: 'Neue Rechnung eingegangen' },
      },
    });
  });
});
