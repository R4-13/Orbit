import Anthropic from '@anthropic-ai/sdk';
import { ExternalSystemError } from '@orbit/shared';
import type {
  LLMCompletionRequest,
  LLMCompletionResult,
  LLMProvider,
  LLMStopReason,
  LLMToolCall,
  ProviderValidationResult,
} from './types';

function toStopReason(reason: string | null): LLMStopReason {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'end_turn';
}

/**
 * Real LLM_PROVIDER=anthropic implementation, against the official
 * Anthropic Messages API (https://docs.claude.com/en/api/messages).
 * ANTHROPIC_API_KEY/ANTHROPIC_MODEL come from @orbit/config/env.ts.
 */
export class AnthropicLLMProvider implements LLMProvider {
  readonly providerName = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  get modelName(): string {
    return this.model;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        system: request.systemPrompt,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        })),
      });
    } catch (error) {
      throw new ExternalSystemError('Anthropic API request failed.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const toolCalls: LLMToolCall[] = [];
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          toolCallId: block.id,
          toolName: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text: text.length > 0 ? text : undefined,
      toolCalls,
      stopReason: toStopReason(response.stop_reason),
    };
  }

  /** Cheapest real call that proves the key/model actually work: a 1-token completion, no tools. */
  async validateConfiguration(): Promise<ProviderValidationResult> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
