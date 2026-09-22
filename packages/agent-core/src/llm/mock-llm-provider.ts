import type { LLMCompletionRequest, LLMCompletionResult, LLMProvider } from './types';

/**
 * Scriptable LLM double (LLM_PROVIDER=mock, the default — see
 * @orbit/config/env.ts). There is no meaningful deterministic algorithm
 * for "what would an LLM say", so tests/demo scripts pre-load the exact
 * sequence of responses via the constructor and the provider hands them
 * out one per `complete()` call, in order.
 */
export class MockLLMProvider implements LLMProvider {
  readonly providerName = 'mock';

  private callCount = 0;
  private readonly requests: LLMCompletionRequest[] = [];
  private readonly queue: LLMCompletionResult[];

  constructor(scriptedResponses: LLMCompletionResult[] = []) {
    this.queue = [...scriptedResponses];
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    this.requests.push(request);
    this.callCount += 1;
    const response = this.queue.shift();

    if (!response) {
      return { toolCalls: [], stopReason: 'end_turn', text: '' };
    }
    return response;
  }

  /**
   * Test/dev helper — not part of the LLMProvider contract. Appends to the
   * response queue rather than only accepting a fixed constructor array,
   * so a long-lived singleton instance (this provider is DI-scoped
   * process-wide in apps/api, same as MockOcrProvider/MockFinanceConnector)
   * can be re-scripted before each orchestration run instead of needing a
   * fresh instance per call. Mirrors MockOcrProvider.seedResult().
   */
  seedResponse(response: LLMCompletionResult): void {
    this.queue.push(response);
  }

  /** Test/dev helper — not part of the LLMProvider contract. */
  getRequests(): readonly LLMCompletionRequest[] {
    return this.requests;
  }

  /** Test/dev helper — not part of the LLMProvider contract. */
  getCallCount(): number {
    return this.callCount;
  }
}
