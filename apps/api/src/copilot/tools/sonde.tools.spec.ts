import { Test } from '@nestjs/testing';
import { ToolRegistry } from '@orbit/agent-core';
import { ApprovalsService } from '../../approvals/approvals.service';
import { CasesService } from '../../cases/cases.service';
import { DashboardService } from '../../dashboard/dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TasksService } from '../../tasks/tasks.service';
import { SondeTools } from './sonde.tools';

describe('SondeTools', () => {
  let tools: SondeTools;
  let cases: { findAll: jest.Mock; findOne: jest.Mock };
  let tasks: { findAll: jest.Mock };
  let approvals: { findAll: jest.Mock };
  let scopedAgentRun: { count: jest.Mock; findMany: jest.Mock };
  let prisma: { forTenantId: jest.Mock };
  let registry: ToolRegistry;

  const context = { tenantId: 'tenant_1', agentRunId: 'run_1' };

  beforeEach(async () => {
    cases = { findAll: jest.fn(), findOne: jest.fn() };
    cases.findAll.mockResolvedValue([]);
    tasks = { findAll: jest.fn() };
    tasks.findAll.mockResolvedValue([]);
    approvals = { findAll: jest.fn() };
    approvals.findAll.mockResolvedValue([]);
    scopedAgentRun = { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) };
    prisma = { forTenantId: jest.fn().mockReturnValue({ agentRun: scopedAgentRun }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SondeTools,
        { provide: CasesService, useValue: cases },
        { provide: TasksService, useValue: tasks },
        { provide: ApprovalsService, useValue: approvals },
        { provide: PrismaService, useValue: prisma },
        { provide: DashboardService, useValue: { viewerFor: jest.fn().mockResolvedValue(undefined), snapshot: jest.fn() } },
      ],
    }).compile();

    tools = moduleRef.get(SondeTools);
    registry = new ToolRegistry();
    tools.register(registry);
  });

  it('registers exactly the five ASK-mode tools, all gated by COPILOT_READ', () => {
    const definitions = registry.list();
    expect(definitions.map((d) => d.name).sort()).toEqual([
      'get_case',
      'get_dashboard_summary',
      'list_failed_agent_runs',
      'list_open_approvals',
      'list_overdue_tasks',
    ]);
    for (const def of definitions) {
      expect(def.policyAction).toBe('copilot.read');
    }
  });

  describe('get_dashboard_summary', () => {
    it('counts open cases, open tasks, overdue tasks, pending approvals, and failed runs', async () => {
      const now = Date.now();
      cases.findAll.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      tasks.findAll.mockResolvedValue([
        { id: 't1', dueDate: null },
        { id: 't2', dueDate: new Date(now - 86_400_000) }, // overdue
        { id: 't3', dueDate: new Date(now + 86_400_000) }, // not yet due
      ]);
      approvals.findAll.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
      scopedAgentRun.count.mockResolvedValue(1);

      const result = await registry.execute('get_dashboard_summary', {}, context);

      expect(cases.findAll).toHaveBeenCalledWith('tenant_1', {});
      expect(tasks.findAll).toHaveBeenCalledWith('tenant_1', { status: 'OPEN' });
      expect(approvals.findAll).toHaveBeenCalledWith('tenant_1', { status: 'PENDING' });
      expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
      expect(scopedAgentRun.count).toHaveBeenCalledWith({ where: { status: 'FAILED' } });
      expect(result).toEqual({
        openCasesCount: 2,
        openTasksCount: 3,
        overdueTasksCount: 1,
        pendingApprovalsCount: 3,
        failedRunsCount: 1,
      });
    });
  });

  describe('list_overdue_tasks', () => {
    it('returns only open tasks past their due date, soonest-overdue first, capped at 10', async () => {
      const now = Date.now();
      tasks.findAll.mockResolvedValue([
        { title: 'Älteste', dueDate: new Date(now - 2 * 86_400_000), caseId: 'case_1' },
        { title: 'Kein Datum', dueDate: null, caseId: 'case_2' },
        { title: 'Noch nicht fällig', dueDate: new Date(now + 86_400_000), caseId: 'case_3' },
        { title: 'Neuere', dueDate: new Date(now - 86_400_000), caseId: 'case_4' },
      ]);

      const result = await registry.execute('list_overdue_tasks', {}, context);

      expect(tasks.findAll).toHaveBeenCalledWith('tenant_1', { status: 'OPEN' });
      expect(result).toEqual([
        { title: 'Älteste', dueDate: expect.any(Date), caseId: 'case_1' },
        { title: 'Neuere', dueDate: expect.any(Date), caseId: 'case_4' },
      ]);
    });
  });

  describe('list_failed_agent_runs', () => {
    it('queries only FAILED runs, newest first, capped at 10, and returns the summary fields', async () => {
      const now = Date.now();
      scopedAgentRun.findMany.mockResolvedValue([
        { agentType: 'SALES', status: 'FAILED', errorMessage: 'neuer', startedAt: new Date(now), caseId: 'case_3' },
        { agentType: 'FINANCE', status: 'FAILED', errorMessage: 'älter', startedAt: new Date(now - 60_000), caseId: 'case_1' },
      ]);

      const result = await registry.execute('list_failed_agent_runs', {}, context);

      expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
      expect(scopedAgentRun.findMany).toHaveBeenCalledWith({
        where: { status: 'FAILED' },
        orderBy: { startedAt: 'desc' },
        take: 10,
      });
      expect(result).toEqual([
        { agentType: 'SALES', errorMessage: 'neuer', startedAt: expect.any(Date), caseId: 'case_3' },
        { agentType: 'FINANCE', errorMessage: 'älter', startedAt: expect.any(Date), caseId: 'case_1' },
      ]);
    });
  });

  describe('list_open_approvals', () => {
    it('returns at most 10 pending approvals with only the summary fields', async () => {
      const many = Array.from({ length: 15 }, (_, i) => ({
        id: `a${i}`,
        policyAction: 'invoice.approve',
        entityType: 'INVOICE',
        reason: `reason ${i}`,
        requestedAt: new Date(),
        decidedAt: null,
      }));
      approvals.findAll.mockResolvedValue(many);

      const result = (await registry.execute('list_open_approvals', {}, context)) as unknown[];

      expect(result).toHaveLength(10);
      expect(result[0]).toEqual(
        expect.objectContaining({ policyAction: 'invoice.approve', entityType: 'INVOICE', reason: 'reason 0' }),
      );
      expect(result[0]).not.toHaveProperty('id');
    });
  });

  describe('get_case', () => {
    it('returns only the summary fields for the requested case', async () => {
      cases.findOne.mockResolvedValue({
        id: 'case_1',
        title: 'Rechnung prüfen',
        type: 'FINANCE',
        status: 'OPEN',
        description: 'internal detail',
      });

      const result = await registry.execute('get_case', { caseId: 'case_1' }, context);

      expect(cases.findOne).toHaveBeenCalledWith('tenant_1', 'case_1');
      expect(result).toEqual({ id: 'case_1', title: 'Rechnung prüfen', type: 'FINANCE', status: 'OPEN' });
    });
  });
});
