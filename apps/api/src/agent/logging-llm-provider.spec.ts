import { Logger } from '@nestjs/common';
import type { LLMProvider } from '@orbit/agent-core';
import { LoggingLLMProvider } from './logging-llm-provider';

describe('LoggingLLMProvider', () => {
  const inner = (complete: LLMProvider['complete']): LLMProvider => ({ providerName: 'openai', modelName: 'm-1', complete });

  afterEach(() => jest.restoreAllMocks());

  it('delegates, exposes provider/model and logs metadata only (no prompt, no completion text)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const provider = new LoggingLLMProvider(inner(async () => ({ text: 'GEHEIME ANTWORT', toolCalls: [], stopReason: 'end_turn' })));
    expect(provider.providerName).toBe('openai');
    expect(provider.modelName).toBe('m-1');

    const result = await provider.complete({ systemPrompt: 'GEHEIMER PROMPT', messages: [{ role: 'user', content: 'GEHEIME FRAGE' }], tools: [] });
    expect(result.text).toBe('GEHEIME ANTWORT');
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain('provider=openai model=m-1 executionMode=LIVE ok=true');
    expect(line).not.toContain('GEHEIM');
  });

  it('logs a failure without the error message and rethrows', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const provider = new LoggingLLMProvider(
      inner(async () => {
        throw new Error('401 Incorrect API key sk-live-secret');
      }),
    );
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toThrow('401');
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('ok=false');
    expect(line).not.toContain('sk-live-secret');
  });

  it('only exposes validateConfiguration when the inner provider has one', () => {
    expect(new LoggingLLMProvider(inner(async () => ({ toolCalls: [], stopReason: 'end_turn' }))).validateConfiguration).toBeUndefined();
    const withValidation: LLMProvider = { ...inner(async () => ({ toolCalls: [], stopReason: 'end_turn' })), validateConfiguration: async () => ({ valid: true }) };
    expect(new LoggingLLMProvider(withValidation).validateConfiguration).toBeDefined();
  });
});
