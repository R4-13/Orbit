import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let scoped: { user: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock } };
  let prisma: { forTenantId: jest.Mock; inTenantTransaction: jest.Mock };
  let refreshToken: { updateMany: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      user: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    };
    refreshToken = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
    prisma = {
      forTenantId: jest.fn().mockReturnValue(scoped),
      // Die Sitzungen werden in einer Mandanten-Transaktion widerrufen (RLS über die Elterntabelle, MST-13).
      inTenantTransaction: jest.fn(async (_tenantId: string, fn: (tx: { refreshToken: typeof refreshToken }) => unknown) => fn({ refreshToken })),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('findAll', () => {
    it('lists users scoped to the tenant, without password hashes', async () => {
      scoped.user.findMany.mockResolvedValue([{ id: 'user_1', email: 'a@musterwerk.example' }]);

      const result = await service.findAll('tenant_1');

      expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
      expect(scoped.user.findMany.mock.calls[0][0].select).not.toHaveProperty('passwordHash');
      expect(result).toEqual([{ id: 'user_1', email: 'a@musterwerk.example' }]);
    });
  });

  describe('deactivate', () => {
    it('rejects deactivating your own account', async () => {
      await expect(service.deactivate('tenant_1', 'user_1', 'user_1')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
      expect(scoped.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the target user is not in this tenant', async () => {
      scoped.user.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('tenant_1', 'admin_1', 'user_2')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('rejects a user that is already deactivated', async () => {
      scoped.user.findUnique.mockResolvedValue({ id: 'user_2', status: 'DEACTIVATED', email: 'x@musterwerk.example' });
      await expect(service.deactivate('tenant_1', 'admin_1', 'user_2')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
    });

    it('sets status DEACTIVATED, revokes active refresh tokens, and records USER_DEACTIVATED', async () => {
      scoped.user.findUnique.mockResolvedValue({ id: 'user_2', status: 'ACTIVE', email: 'x@musterwerk.example' });
      scoped.user.update.mockResolvedValue({ id: 'user_2', status: 'DEACTIVATED' });

      const result = await service.deactivate('tenant_1', 'admin_1', 'user_2');

      expect(scoped.user.update).toHaveBeenCalledWith({
        where: { id: 'user_2' },
        data: { status: 'DEACTIVATED' },
        select: expect.any(Object),
      });
      expect(prisma.inTenantTransaction).toHaveBeenCalledWith('tenant_1', expect.any(Function));
      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user_2', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'USER_DEACTIVATED', tenantId: 'tenant_1', entityId: 'user_2' }),
      );
      expect(result.status).toBe('DEACTIVATED');
    });
  });
});
