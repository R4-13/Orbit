import { Test } from '@nestjs/testing';
import { ToolRegistry } from '@orbit/agent-core';
import { ApprovalsService } from '../../approvals/approvals.service';
import { CasesService } from '../../cases/cases.service';
import { TasksService } from '../../tasks/tasks.service';
import { SondeTools } from './sonde.tools';

describe('SondeTools', () => {
  let tools: SondeTools;
  let cases: { findAll: jest.Mock; findOne: jest.Mock };
  let tasks: { findAll: jest.Mock };
  let approvals: { findAll: jest.Mock };
  let registry: ToolRegistry;

  const context = { tenantId: 'tenant_1', agentRunId: 'run_1' };

  beforeEach(async () => {
    cases = { findAll: jest.fn(), findOne: jest.fn() };
    tasks = { findAll: jest.fn() };
    approvals = { findAll: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SondeTools,
        { provide: CasesService, useValue: cases },
        { provide: TasksService, useValue: tasks },
        { provide: ApprovalsService, useValue: approvals },
      ],
    }).compile();

    tools = moduleRef.get(SondeTools);
    registry = new ToolRegistry();
    tools.register(registry);
  });

  it('registers exactly the three ASK-mode tools, all gated by COPILOT_READ', () => {
    const definitions = registry.list();
    expect(definitions.map((d) => d.name).sort()).toEqual(['get_case', 'get_dashboard_summary', 'list_open_approvals']);
    for (const def of definitions) {
      expect(def.policyAction).toBe('copilot.read');
    }
  });

  describe('get_dashboard_summary', () => {
    it('counts open cases, open tasks, and pending approvals', async () => {
      cases.findAll.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      tasks.findAll.mockResolvedValue([{ id: 't1' }]);
      approvals.findAll.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);

      const result = await registry.execute('get_dashboard_summary', {}, context);

      expect(cases.findAll).toHaveBeenCalledWith('tenant_1', {});
      expect(tasks.findAll).toHaveBeenCalledWith('tenant_1', { status: 'OPEN' });
      expect(approvals.findAll).toHaveBeenCalledWith('tenant_1', { status: 'PENDING' });
      expect(result).toEqual({ openCasesCount: 2, openTasksCount: 1, pendingApprovalsCount: 3 });
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
