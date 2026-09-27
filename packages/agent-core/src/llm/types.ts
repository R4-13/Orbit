/**
 * Provider-agnostic LLM abstraction (§6, architecture principle: agents
 * never call a provider SDK directly — see AgentRuntime in
 * ../runtime/agent-runtime.ts). Mirrors the shape both Anthropic's Messages
 * API and a deterministic test double can satisfy: a system prompt, a
 * message history, and a set of callable tools.
 */

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool the LLM may call, described the way Anthropic's Messages API expects. */
export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export interface LLMCompletionResult {
  text?: string;
  toolCalls: LLMToolCall[];
  stopReason: LLMStopReason;
}

export interface LLMCompletionRequest {
  systemPrompt?: string;
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  maxTokens?: number;
}

export interface ProviderValidationResult {
  valid: boolean;
  error?: string;
}

export interface LLMProvider {
  readonly providerName: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
  /**
   * §38 of docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md ("LLM Provider
   * Abstraction") — a cheap, real call against the provider (e.g. listing
   * models) to confirm a credential actually works, used by the BYOK "Test
   * Connection" flow (apps/api/src/ai-providers/). Optional: MockLLMProvider
   * has nothing to validate, and making this required would force every
   * existing test double across the codebase that builds a bare `{
   * providerName, complete }` object to also implement it.
   */
  validateConfiguration?(): Promise<ProviderValidationResult>;
}
