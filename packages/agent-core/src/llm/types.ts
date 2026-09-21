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

export interface LLMProvider {
  readonly providerName: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
}
