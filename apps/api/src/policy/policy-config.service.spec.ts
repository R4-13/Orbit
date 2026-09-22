import { Test } from '@nestjs/testing';
import { POLICY_ACTIONS } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyConfigService } from './policy-config.service';

describe('PolicyConfigService', () => {
  let service: PolicyConfigService;
  let scoped: { policyConfig: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      policyConfig: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PolicyConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(PolicyConfigService);
  });

  describe('findAll', () => {
    it('lists every PolicyConfig row for the tenant', async () => {
      scoped.policyConfig.findMany.mockResolvedValue([{ action: POLICY_ACTIONS.LEAD_CREATE, mode: 'AUTONOMOUS' }]);
      const result = await service.findAll('tenant_1');
      expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
      expect(result).toHaveLength(1);
    });
  });

  describe('updateMode', () => {
    it('throws NotFoundError when the action has no PolicyConfig row for this tenant', async () => {
      scoped.policyConfig.findUnique.mockResolvedValue(null);
      await expect(
        service.updateMode('tenant_1', 'user_1', POLICY_ACTIONS.LEAD_CREATE, 'DISABLED'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('updates an unlocked action to any mode and records POLICY_CONFIG_UPDATED', async () => {
      scoped.policyConfig.findUnique.mockResolvedValue({
        id: 'pc_1',
        action: POLICY_ACTIONS.LEAD_CREATE,
        mode: 'AUTONOMOUS',
        locked: false,
      });
      scoped.policyConfig.update.mockResolvedValue({
        id: 'pc_1',
        action: POLICY_ACTIONS.LEAD_CREATE,
        mode: 'DISABLED',
      });

      const result = await service.updateMode('tenant_1', 'user_1', POLICY_ACTIONS.LEAD_CREATE, 'DISABLED');

      expect(scoped.policyConfig.update).toHaveBeenCalledWith({
        where: { tenantId_action: { tenantId: 'tenant_1', action: POLICY_ACTIONS.LEAD_CREATE } },
        data: { mode: 'DISABLED', updatedByUserId: 'user_1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'POLICY_CONFIG_UPDATED',
          payload: { action: POLICY_ACTIONS.LEAD_CREATE, previousMode: 'AUTONOMOUS', newMode: 'DISABLED' },
        }),
      );
      expect(result.mode).toBe('DISABLED');
    });

    it('allows tightening a locked action below its default ceiling', async () => {
      // SUPPLIER_CREATE is locked at REQUIRE_APPROVAL (rank 2) — DISABLED (rank 0) is a tightening, must be allowed.
      scoped.policyConfig.findUnique.mockResolvedValue({
        id: 'pc_2',
        action: POLICY_ACTIONS.SUPPLIER_CREATE,
        mode: 'REQUIRE_APPROVAL',
        locked: true,
      });
      scoped.policyConfig.update.mockResolvedValue({ id: 'pc_2', mode: 'DISABLED' });

      await expect(
        service.updateMode('tenant_1', 'user_1', POLICY_ACTIONS.SUPPLIER_CREATE, 'DISABLED'),
      ).resolves.toMatchObject({ mode: 'DISABLED' });
    });

    it('rejects relaxing a locked action beyond its default ceiling', async () => {
      // SUPPLIER_CREATE is locked at REQUIRE_APPROVAL (rank 2) — AUTONOMOUS (rank 3) must be rejected.
      scoped.policyConfig.findUnique.mockResolvedValue({
        id: 'pc_2',
        action: POLICY_ACTIONS.SUPPLIER_CREATE,
        mode: 'REQUIRE_APPROVAL',
        locked: true,
      });

      await expect(
        service.updateMode('tenant_1', 'user_1', POLICY_ACTIONS.SUPPLIER_CREATE, 'AUTONOMOUS'),
      ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
      expect(scoped.policyConfig.update).not.toHaveBeenCalled();
    });

    it('rejects any change at all to PAYMENT_EXECUTE (locked at DISABLED, the lowest rank)', async () => {
      scoped.policyConfig.findUnique.mockResolvedValue({
        id: 'pc_3',
        action: POLICY_ACTIONS.PAYMENT_EXECUTE,
        mode: 'DISABLED',
        locked: true,
      });

      await expect(
        service.updateMode('tenant_1', 'user_1', POLICY_ACTIONS.PAYMENT_EXECUTE, 'SUGGEST_ONLY'),
      ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    });
  });
});
