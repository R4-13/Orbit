import { Test } from '@nestjs/testing';
import { AgentRuntime } from '@orbit/agent-core';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AgentDefinitionResolverService } from './agent-definition-resolver.service';
import { AgentDefinitionTestRunService } from './agent-definition-test-run.service';

describe('AgentDefinitionTestRunService', () => {
  let service: AgentDefinitionTestRunService;
  let resolver: { resolveForTestRun: jest.Mock };
  let runs: { start: jest.Mock; recordToolCalls: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let approvals: { create: jest.Mock };

  function fakeRuntime(outcomes: Array<{ toolCallId: string; toolName: string; decision: string; output?: unknown }>) {
    return {
      runTurn: jest.fn().mockResolvedValue({ finalText: undefined, toolCallOutcomes: outcomes, iterations: 1 }),
    } as unknown as AgentRuntime;
  }

  beforeEach(async () => {
    resolver = { resolveForTestRun: jest.fn() };
    runs = {
      start: jest.fn().mockResolvedValue({ id: 'run_1' }),
      recordToolCalls: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    approvals = { create: jest.fn().mockResolvedValue({ id: 'approval_1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentDefinitionTestRunService,
        { provide: AgentDefinitionResolverService, useValue: resolver },
        { provide: AgentRunRecorderService, useValue: runs },
        { provide: ApprovalsService, useValue: approvals },
      ],
    }).compile();

    service = moduleRef.get(AgentDefinitionTestRunService);
  });

  it('starts a MANUAL AgentRun using the resolved baseType, runs the turn, and completes it', async () => {
    resolver.resolveForTestRun.mockResolvedValue({
      systemPrompt: 'Du bist ein Test-Agent.',
      baseType: 'SALES',
      runtime: fakeRuntime([{ toolCallId: 'tc_1', toolName: 'create_company', decision: 'ALLOW', output: { id: 'c_1' } }]),
    });

    const result = await service.run('tenant_1', 'user_1', 'custom-agent', 'Test-Nachricht');

    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_1', agentType: 'SALES', triggerType: 'MANUAL' }),
    );
    expect(runs.recordToolCalls).toHaveBeenCalledWith('tenant_1', 'run_1', expect.any(Array));
    expect(runs.complete).toHaveBeenCalled();
    expect(result.agentRunId).toBe('run_1');
    expect(result.toolCallOutcomes).toHaveLength(1);
  });

  it('creates a FOLLOW_UP approval for a blocked (non-ALLOW, non-DENY) tool call', async () => {
    resolver.resolveForTestRun.mockResolvedValue({
      systemPrompt: 'x',
      baseType: 'FINANCE',
      runtime: fakeRuntime([
        { toolCallId: 'tc_1', toolName: 'transfer_invoice_to_finance', decision: 'REQUIRE_APPROVAL' },
      ]),
    });

    await service.run('tenant_1', 'user_1', 'finance-intake', 'Test-Nachricht');

    expect(approvals.create).toHaveBeenCalledWith(
      'tenant_1',
      expect.objectContaining({
        entityType: 'FOLLOW_UP',
        entityId: 'tc_1',
        policyAction: 'transfer_invoice_to_finance',
        requestedByUserId: 'user_1',
      }),
    );
  });

  it('does not create an approval for ALLOW or DENY outcomes', async () => {
    resolver.resolveForTestRun.mockResolvedValue({
      systemPrompt: 'x',
      baseType: 'SALES',
      runtime: fakeRuntime([
        { toolCallId: 'tc_1', toolName: 'create_company', decision: 'ALLOW' },
        { toolCallId: 'tc_2', toolName: 'create_contact', decision: 'DENY' },
      ]),
    });

    await service.run('tenant_1', 'user_1', 'sales-intake', 'x');

    expect(approvals.create).not.toHaveBeenCalled();
  });

  it('marks the run as failed and rethrows when the runtime throws', async () => {
    const failingRuntime = { runTurn: jest.fn().mockRejectedValue(new Error('boom')) } as unknown as AgentRuntime;
    resolver.resolveForTestRun.mockResolvedValue({ systemPrompt: 'x', baseType: 'SALES', runtime: failingRuntime });

    await expect(service.run('tenant_1', 'user_1', 'sales-intake', 'x')).rejects.toThrow('boom');
    expect(runs.fail).toHaveBeenCalledWith('tenant_1', 'run_1', 'boom');
    expect(runs.complete).not.toHaveBeenCalled();
  });
});
