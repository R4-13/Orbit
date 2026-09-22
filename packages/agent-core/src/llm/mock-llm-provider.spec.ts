import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from './mock-llm-provider';

describe('MockLLMProvider', () => {
  it('returns scripted responses in order, one per call', async () => {
    const provider = new MockLLMProvider([
      { toolCalls: [], stopReason: 'end_turn', text: 'first' },
      { toolCalls: [], stopReason: 'end_turn', text: 'second' },
    ]);

    const a = await provider.complete({ messages: [], tools: [] });
    const b = await provider.complete({ messages: [], tools: [] });

    expect(a.text).toBe('first');
    expect(b.text).toBe('second');
    expect(provider.getCallCount()).toBe(2);
  });

  it('falls back to an empty end_turn response once the script runs out', async () => {
    const provider = new MockLLMProvider([{ toolCalls: [], stopReason: 'end_turn', text: 'only' }]);

    await provider.complete({ messages: [], tools: [] });
    const second = await provider.complete({ messages: [], tools: [] });

    expect(second).toEqual({ toolCalls: [], stopReason: 'end_turn', text: '' });
  });

  it('records every request it received, for assertions in tests', async () => {
    const provider = new MockLLMProvider([{ toolCalls: [], stopReason: 'end_turn' }]);
    await provider.complete({ systemPrompt: 'be helpful', messages: [], tools: [] });

    expect(provider.getRequests()).toHaveLength(1);
    expect(provider.getRequests()[0]?.systemPrompt).toBe('be helpful');
  });

  it('seedResponse() appends to the queue of a long-lived instance', async () => {
    const provider = new MockLLMProvider();
    provider.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'seeded-1' });

    const a = await provider.complete({ messages: [], tools: [] });
    expect(a.text).toBe('seeded-1');

    provider.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'seeded-2' });
    const b = await provider.complete({ messages: [], tools: [] });
    expect(b.text).toBe('seeded-2');
  });
});
