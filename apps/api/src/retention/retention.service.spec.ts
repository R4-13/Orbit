import { Test } from '@nestjs/testing';
import { RetentionCategory } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  let service: RetentionService;
  let scoped: {
    retentionPolicy: { findMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock };
    agentRun: { count: jest.Mock; findFirst: jest.Mock; deleteMany: jest.Mock };
    toolInvocation: { count: jest.Mock; findFirst: jest.Mock; deleteMany: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      retentionPolicy: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), upsert: jest.fn() },
      agentRun: { count: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() },
      toolInvocation: { count: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(RetentionService);
  });

  describe('findAll', () => {
    it('lists every RetentionPolicy row for the tenant', async () => {
      scoped.retentionPolicy.findMany.mockResolvedValue([{ category: RetentionCategory.AGENT_RUNS, retentionDays: 90 }]);
      const result = await service.findAll('tenant_1');
      expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
      expect(result).toHaveLength(1);
    });
  });

  describe('upsertPolicy', () => {
    it('creates a new policy and records RETENTION_POLICY_UPDATED with previousRetentionDays null', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue(null);
      scoped.retentionPolicy.upsert.mockResolvedValue({
        id: 'rp_1',
        category: RetentionCategory.AGENT_RUNS,
        retentionDays: 90,
      });

      const result = await service.upsertPolicy('tenant_1', 'user_1', RetentionCategory.AGENT_RUNS, 90);

      expect(scoped.retentionPolicy.upsert).toHaveBeenCalledWith({
        where: { tenantId_category: { tenantId: 'tenant_1', category: RetentionCategory.AGENT_RUNS } },
        create: { tenantId: 'tenant_1', category: RetentionCategory.AGENT_RUNS, retentionDays: 90, updatedByUserId: 'user_1' },
        update: { retentionDays: 90, updatedByUserId: 'user_1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'RETENTION_POLICY_UPDATED',
          payload: { category: RetentionCategory.AGENT_RUNS, previousRetentionDays: null, newRetentionDays: 90 },
        }),
      );
      expect(result.retentionDays).toBe(90);
    });

    it('updates an existing policy and records the previous retentionDays', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue({
        id: 'rp_1',
        category: RetentionCategory.TOOL_INVOCATIONS,
        retentionDays: 60,
      });
      scoped.retentionPolicy.upsert.mockResolvedValue({
        id: 'rp_1',
        category: RetentionCategory.TOOL_INVOCATIONS,
        retentionDays: 30,
      });

      await service.upsertPolicy('tenant_1', 'user_1', RetentionCategory.TOOL_INVOCATIONS, 30);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { category: RetentionCategory.TOOL_INVOCATIONS, previousRetentionDays: 60, newRetentionDays: 30 },
        }),
      );
    });
  });

  describe('preview', () => {
    it('throws NotFoundError when no policy is configured for the category', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue(null);
      await expect(service.preview('tenant_1', RetentionCategory.AGENT_RUNS)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('counts AgentRun rows in a terminal status older than the cutoff, excluding in-flight runs', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue({ id: 'rp_1', retentionDays: 30 });
      scoped.agentRun.count.mockResolvedValue(5);
      scoped.agentRun.findFirst.mockResolvedValueOnce({ startedAt: new Date('2026-01-01') });
      scoped.agentRun.findFirst.mockResolvedValueOnce({ startedAt: new Date('2026-02-01') });

      const result = await service.preview('tenant_1', RetentionCategory.AGENT_RUNS);

      expect(scoped.agentRun.count).toHaveBeenCalledWith({
        where: { startedAt: { lt: expect.any(Date) }, status: { in: ['COMPLETED', 'FAILED', 'REJECTED'] } },
      });
      expect(result.matchingCount).toBe(5);
      expect(result.oldestMatchingAt).toEqual(new Date('2026-01-01'));
      expect(result.newestMatchingAt).toEqual(new Date('2026-02-01'));
    });

    it('counts ToolInvocation rows older than the cutoff without a status filter', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue({ id: 'rp_2', retentionDays: 14 });
      scoped.toolInvocation.count.mockResolvedValue(12);
      scoped.toolInvocation.findFirst.mockResolvedValueOnce({ createdAt: new Date('2026-01-05') });
      scoped.toolInvocation.findFirst.mockResolvedValueOnce({ createdAt: new Date('2026-01-20') });

      const result = await service.preview('tenant_1', RetentionCategory.TOOL_INVOCATIONS);

      expect(scoped.toolInvocation.count).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
      expect(result.matchingCount).toBe(12);
    });
  });

  describe('apply', () => {
    it('throws NotFoundError when no policy is configured for the category', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue(null);
      await expect(service.apply('tenant_1', 'user_1', RetentionCategory.AGENT_RUNS)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(scoped.agentRun.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes only terminal-status AgentRun rows older than the cutoff and records RETENTION_APPLIED', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue({ id: 'rp_1', retentionDays: 90 });
      scoped.agentRun.deleteMany.mockResolvedValue({ count: 7 });

      const result = await service.apply('tenant_1', 'user_1', RetentionCategory.AGENT_RUNS);

      expect(scoped.agentRun.deleteMany).toHaveBeenCalledWith({
        where: { startedAt: { lt: expect.any(Date) }, status: { in: ['COMPLETED', 'FAILED', 'REJECTED'] } },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'RETENTION_APPLIED',
          payload: expect.objectContaining({ category: RetentionCategory.AGENT_RUNS, deletedCount: 7 }),
        }),
      );
      expect(result.deletedCount).toBe(7);
    });

    it('deletes ToolInvocation rows older than the cutoff', async () => {
      scoped.retentionPolicy.findUnique.mockResolvedValue({ id: 'rp_2', retentionDays: 14 });
      scoped.toolInvocation.deleteMany.mockResolvedValue({ count: 42 });

      const result = await service.apply('tenant_1', 'user_1', RetentionCategory.TOOL_INVOCATIONS);

      expect(scoped.toolInvocation.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
      expect(result.deletedCount).toBe(42);
    });
  });
});
