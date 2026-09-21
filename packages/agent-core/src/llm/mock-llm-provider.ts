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

  constructor(private readonly scriptedResponses: LLMCompletionResult[] = []) {}

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    this.requests.push(request);
    const response = this.scriptedResponses[this.callCount];
    this.callCount += 1;

    if (!response) {
      return { toolCalls: [], stopReason: 'end_turn', text: '' };
    }
    return response;
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
