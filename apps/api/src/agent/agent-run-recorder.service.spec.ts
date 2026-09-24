import { Test } from '@nestjs/testing';
import type { ToolCallOutcome } from '@orbit/agent-core';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TOOL_REGISTRY } from './agent.tokens';
import { AgentRunRecorderService } from './agent-run-recorder.service';

/**
 * docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md, Phase 1 — this file didn't
 * exist before; `recordToolCalls()` had a real, previously undetected
 * bug (`toolCallId`/`input` never written despite existing schema
 * columns, `status` always SUCCESS/FAILED even though
 * `ToolInvocationStatus` has had BLOCKED_AWAITING_APPROVAL/DENIED since
 * Phase 1 of this project). These tests lock in the fix.
 */
describe('AgentRunRecorderService.recordToolCalls', () => {
  let service: AgentRunRecorderService;
  let scoped: { toolInvocation: { create: jest.Mock } };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = { toolInvocation: { create: jest.fn().mockResolvedValue(undefined) } };
    const prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const toolRegistry = { get: jest.fn().mockReturnValue({ policyAction: 'invoice.transfer_to_fibu' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentRunRecorderService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: TOOL_REGISTRY, useValue: toolRegistry },
      ],
    }).compile();

    service = moduleRef.get(AgentRunRecorderService);
  });

  async function record(outcome: ToolCallOutcome) {
    await service.recordToolCalls('tenant_1', 'run_1', [outcome]);
    return scoped.toolInvocation.create.mock.calls[0][0].data;
  }

  it('stores toolCallId and input, and maps decision ALLOW + success to SUCCESS', async () => {
    const data = await record({
      toolCallId: 'tc_1',
      toolName: 'transfer_invoice_to_finance',
      decision: 'ALLOW',
      input: { invoiceId: 'inv_1' },
      output: { ok: true },
    });

    expect(data).toMatchObject({ toolCallId: 'tc_1', input: { invoiceId: 'inv_1' }, status: 'SUCCESS' });
  });

  it('maps decision ALLOW + a thrown error to FAILED', async () => {
    const data = await record({
      toolCallId: 'tc_2',
      toolName: 'transfer_invoice_to_finance',
      decision: 'ALLOW',
      input: {},
      error: 'connector unavailable',
    });

    expect(data.status).toBe('FAILED');
  });

  it.each(['REQUIRE_APPROVAL', 'SUGGEST_ONLY'] as const)('maps decision %s to BLOCKED_AWAITING_APPROVAL — this is what FollowUpsModule relies on to find resumable calls', async (decision) => {
    const data = await record({ toolCallId: 'tc_3', toolName: 'transfer_invoice_to_finance', decision, input: { invoiceId: 'inv_1' } });

    expect(data.status).toBe('BLOCKED_AWAITING_APPROVAL');
    expect(data.input).toEqual({ invoiceId: 'inv_1' });
  });

  it('maps decision DENY to DENIED', async () => {
    const data = await record({ toolCallId: 'tc_4', toolName: 'delete_everything', decision: 'DENY', error: 'Unknown tool.' });

    expect(data.status).toBe('DENIED');
  });
});
