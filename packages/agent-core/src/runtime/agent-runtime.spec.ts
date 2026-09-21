import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { MockLLMProvider } from '../llm/mock-llm-provider';
import type { LLMCompletionResult } from '../llm/types';
import { ToolRegistry } from '../tools/tool-registry';
import type { ToolDefinition } from '../tools/types';
import { AgentRuntime } from './agent-runtime';

const CONTEXT = { tenantId: 'tenant_1', agentRunId: 'run_1' };

function buildLogActivityTool(execute = vi.fn(async () => ({ logged: true }))): ToolDefinition {
  return {
    name: 'log_activity',
    description: 'Logs a CRM activity.',
    inputSchema: z.object({ summary: z.string() }),
    policyAction: 'crm.activity.log',
    execute,
  };
}

describe('AgentRuntime.runTurn', () => {
  it('returns the final text immediately when the LLM requests no tools', async () => {
    const llm = new MockLLMProvider([{ toolCalls: [], stopReason: 'end_turn', text: 'Alles erledigt.' }]);
    const runtime = new AgentRuntime(llm, new ToolRegistry(), async () => 'AUTONOMOUS');

    const result = await runtime.runTurn(CONTEXT, { messages: [{ role: 'user', content: 'Hi' }] });

    expect(result.finalText).toBe('Alles erledigt.');
    expect(result.toolCallOutcomes).toHaveLength(0);
    expect(result.iterations).toBe(1);
  });

  it('executes a tool when the policy mode is AUTONOMOUS, then finishes on the next turn', async () => {
    const execute = vi.fn(async () => ({ logged: true }));
    const tools = new ToolRegistry();
    tools.register(buildLogActivityTool(execute));

    const llm = new MockLLMProvider([
      {
        toolCalls: [{ toolCallId: 'call_1', toolName: 'log_activity', input: { summary: 'Anruf erledigt' } }],
        stopReason: 'tool_use',
      },
      { toolCalls: [], stopReason: 'end_turn', text: 'Fertig.' },
    ]);

    const runtime = new AgentRuntime(llm, tools, async () => 'AUTONOMOUS');
    const result = await runtime.runTurn(CONTEXT, { messages: [{ role: 'user', content: 'Log the call' }] });

    expect(execute).toHaveBeenCalledWith({ summary: 'Anruf erledigt' }, CONTEXT);
    expect(result.toolCallOutcomes).toEqual([
      { toolCallId: 'call_1', toolName: 'log_activity', decision: 'ALLOW', output: { logged: true } },
    ]);
    expect(result.finalText).toBe('Fertig.');
    expect(result.iterations).toBe(2);
  });

  it('never calls execute() when the policy mode is REQUIRE_APPROVAL', async () => {
    const execute = vi.fn(async () => ({ logged: true }));
    const tools = new ToolRegistry();
    tools.register(buildLogActivityTool(execute));

    const llm = new MockLLMProvider([
      {
        toolCalls: [{ toolCallId: 'call_1', toolName: 'log_activity', input: { summary: 'x' } }],
        stopReason: 'tool_use',
      },
      { toolCalls: [], stopReason: 'end_turn' },
    ]);

    const runtime = new AgentRuntime(llm, tools, async () => 'REQUIRE_APPROVAL');
    const result = await runtime.runTurn(CONTEXT, { messages: [] });

    expect(execute).not.toHaveBeenCalled();
    expect(result.toolCallOutcomes).toEqual([
      { toolCallId: 'call_1', toolName: 'log_activity', decision: 'REQUIRE_APPROVAL' },
    ]);
  });

  it('never calls execute() when the policy mode is DISABLED (decision DENY)', async () => {
    const execute = vi.fn();
    const tools = new ToolRegistry();
    tools.register(buildLogActivityTool(execute));

    const llm = new MockLLMProvider([
      { toolCalls: [{ toolCallId: 'c1', toolName: 'log_activity', input: {} }], stopReason: 'tool_use' },
      { toolCalls: [], stopReason: 'end_turn' },
    ]);

    const runtime = new AgentRuntime(llm, tools, async () => 'DISABLED');
    const result = await runtime.runTurn(CONTEXT, { messages: [] });

    expect(execute).not.toHaveBeenCalled();
    expect(result.toolCallOutcomes[0]?.decision).toBe('DENY');
  });

  it('reports DENY with an error for a tool name the LLM invented that was never registered', async () => {
    const llm = new MockLLMProvider([
      { toolCalls: [{ toolCallId: 'c1', toolName: 'delete_everything', input: {} }], stopReason: 'tool_use' },
      { toolCalls: [], stopReason: 'end_turn' },
    ]);

    const runtime = new AgentRuntime(llm, new ToolRegistry(), async () => 'AUTONOMOUS');
    const result = await runtime.runTurn(CONTEXT, { messages: [] });

    expect(result.toolCallOutcomes[0]).toMatchObject({ decision: 'DENY', toolName: 'delete_everything' });
    expect(result.toolCallOutcomes[0]?.error).toMatch(/unknown tool/i);
  });

  it('captures a thrown execution error as the outcome instead of throwing out of runTurn', async () => {
    const tools = new ToolRegistry();
    tools.register(buildLogActivityTool(vi.fn(async () => { throw new Error('connector unavailable'); })));

    const llm = new MockLLMProvider([
      { toolCalls: [{ toolCallId: 'c1', toolName: 'log_activity', input: { summary: 'x' } }], stopReason: 'tool_use' },
      { toolCalls: [], stopReason: 'end_turn' },
    ]);

    const runtime = new AgentRuntime(llm, tools, async () => 'AUTONOMOUS');
    const result = await runtime.runTurn(CONTEXT, { messages: [] });

    expect(result.toolCallOutcomes[0]).toMatchObject({ decision: 'ALLOW', error: 'connector unavailable' });
  });

  it('stops after maxToolIterations even if the LLM keeps requesting tools', async () => {
    const tools = new ToolRegistry();
    tools.register(buildLogActivityTool());

    const alwaysToolUse: LLMCompletionResult = {
      toolCalls: [{ toolCallId: 'c1', toolName: 'log_activity', input: { summary: 'x' } }],
      stopReason: 'tool_use',
    };
    const llm = new MockLLMProvider([alwaysToolUse, alwaysToolUse, alwaysToolUse]);

    const runtime = new AgentRuntime(llm, tools, async () => 'AUTONOMOUS');
    const result = await runtime.runTurn(CONTEXT, { messages: [], maxToolIterations: 2 });

    expect(result.iterations).toBe(2);
    expect(result.finalText).toBeUndefined();
    expect(result.toolCallOutcomes).toHaveLength(2);
  });

  it('passes the tool name (not the policy action) to resolvePolicyMode, scoped to the run context', async () => {
    const tools = new ToolRegistry();
    tools.register(buildLogActivityTool());
    const resolvePolicyMode = vi.fn(async () => 'AUTONOMOUS' as const);

    const llm = new MockLLMProvider([
      { toolCalls: [{ toolCallId: 'c1', toolName: 'log_activity', input: { summary: 'x' } }], stopReason: 'tool_use' },
      { toolCalls: [], stopReason: 'end_turn' },
    ]);

    const runtime = new AgentRuntime(llm, tools, resolvePolicyMode);
    await runtime.runTurn(CONTEXT, { messages: [] });

    expect(resolvePolicyMode).toHaveBeenCalledWith('crm.activity.log', CONTEXT);
  });
});
