import { Test } from '@nestjs/testing';
import { AgentRuntime } from '@orbit/agent-core';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { CopilotConversationService } from './copilot-conversation.service';
import { CopilotRuntimeService } from './copilot-runtime.service';

describe('CopilotRuntimeService', () => {
  let service: CopilotRuntimeService;
  let scoped: {
    conversationMessage: { findMany: jest.Mock; create: jest.Mock };
    conversation: { update: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };
  let conversations: { getConversation: jest.Mock };
  let toolRegistry: { subset: jest.Mock };
  let aiProviders: { resolveForTenant: jest.Mock };
  let policy: { resolveMode: jest.Mock };
  let runs: { start: jest.Mock; recordToolCalls: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let approvals: { create: jest.Mock };

  function fakeRuntimeReturning(finalText: string | undefined, toolCallOutcomes: unknown[] = []) {
    return { runTurn: jest.fn().mockResolvedValue({ finalText, toolCallOutcomes, iterations: 1 }) } as unknown as AgentRuntime;
  }

  beforeEach(async () => {
    scoped = {
      conversationMessage: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      conversation: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    conversations = { getConversation: jest.fn().mockResolvedValue({ id: 'conv_1', userId: 'user_1' }) };
    toolRegistry = { subset: jest.fn() };
    aiProviders = { resolveForTenant: jest.fn() };
    policy = { resolveMode: jest.fn() };
    runs = {
      start: jest.fn().mockResolvedValue({ id: 'run_1' }),
      recordToolCalls: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    approvals = { create: jest.fn().mockResolvedValue({ id: 'approval_1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CopilotRuntimeService,
        { provide: CopilotConversationService, useValue: conversations },
        { provide: PrismaService, useValue: prisma },
        { provide: TOOL_REGISTRY, useValue: toolRegistry },
        { provide: AiProviderResolverService, useValue: aiProviders },
        { provide: PolicyEnforcementService, useValue: policy },
        { provide: AgentRunRecorderService, useValue: runs },
        { provide: ApprovalsService, useValue: approvals },
      ],
    }).compile();

    service = moduleRef.get(CopilotRuntimeService);
  });

  it('rejects a message for a conversation the caller does not own (delegates to CopilotConversationService)', async () => {
    conversations.getConversation.mockRejectedValue(Object.assign(new Error('not found'), { code: 'NOT_FOUND' }));
    await expect(service.sendMessage('tenant_1', 'user_1', 'conv_1', 'Hallo')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('persists the user message, runs the turn scoped to the ASK tool subset, and persists the assistant reply', async () => {
    const scopedRuntime = fakeRuntimeReturning('Es gibt aktuell 3 offene Freigaben.');
    toolRegistry.subset.mockReturnValue('scoped-tools');
    aiProviders.resolveForTenant.mockResolvedValue({ providerName: 'mock', complete: jest.fn() });
    scoped.conversationMessage.create.mockResolvedValueOnce({ id: 'user_msg' }).mockResolvedValueOnce({
      id: 'assistant_msg',
      role: 'ASSISTANT',
      content: 'Es gibt aktuell 3 offene Freigaben.',
    });

    // AgentRuntime is constructed internally with `new` — spy on runTurn via the fake instance
    // by intercepting the constructor is not possible without DI, so assert on side effects instead.
    jest.spyOn(AgentRuntime.prototype, 'runTurn').mockImplementation(scopedRuntime.runTurn);

    const result = await service.sendMessage('tenant_1', 'user_1', 'conv_1', 'Wie viele Freigaben stehen aus?');

    expect(toolRegistry.subset).toHaveBeenCalledWith([
      'get_dashboard_summary',
      'list_open_approvals',
      'get_case',
      'draft_email',
      'create_meeting',
      'create_booking_proposal',
      'create_task',
      'create_contact',
      'create_lead',
      'send_email',
    ]);
    expect(scoped.conversationMessage.create).toHaveBeenNthCalledWith(1, {
      data: { tenantId: 'tenant_1', conversationId: 'conv_1', userId: 'user_1', role: 'USER', content: 'Wie viele Freigaben stehen aus?' },
    });
    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_1', agentType: 'ORCHESTRATOR', triggerType: 'MANUAL' }),
    );
    expect(runs.complete).toHaveBeenCalled();
    expect(scoped.conversationMessage.create).toHaveBeenNthCalledWith(2, {
      data: {
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        role: 'ASSISTANT',
        content: 'Es gibt aktuell 3 offene Freigaben.',
        agentRunId: 'run_1',
      },
    });
    expect(scoped.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { lastMessageAt: expect.any(Date) },
    });
    expect(result.content).toBe('Es gibt aktuell 3 offene Freigaben.');
  });

  it('creates a FOLLOW_UP approval for a blocked (non-ALLOW, non-DENY) tool call', async () => {
    toolRegistry.subset.mockReturnValue('scoped-tools');
    aiProviders.resolveForTenant.mockResolvedValue({ providerName: 'mock', complete: jest.fn() });
    scoped.conversationMessage.create.mockResolvedValue({ id: 'assistant_msg' });
    jest.spyOn(AgentRuntime.prototype, 'runTurn').mockResolvedValue({
      finalText: 'x',
      toolCallOutcomes: [{ toolCallId: 'tc_1', toolName: 'get_case', decision: 'REQUIRE_APPROVAL' }],
      iterations: 1,
    });

    await service.sendMessage('tenant_1', 'user_1', 'conv_1', 'x');

    expect(approvals.create).toHaveBeenCalledWith(
      'tenant_1',
      expect.objectContaining({ entityType: 'FOLLOW_UP', entityId: 'tc_1', policyAction: 'get_case' }),
    );
  });

  it('streamMessage forwards tool.started/tool.completed events, then a final message.completed with the persisted message', async () => {
    toolRegistry.subset.mockReturnValue('scoped-tools');
    aiProviders.resolveForTenant.mockResolvedValue({ providerName: 'mock', complete: jest.fn() });
    scoped.conversationMessage.create.mockResolvedValueOnce({ id: 'user_msg' }).mockResolvedValueOnce({
      id: 'assistant_msg',
      role: 'ASSISTANT',
      content: 'Drei offene Freigaben.',
    });
    jest.spyOn(AgentRuntime.prototype, 'runTurn').mockImplementation(async (_context, input) => {
      input.onEvent?.({ type: 'tool.started', toolCallId: 'tc_1', toolName: 'list_open_approvals' });
      input.onEvent?.({ type: 'tool.completed', toolCallId: 'tc_1', toolName: 'list_open_approvals', decision: 'ALLOW' });
      return { finalText: 'Drei offene Freigaben.', toolCallOutcomes: [], iterations: 1 };
    });

    const emitted: unknown[] = [];
    await service.streamMessage('tenant_1', 'user_1', 'conv_1', 'x', (event) => emitted.push(event));

    expect(emitted).toEqual([
      { type: 'tool.started', data: { toolName: 'list_open_approvals' } },
      { type: 'tool.completed', data: { toolName: 'list_open_approvals', decision: 'ALLOW', error: undefined } },
      { type: 'message.completed', data: { id: 'assistant_msg', role: 'ASSISTANT', content: 'Drei offene Freigaben.' } },
    ]);
  });

  it('streamMessage emits an error event instead of throwing when the turn setup itself fails', async () => {
    conversations.getConversation.mockRejectedValue(Object.assign(new Error('not found'), { code: 'NOT_FOUND' }));

    const emitted: unknown[] = [];
    await service.streamMessage('tenant_1', 'user_1', 'conv_1', 'x', (event) => emitted.push(event));

    expect(emitted).toEqual([{ type: 'error', data: { message: 'not found' } }]);
  });

  it('falls back to the prescribed provider-unavailable message and marks the run failed when the runtime throws', async () => {
    toolRegistry.subset.mockReturnValue('scoped-tools');
    aiProviders.resolveForTenant.mockResolvedValue({ providerName: 'mock', complete: jest.fn() });
    scoped.conversationMessage.create.mockResolvedValue({
      id: 'assistant_msg',
      content: 'Der KI-Dienst ist momentan nicht verfügbar. Ich habe keine Aktion ausgeführt.',
    });
    jest.spyOn(AgentRuntime.prototype, 'runTurn').mockRejectedValue(new Error('provider down'));

    const result = await service.sendMessage('tenant_1', 'user_1', 'conv_1', 'x');

    expect(runs.fail).toHaveBeenCalledWith('tenant_1', 'run_1', 'provider down');
    expect(scoped.conversationMessage.create).toHaveBeenNthCalledWith(2, {
      data: {
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        role: 'ASSISTANT',
        content: 'Der KI-Dienst ist momentan nicht verfügbar. Ich habe keine Aktion ausgeführt.',
        agentRunId: 'run_1',
      },
    });
    expect(result.content).toContain('nicht verfügbar');
  });
});
