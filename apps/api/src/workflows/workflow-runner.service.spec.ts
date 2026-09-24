import { Test } from '@nestjs/testing';
import type { AgentRuntime } from '@orbit/agent-core';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AgentDefinitionResolverService } from '../agent-definitions/agent-definition-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowRunnerService } from './workflow-runner.service';

function fakeRuntime(outcomes: Array<{ toolCallId: string; toolName: string; decision: string; output?: unknown }>) {
  return { runTurn: jest.fn().mockResolvedValue({ finalText: undefined, toolCallOutcomes: outcomes, iterations: 1 }) } as unknown as AgentRuntime;
}

describe('WorkflowRunnerService', () => {
  let service: WorkflowRunnerService;
  let scoped: {
    workflowDefinition: { findUnique: jest.Mock };
    workflowRun: { create: jest.Mock; update: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    workflowStepRun: { create: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let runs: { start: jest.Mock; recordToolCalls: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let approvals: { create: jest.Mock };

  beforeEach(async () => {
    scoped = {
      workflowDefinition: { findUnique: jest.fn() },
      workflowRun: {
        create: jest.fn().mockResolvedValue({ id: 'wfr_1' }),
        update: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      workflowStepRun: { create: jest.fn().mockResolvedValue(undefined) },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    resolver = { resolve: jest.fn() };
    runs = {
      start: jest.fn().mockResolvedValue({ id: 'run_1' }),
      recordToolCalls: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    approvals = { create: jest.fn().mockResolvedValue({ id: 'approval_1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowRunnerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentDefinitionResolverService, useValue: resolver },
        { provide: AgentRunRecorderService, useValue: runs },
        { provide: ApprovalsService, useValue: approvals },
      ],
    }).compile();

    service = moduleRef.get(WorkflowRunnerService);
  });

  it('throws NotFoundError when no runnable definition exists', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue(null);
    await expect(service.trigger('tenant_1', 'user_1', 'does-not-exist', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NotFoundError when the definition is DISABLED', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue({ id: 'wfd_1', status: 'DISABLED', steps: [] });
    await expect(service.trigger('tenant_1', 'user_1', 'wf-1', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws ValidationFailedError when the definition has no steps', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue({ id: 'wfd_1', status: 'ACTIVE', steps: [] });
    await expect(service.trigger('tenant_1', 'user_1', 'wf-1', {})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('runs a step unconditionally, skips a later step whose condition is not met, and completes', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue({
      id: 'wfd_1',
      status: 'ACTIVE',
      steps: [
        { order: 1, agentDefinitionKey: 'communication-intake', inputMapping: null, condition: null },
        {
          order: 2,
          agentDefinitionKey: 'finance-intake',
          inputMapping: null,
          condition: { field: '$.steps[1].output.classify_message.category', equals: 'FINANCE' },
        },
      ],
    });
    resolver.resolve.mockResolvedValue({
      systemPrompt: 'x',
      baseType: 'COMMUNICATION',
      runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'classify_message', decision: 'ALLOW', output: { category: 'SALES' } }]),
    });

    const result = await service.trigger('tenant_1', 'user_1', 'wf-1', { subject: 'Hallo' });

    expect(result.status).toBe('COMPLETED');
    expect(result.steps).toEqual([
      { order: 1, agentDefinitionKey: 'communication-intake', skipped: false, agentRunId: 'run_1' },
      { order: 2, agentDefinitionKey: 'finance-intake', skipped: true },
    ]);
    // step 2 never resolved an agent since its condition (category === FINANCE) wasn't met (actual: SALES)
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(scoped.workflowStepRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stepOrder: 2, skipped: true }) }),
    );
    expect(scoped.workflowRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
  });

  it('runs a conditional step when the condition matches', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue({
      id: 'wfd_1',
      status: 'ACTIVE',
      steps: [
        { order: 1, agentDefinitionKey: 'communication-intake', inputMapping: null, condition: null },
        {
          order: 2,
          agentDefinitionKey: 'sales-intake',
          inputMapping: { subject: '$.trigger.input.subject' },
          condition: { field: '$.steps[1].output.classify_message.category', equals: 'SALES' },
        },
      ],
    });
    resolver.resolve
      .mockResolvedValueOnce({
        systemPrompt: 'x',
        baseType: 'COMMUNICATION',
        runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'classify_message', decision: 'ALLOW', output: { category: 'SALES' } }]),
      })
      .mockResolvedValueOnce({
        systemPrompt: 'y',
        baseType: 'SALES',
        runtime: fakeRuntime([{ toolCallId: 'tc_2', toolName: 'create_lead', decision: 'ALLOW', output: { id: 'lead_1' } }]),
      });

    const result = await service.trigger('tenant_1', 'user_1', 'wf-1', { subject: 'Interesse' });

    expect(result.status).toBe('COMPLETED');
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenNthCalledWith(2, 'tenant_1', 'sales-intake');
  });

  it('creates a FOLLOW_UP approval for a blocked tool call', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue({
      id: 'wfd_1',
      status: 'ACTIVE',
      steps: [{ order: 1, agentDefinitionKey: 'finance-intake', inputMapping: null, condition: null }],
    });
    resolver.resolve.mockResolvedValue({
      systemPrompt: 'x',
      baseType: 'FINANCE',
      runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'transfer_invoice_to_finance', decision: 'REQUIRE_APPROVAL' }]),
    });

    await service.trigger('tenant_1', 'user_1', 'wf-1', {});

    expect(approvals.create).toHaveBeenCalledWith(
      'tenant_1',
      expect.objectContaining({ entityType: 'FOLLOW_UP', entityId: 'tc_1', policyAction: 'transfer_invoice_to_finance' }),
    );
  });

  it('marks the run FAILED (and stops) when a step cannot be resolved', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue({
      id: 'wfd_1',
      status: 'ACTIVE',
      steps: [
        { order: 1, agentDefinitionKey: 'not-configured', inputMapping: null, condition: null },
        { order: 2, agentDefinitionKey: 'sales-intake', inputMapping: null, condition: null },
      ],
    });
    resolver.resolve.mockRejectedValue(new Error('no ACTIVE agent definition'));

    const result = await service.trigger('tenant_1', 'user_1', 'wf-1', {});

    expect(result.status).toBe('FAILED');
    expect(resolver.resolve).toHaveBeenCalledTimes(1); // never got to step 2
    expect(scoped.workflowRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorMessage: expect.stringContaining('not-configured') }) }),
    );
  });

  it('marks the run FAILED when the agent turn itself throws', async () => {
    scoped.workflowDefinition.findUnique.mockResolvedValue({
      id: 'wfd_1',
      status: 'ACTIVE',
      steps: [{ order: 1, agentDefinitionKey: 'sales-intake', inputMapping: null, condition: null }],
    });
    const failingRuntime = { runTurn: jest.fn().mockRejectedValue(new Error('boom')) } as unknown as AgentRuntime;
    resolver.resolve.mockResolvedValue({ systemPrompt: 'x', baseType: 'SALES', runtime: failingRuntime });

    const result = await service.trigger('tenant_1', 'user_1', 'wf-1', {});

    expect(result.status).toBe('FAILED');
    expect(runs.fail).toHaveBeenCalledWith('tenant_1', 'run_1', 'boom');
  });

  describe('createQueuedRun / executeQueuedRun (docs/SCALABILITY_CONCEPT.md)', () => {
    it('createQueuedRun() creates the run but never resolves an agent or runs a turn', async () => {
      scoped.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wfd_1',
        status: 'ACTIVE',
        steps: [{ order: 1, agentDefinitionKey: 'communication-intake', inputMapping: null, condition: null }],
      });

      const result = await service.createQueuedRun('tenant_1', 'wf-1', { subject: 'x' });

      expect(result).toEqual({ workflowRunId: 'wfr_1' });
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(runs.start).not.toHaveBeenCalled();
    });

    it('createQueuedRun() rejects the same way trigger() does for an unrunnable definition', async () => {
      scoped.workflowDefinition.findUnique.mockResolvedValue(null);
      await expect(service.createQueuedRun('tenant_1', 'does-not-exist', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('executeQueuedRun() throws NotFoundError when the run id does not exist', async () => {
      scoped.workflowRun.findUnique.mockResolvedValue(null);
      await expect(service.executeQueuedRun('tenant_1', 'user_1', 'does-not-exist')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('executeQueuedRun() loads the already-created run + its definition and executes it to completion', async () => {
      scoped.workflowRun.findUnique.mockResolvedValue({
        id: 'wfr_1',
        workflowDefinitionId: 'wfd_1',
        input: { subject: 'Angebot' },
      });
      scoped.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wfd_1',
        steps: [{ order: 1, agentDefinitionKey: 'communication-intake', inputMapping: null, condition: null }],
      });
      resolver.resolve.mockResolvedValue({
        systemPrompt: 'x',
        baseType: 'COMMUNICATION',
        runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'classify_message', decision: 'ALLOW', output: { category: 'SALES' } }]),
      });

      const result = await service.executeQueuedRun('tenant_1', 'user_1', 'wfr_1');

      expect(result.status).toBe('COMPLETED');
      expect(scoped.workflowRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wfr_1' }, data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('trigger() still produces the exact same result as createQueuedRun()+executeQueuedRun() (behavior-preserving split)', async () => {
      scoped.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wfd_1',
        status: 'ACTIVE',
        steps: [{ order: 1, agentDefinitionKey: 'communication-intake', inputMapping: null, condition: null }],
      });
      resolver.resolve.mockResolvedValue({
        systemPrompt: 'x',
        baseType: 'COMMUNICATION',
        runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'classify_message', decision: 'ALLOW', output: {} }]),
      });

      const result = await service.trigger('tenant_1', 'user_1', 'wf-1', { subject: 'x' });

      expect(result.status).toBe('COMPLETED');
      expect(result.workflowRunId).toBe('wfr_1');
      expect(result.steps).toEqual([
        { order: 1, agentDefinitionKey: 'communication-intake', skipped: false, agentRunId: 'run_1' },
      ]);
    });
  });
});
