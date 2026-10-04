import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { ExternalSystemError } from '@orbit/shared';
import type {
  LLMCompletionRequest,
  LLMCompletionResult,
  LLMProvider,
  LLMStopReason,
  LLMToolCall,
  ProviderValidationResult,
} from './types';

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
type ChatCompletionReasoningEffort = 'low' | 'medium' | 'high';

export interface OpenAIProviderOptions {
  reasoningEffort?: OpenAIReasoningEffort;
  /** Test seam: replaces the SDK client. */
  client?: OpenAI;
}

function toStopReason(reason: string): LLMStopReason {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  return 'end_turn';
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through to the typed error below
  }
  // A malformed tool call is a provider failure, never silently an empty input that a tool could act on.
  throw new ExternalSystemError('OpenAI returned malformed tool arguments.');
}

/**
 * §39 des Unified-Evolution-Konzepts ("Provider Adapters") — zweiter
 * echter LLMProvider neben AnthropicLLMProvider, gegen die offizielle
 * OpenAI Chat Completions API (https://platform.openai.com/docs/api-reference/chat).
 * Strukturell vollständig, aber nie live gegen einen echten Key getestet
 * (kein OPENAI_API_KEY in dieser Umgebung verfügbar) — siehe
 * docs/IMPLEMENTATION_STATUS.md (REQUIRES PROVIDER CREDENTIALS).
 *
 * Übersetzt zwischen ORBITs providerneutralem LLMMessage/LLMToolCall-Modell
 * und OpenAIs Chat-Completions-Shape (system message statt separatem
 * `system`-Feld, `tool_calls`/`function.arguments` als JSON-String statt
 * bereits geparstem Objekt) — genau die Art von Übersetzung, die laut
 * Architekturprinzip ausschließlich hier im Adapter stattfinden darf, nie
 * in Business-Code.
 */
export class OpenAILLMProvider implements LLMProvider {
  readonly providerName = 'openai';
  private readonly client: OpenAI;

  private readonly reasoningEffort?: OpenAIReasoningEffort;

  constructor(
    apiKey: string,
    private readonly model: string,
    options: OpenAIProviderOptions = {},
  ) {
    // The client is injectable for tests; production always builds the official SDK client from the key.
    this.client = options.client ?? new OpenAI({ apiKey });
    this.reasoningEffort = options.reasoningEffort;
  }

  /**
   * Reasoning models (e.g. gpt-6-luna) reject function tools on Chat Completions while reasoning is active
   * ("use /v1/responses or set reasoning_effort to 'none'"). The effort is therefore an explicit, optional
   * setting (OPENAI_REASONING_EFFORT); when unset nothing is sent and non-reasoning models behave as before.
   * The SDK's type does not list 'none' yet, hence the cast.
   */
  private reasoningParams(): { reasoning_effort?: ChatCompletionReasoningEffort } {
    return this.reasoningEffort ? { reasoning_effort: this.reasoningEffort as ChatCompletionReasoningEffort } : {};
  }

  get modelName(): string {
    return this.model;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const messages: ChatCompletionMessageParam[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push(...request.messages.map((message) => ({ role: message.role, content: message.content }) as ChatCompletionMessageParam));

    const tools: ChatCompletionTool[] = request.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        // `max_tokens` is rejected by current OpenAI models; `max_completion_tokens` is the supported parameter.
        max_completion_tokens: request.maxTokens ?? 4096,
        ...this.reasoningParams(),
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });
    } catch (error) {
      throw new ExternalSystemError('OpenAI API request failed.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const choice = response.choices[0];
    const toolCalls: LLMToolCall[] = (choice?.message.tool_calls ?? [])
      .filter((call): call is typeof call & { type: 'function' } => call.type === 'function')
      .map((call) => ({
        toolCallId: call.id,
        toolName: call.function.name,
        input: parseToolArguments(call.function.arguments),
      }));

    return {
      text: choice?.message.content ?? undefined,
      toolCalls,
      stopReason: toStopReason(choice?.finish_reason ?? 'stop'),
    };
  }

  /** Cheapest real call that proves the key/model actually work: a 1-token completion, no tools. */
  async validateConfiguration(): Promise<ProviderValidationResult> {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 16,
        ...this.reasoningParams(),
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
