import type { LLMCompletionRequest, LLMCompletionResult, LLMProvider, ProviderValidationResult } from './types';

/**
 * A scripted response is either a fixed result, or a function of the
 * actual request (letting a script react to a previous step's real tool
 * result — e.g. "call create_booking_proposal with *this* invoice's real
 * id and amount" — a fixed value can't know either until extract_invoice
 * has actually run). AgentRuntime pushes each tool result back into the
 * conversation as a `[tool_result:toolName] {...}` message before the
 * next `complete()` call, so a function response can just parse that.
 */
export type ScriptedLLMResponse = LLMCompletionResult | ((request: LLMCompletionRequest) => LLMCompletionResult);

/**
 * Scriptable LLM double (LLM_PROVIDER=mock, the default — see
 * @orbit/config/env.ts). There is no meaningful deterministic algorithm
 * for "what would an LLM say" in general, so tests/demo scripts pre-load
 * the exact sequence of responses (or response-producing functions, for
 * multi-step plans that depend on an earlier step's real result) and the
 * provider hands them out one per `complete()` call, in order.
 */
export class MockLLMProvider implements LLMProvider {
  readonly providerName = 'mock';

  private callCount = 0;
  private readonly requests: LLMCompletionRequest[] = [];
  private readonly queue: ScriptedLLMResponse[];

  constructor(scriptedResponses: ScriptedLLMResponse[] = []) {
    this.queue = [...scriptedResponses];
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    this.requests.push(request);
    this.callCount += 1;
    const response = this.queue.shift();

    if (!response) {
      return { toolCalls: [], stopReason: 'end_turn', text: '' };
    }
    return typeof response === 'function' ? response(request) : response;
  }

  /**
   * Test/dev helper — not part of the LLMProvider contract. Appends to the
   * response queue rather than only accepting a fixed constructor array,
   * so a long-lived singleton instance (this provider is DI-scoped
   * process-wide in apps/api, same as MockOcrProvider/MockFinanceConnector)
   * can be re-scripted before each orchestration run instead of needing a
   * fresh instance per call. Mirrors MockOcrProvider.seedResult().
   */
  seedResponse(response: ScriptedLLMResponse): void {
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

  /** Nothing to validate — there's no real credential behind the mock. */
  async validateConfiguration(): Promise<ProviderValidationResult> {
    return { valid: true };
  }
}
