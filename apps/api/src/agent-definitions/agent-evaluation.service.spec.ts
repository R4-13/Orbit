import { Test } from '@nestjs/testing';
import { AgentRuntime } from '@orbit/agent-core';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDefinitionResolverService } from './agent-definition-resolver.service';
import { AgentEvaluationService } from './agent-evaluation.service';

describe('AgentEvaluationService', () => {
  let service: AgentEvaluationService;
  let scoped: { agentEvaluationCase: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; delete: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };
  let resolver: { resolveCandidate: jest.Mock };
  let runs: { start: jest.Mock; recordToolCalls: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let approvals: { create: jest.Mock };

  const candidate = { systemPrompt: 'p', allowedTools: ['create_company'], baseType: 'SALES' as const };

  function fakeRuntime(outcomes: Array<{ toolCallId: string; toolName: string; decision: string; output?: unknown }>) {
    return {
      runTurn: jest.fn().mockResolvedValue({ finalText: undefined, toolCallOutcomes: outcomes, iterations: 1 }),
    } as unknown as AgentRuntime;
  }

  beforeEach(async () => {
    scoped = {
      agentEvaluationCase: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    resolver = { resolveCandidate: jest.fn() };
    runs = {
      start: jest.fn().mockResolvedValue({ id: 'run_1' }),
      recordToolCalls: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    approvals = { create: jest.fn().mockResolvedValue({ id: 'approval_1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentEvaluationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: AgentDefinitionResolverService, useValue: resolver },
        { provide: AgentRunRecorderService, useValue: runs },
        { provide: ApprovalsService, useValue: approvals },
      ],
    }).compile();

    service = moduleRef.get(AgentEvaluationService);
  });

  describe('createCase / deleteCase', () => {
    it('creates a case with defaults for optional fields and records AGENT_EVALUATION_CASE_CREATED', async () => {
      scoped.agentEvaluationCase.create.mockResolvedValue({ id: 'case_1', name: 'Happy path', critical: false });

      await service.createCase('tenant_1', 'user_1', 'sales-intake', { name: 'Happy path', userMessage: 'hi' });

      expect(scoped.agentEvaluationCase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant_1',
          agentDefinitionKey: 'sales-intake',
          name: 'Happy path',
          userMessage: 'hi',
          expectedTools: [],
          forbiddenTools: [],
          expectedApprovalRequired: null,
          critical: false,
          createdByUserId: 'user_1',
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'AGENT_EVALUATION_CASE_CREATED' }));
    });

    it('throws NotFoundError deleting a case that does not belong to this agentDefinitionKey', async () => {
      scoped.agentEvaluationCase.findFirst.mockResolvedValue(null);
      await expect(service.deleteCase('tenant_1', 'user_1', 'sales-intake', 'case_1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(scoped.agentEvaluationCase.delete).not.toHaveBeenCalled();
    });

    it('deletes an existing case and records AGENT_EVALUATION_CASE_DELETED', async () => {
      scoped.agentEvaluationCase.findFirst.mockResolvedValue({ id: 'case_1', name: 'Happy path' });
      await service.deleteCase('tenant_1', 'user_1', 'sales-intake', 'case_1');
      expect(scoped.agentEvaluationCase.delete).toHaveBeenCalledWith({ where: { id: 'case_1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'AGENT_EVALUATION_CASE_DELETED' }));
    });
  });

  describe('runSuite / expectation checks', () => {
    it('passes when expected tools were called and forbidden tools were not', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        {
          id: 'case_1',
          name: 'Creates a company',
          userMessage: 'x',
          expectedTools: ['create_company'],
          forbiddenTools: ['create_lead'],
          expectedApprovalRequired: null,
          critical: false,
        },
      ]);
      resolver.resolveCandidate.mockReturnValue({
        systemPrompt: 'layered',
        baseType: 'SALES',
        runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'create_company', decision: 'ALLOW' }]),
      });

      const results = await service.runSuite('tenant_1', 'user_1', 'sales-intake', candidate);

      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.failures).toEqual([]);
    });

    it('fails when an expected tool was not called', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        {
          id: 'case_1',
          name: 'Creates a company',
          userMessage: 'x',
          expectedTools: ['create_company'],
          forbiddenTools: [],
          expectedApprovalRequired: null,
          critical: false,
        },
      ]);
      resolver.resolveCandidate.mockReturnValue({ systemPrompt: 'layered', baseType: 'SALES', runtime: fakeRuntime([]) });

      const results = await service.runSuite('tenant_1', 'user_1', 'sales-intake', candidate);

      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.failures[0]).toContain('create_company');
    });

    it('fails when a forbidden tool was called', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        {
          id: 'case_1',
          name: 'Never deletes',
          userMessage: 'x',
          expectedTools: [],
          forbiddenTools: ['create_lead'],
          expectedApprovalRequired: null,
          critical: false,
        },
      ]);
      resolver.resolveCandidate.mockReturnValue({
        systemPrompt: 'layered',
        baseType: 'SALES',
        runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'create_lead', decision: 'ALLOW' }]),
      });

      const results = await service.runSuite('tenant_1', 'user_1', 'sales-intake', candidate);

      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.failures[0]).toContain('create_lead');
    });

    it('checks expectedApprovalRequired against whether any outcome was non-ALLOW', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        {
          id: 'case_1',
          name: 'Requires approval',
          userMessage: 'x',
          expectedTools: [],
          forbiddenTools: [],
          expectedApprovalRequired: true,
          critical: false,
        },
      ]);
      resolver.resolveCandidate.mockReturnValue({
        systemPrompt: 'layered',
        baseType: 'FINANCE',
        runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'transfer_invoice_to_finance', decision: 'ALLOW' }]),
      });

      const results = await service.runSuite('tenant_1', 'user_1', 'finance-intake', candidate);

      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.failures[0]).toContain('Freigabe-Anforderung erwartet');
    });

    it('creates a FOLLOW_UP approval for a blocked outcome, same as a real test-run', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        {
          id: 'case_1',
          name: 'Requires approval',
          userMessage: 'x',
          expectedTools: [],
          forbiddenTools: [],
          expectedApprovalRequired: true,
          critical: false,
        },
      ]);
      resolver.resolveCandidate.mockReturnValue({
        systemPrompt: 'layered',
        baseType: 'FINANCE',
        runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'transfer_invoice_to_finance', decision: 'REQUIRE_APPROVAL' }]),
      });

      await service.runSuite('tenant_1', 'user_1', 'finance-intake', candidate);

      expect(approvals.create).toHaveBeenCalledWith(
        'tenant_1',
        expect.objectContaining({ entityType: 'FOLLOW_UP', entityId: 'tc_1', policyAction: 'transfer_invoice_to_finance' }),
      );
    });

    it('fails the case (without throwing) and marks the run failed when the runtime itself throws', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        { id: 'case_1', name: 'Crashes', userMessage: 'x', expectedTools: [], forbiddenTools: [], expectedApprovalRequired: null, critical: false },
      ]);
      resolver.resolveCandidate.mockReturnValue({
        systemPrompt: 'layered',
        baseType: 'SALES',
        runtime: { runTurn: jest.fn().mockRejectedValue(new Error('boom')) } as unknown as AgentRuntime,
      });

      const results = await service.runSuite('tenant_1', 'user_1', 'sales-intake', candidate);

      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.failures[0]).toContain('boom');
      expect(runs.fail).toHaveBeenCalledWith('tenant_1', 'run_1', 'boom');
    });
  });

  describe('assertCriticalCasesPass', () => {
    it('does not run anything when there are no critical cases', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        { id: 'case_1', name: 'Non-critical', userMessage: 'x', expectedTools: ['x'], forbiddenTools: [], expectedApprovalRequired: null, critical: false },
      ]);

      await expect(service.assertCriticalCasesPass('tenant_1', 'user_1', 'sales-intake', candidate)).resolves.toBeUndefined();
      expect(resolver.resolveCandidate).not.toHaveBeenCalled();
    });

    it('throws ValidationFailedError listing every failing critical case', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        { id: 'case_1', name: 'Critical A', userMessage: 'x', expectedTools: ['create_company'], forbiddenTools: [], expectedApprovalRequired: null, critical: true },
        { id: 'case_2', name: 'Critical B (passes)', userMessage: 'x', expectedTools: [], forbiddenTools: [], expectedApprovalRequired: null, critical: true },
      ]);
      resolver.resolveCandidate.mockReturnValue({ systemPrompt: 'layered', baseType: 'SALES', runtime: fakeRuntime([]) });

      await expect(service.assertCriticalCasesPass('tenant_1', 'user_1', 'sales-intake', candidate)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: expect.objectContaining({ failed: [expect.objectContaining({ name: 'Critical A' })] }),
      });
    });

    it('resolves when every critical case passes', async () => {
      scoped.agentEvaluationCase.findMany.mockResolvedValue([
        { id: 'case_1', name: 'Critical A', userMessage: 'x', expectedTools: [], forbiddenTools: [], expectedApprovalRequired: null, critical: true },
      ]);
      resolver.resolveCandidate.mockReturnValue({ systemPrompt: 'layered', baseType: 'SALES', runtime: fakeRuntime([]) });

      await expect(service.assertCriticalCasesPass('tenant_1', 'user_1', 'sales-intake', candidate)).resolves.toBeUndefined();
    });
  });
});
