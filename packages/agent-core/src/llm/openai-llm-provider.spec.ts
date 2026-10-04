import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAILLMProvider } from './openai-llm-provider';

function fakeClient(create: (params: Record<string, unknown>) => unknown): OpenAI {
  return { chat: { completions: { create: vi.fn(async (params: Record<string, unknown>) => create(params)) } } } as unknown as OpenAI;
}

describe('OpenAILLMProvider', () => {
  it('reports provider and model name and uses max_completion_tokens (not the rejected max_tokens)', async () => {
    const create = vi.fn().mockReturnValue({ choices: [{ message: { content: 'Hallo', tool_calls: [] }, finish_reason: 'stop' }] });
    const provider = new OpenAILLMProvider('sk-test', 'gpt-test-model', fakeClient(create));
    expect(provider.providerName).toBe('openai');
    expect(provider.modelName).toBe('gpt-test-model');

    const result = await provider.complete({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 100 });
    expect(result.text).toBe('Hallo');
    expect(result.stopReason).toBe('end_turn');
    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe('gpt-test-model');
    expect(params.max_completion_tokens).toBe(100);
    expect(params).not.toHaveProperty('max_tokens');
  });

  it('maps tool calls and rejects malformed tool arguments instead of passing an empty input', async () => {
    const ok = new OpenAILLMProvider(
      'k',
      'm',
      fakeClient(() => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }] })),
    );
    const result = await ok.complete({ messages: [{ role: 'user', content: 'x' }], tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }] });
    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toEqual([{ toolCallId: 'c1', toolName: 't', input: { a: 1 } }]);

    const bad = new OpenAILLMProvider(
      'k',
      'm',
      fakeClient(() => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: 'not json' } }] }, finish_reason: 'tool_calls' }] })),
    );
    await expect(bad.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] })).rejects.toThrow('malformed tool arguments');
  });

  it('wraps API failures without leaking more than the provider message', async () => {
    const provider = new OpenAILLMProvider('k', 'm', fakeClient(() => Promise.reject(new Error('401 Incorrect API key'))));
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] })).rejects.toThrow('OpenAI API request failed');
    await expect(provider.validateConfiguration()).resolves.toMatchObject({ valid: false });
  });
});
