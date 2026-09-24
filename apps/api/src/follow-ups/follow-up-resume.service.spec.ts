import { Test } from '@nestjs/testing';
import { ToolRegistry } from '@orbit/agent-core';
import { z } from 'zod';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowRunnerService } from '../workflows/workflow-runner.service';
import { FollowUpResumeService } from './follow-up-resume.service';

describe('FollowUpResumeService', () => {
  let service: FollowUpResumeService;
  let scoped: {
    toolInvocation: { findFirst: jest.Mock; findMany: jest.Mock };
    workflowStepRun: { findFirst: jest.Mock; findMany: jest.Mock };
    workflowRun: { findUnique: jest.Mock; update: jest.Mock };
    approval: { count: jest.Mock };
  };
  let approvals: { findOne: jest.Mock; markDecided: jest.Mock };
  let agentRuns: { recordToolCalls: jest.Mock };
  let workflowRunner: { resumeFromStep: jest.Mock; markRejected: jest.Mock };
  let execute: jest.Mock;
  let toolRegistry: ToolRegistry;

  const PENDING_FOLLOW_UP = {
    id: 'approval_1',
    entityType: 'FOLLOW_UP',
    entityId: 'tc_1',
    status: 'PENDING',
    policyAction: 'transfer_invoice_to_finance',
  };

  beforeEach(async () => {
    scoped = {
      toolInvocation: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      workflowStepRun: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      workflowRun: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue(undefined) },
      approval: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };

    approvals = {
      findOne: jest.fn().mockResolvedValue(PENDING_FOLLOW_UP),
      markDecided: jest.fn().mockResolvedValue(undefined),
    };
    agentRuns = { recordToolCalls: jest.fn().mockResolvedValue(undefined) };
    workflowRunner = { resumeFromStep: jest.fn().mockResolvedValue(undefined), markRejected: jest.fn().mockResolvedValue(undefined) };

    execute = jest.fn().mockResolvedValue({ transferred: true });
    toolRegistry = new ToolRegistry();
    toolRegistry.register({
      name: 'transfer_invoice_to_finance',
      description: 'Transfers an invoice.',
      inputSchema: z.object({ invoiceId: z.string() }),
      policyAction: 'invoice.transfer_to_fibu',
      execute,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        FollowUpResumeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalsService, useValue: approvals },
        { provide: AgentRunRecorderService, useValue: agentRuns },
        { provide: WorkflowRunnerService, useValue: workflowRunner },
        { provide: TOOL_REGISTRY, useValue: toolRegistry },
      ],
    }).compile();

    service = moduleRef.get(FollowUpResumeService);
  });

  describe('approve()', () => {
    it('rejects when the approval is not a PENDING FOLLOW_UP entry', async () => {
      approvals.findOne.mockResolvedValue({ ...PENDING_FOLLOW_UP, status: 'APPROVED' });
      await expect(service.approve('tenant_1', 'user_1', 'approval_1')).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });

      approvals.findOne.mockResolvedValue({ ...PENDING_FOLLOW_UP, entityType: 'SUPPLIER' });
      await expect(service.approve('tenant_1', 'user_1', 'approval_1')).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    });

    it('throws NotFoundError when no BLOCKED_AWAITING_APPROVAL ToolInvocation matches the approval', async () => {
      scoped.toolInvocation.findFirst.mockResolvedValue(null);
      await expect(service.approve('tenant_1', 'user_1', 'approval_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('executes the originally blocked tool call with its captured input, records it, and marks the approval APPROVED — direct (non-workflow) call', async () => {
      scoped.toolInvocation.findFirst.mockResolvedValue({
        toolCallId: 'tc_1',
        toolName: 'transfer_invoice_to_finance',
        agentRunId: 'run_1',
        input: { invoiceId: 'inv_1' },
      });
      scoped.workflowStepRun.findFirst.mockResolvedValue(null); // not part of any WorkflowRun

      await service.approve('tenant_1', 'user_1', 'approval_1');

      expect(execute).toHaveBeenCalledWith({ invoiceId: 'inv_1' }, { tenantId: 'tenant_1', agentRunId: 'run_1', actorUserId: 'user_1' });
      expect(agentRuns.recordToolCalls).toHaveBeenCalledWith('tenant_1', 'run_1', [
        expect.objectContaining({ toolCallId: 'tc_1', toolName: 'transfer_invoice_to_finance', decision: 'ALLOW', output: { transferred: true } }),
      ]);
      expect(approvals.markDecided).toHaveBeenCalledWith('tenant_1', 'FOLLOW_UP', 'tc_1', 'user_1', 'APPROVED');
      expect(workflowRunner.resumeFromStep).not.toHaveBeenCalled();
    });

    it('resumes the remaining workflow steps when no other approval from the same run is still pending', async () => {
      scoped.toolInvocation.findFirst.mockResolvedValue({
        toolCallId: 'tc_1',
        toolName: 'transfer_invoice_to_finance',
        agentRunId: 'run_1',
        input: { invoiceId: 'inv_1' },
      });
      scoped.workflowStepRun.findFirst.mockResolvedValue({ workflowRunId: 'wfr_1', stepOrder: 2 });
      scoped.workflowStepRun.findMany.mockResolvedValue([{ agentRunId: 'run_1' }]);
      scoped.toolInvocation.findMany.mockResolvedValue([]); // no other BLOCKED_AWAITING_APPROVAL rows
      scoped.workflowRun.findUnique.mockResolvedValue({ id: 'wfr_1', contextSnapshot: { trigger: { input: {} }, steps: {} }, input: {} });

      await service.approve('tenant_1', 'user_1', 'approval_1');

      expect(workflowRunner.resumeFromStep).toHaveBeenCalledWith(
        'tenant_1',
        'user_1',
        'wfr_1',
        3,
        expect.objectContaining({ steps: { 2: { output: { transfer_invoice_to_finance: { transferred: true } } } } }),
      );
    });

    it('does not resume the run yet when another approval from the same run is still pending — merges into the snapshot instead', async () => {
      scoped.toolInvocation.findFirst.mockResolvedValue({
        toolCallId: 'tc_1',
        toolName: 'transfer_invoice_to_finance',
        agentRunId: 'run_1',
        input: { invoiceId: 'inv_1' },
      });
      scoped.workflowStepRun.findFirst.mockResolvedValue({ workflowRunId: 'wfr_1', stepOrder: 2 });
      scoped.workflowStepRun.findMany.mockResolvedValue([{ agentRunId: 'run_1' }]);
      scoped.toolInvocation.findMany.mockResolvedValue([{ toolCallId: 'tc_other' }]);
      scoped.approval.count.mockResolvedValue(1); // tc_other is still PENDING
      scoped.workflowRun.findUnique.mockResolvedValue({ id: 'wfr_1', contextSnapshot: { trigger: { input: {} }, steps: {} }, input: {} });

      await service.approve('tenant_1', 'user_1', 'approval_1');

      expect(workflowRunner.resumeFromStep).not.toHaveBeenCalled();
      expect(scoped.workflowRun.update).toHaveBeenCalledWith({
        where: { id: 'wfr_1' },
        data: { contextSnapshot: expect.objectContaining({ steps: { 2: { output: { transfer_invoice_to_finance: { transferred: true } } } } }) },
      });
    });

    it('marks the workflow FAILED (and does not resume) when the resumed tool call itself throws', async () => {
      execute.mockRejectedValue(new Error('DATEV unavailable'));
      scoped.toolInvocation.findFirst.mockResolvedValue({
        toolCallId: 'tc_1',
        toolName: 'transfer_invoice_to_finance',
        agentRunId: 'run_1',
        input: { invoiceId: 'inv_1' },
      });
      scoped.workflowStepRun.findFirst.mockResolvedValue({ workflowRunId: 'wfr_1', stepOrder: 2 });

      await service.approve('tenant_1', 'user_1', 'approval_1');

      expect(agentRuns.recordToolCalls).toHaveBeenCalledWith('tenant_1', 'run_1', [expect.objectContaining({ error: 'DATEV unavailable' })]);
      expect(workflowRunner.resumeFromStep).not.toHaveBeenCalled();
      expect(scoped.workflowRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wfr_1' }, data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });
  });

  describe('reject()', () => {
    it('marks the approval REJECTED without executing anything', async () => {
      await service.reject('tenant_1', 'user_1', 'approval_1');

      expect(approvals.markDecided).toHaveBeenCalledWith('tenant_1', 'FOLLOW_UP', 'tc_1', 'user_1', 'REJECTED');
      expect(execute).not.toHaveBeenCalled();
    });

    it('marks the WorkflowRun REJECTED when the blocked call was part of one', async () => {
      scoped.toolInvocation.findFirst.mockResolvedValue({ toolCallId: 'tc_1', toolName: 'transfer_invoice_to_finance', agentRunId: 'run_1' });
      scoped.workflowStepRun.findFirst.mockResolvedValue({ workflowRunId: 'wfr_1', stepOrder: 2 });

      await service.reject('tenant_1', 'user_1', 'approval_1');

      expect(workflowRunner.markRejected).toHaveBeenCalledWith('tenant_1', 'wfr_1');
    });
  });
});
