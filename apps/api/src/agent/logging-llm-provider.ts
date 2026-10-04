import { Logger } from '@nestjs/common';
import type { LLMCompletionRequest, LLMCompletionResult, LLMProvider, ProviderValidationResult } from '@orbit/agent-core';

/**
 * Runtime evidence for real provider calls: one structured line per call with
 * provider, model, execution mode, duration and outcome. It never logs
 * prompts, completions, tool inputs or credentials — only metadata — so the
 * log can be used to prove that a live model was (or was not) actually called.
 * Wraps only real providers; the mock provider stays unwrapped.
 */
export class LoggingLLMProvider implements LLMProvider {
  private readonly logger = new Logger('LLM');
  readonly validateConfiguration?: () => Promise<ProviderValidationResult>;

  constructor(private readonly inner: LLMProvider) {
    if (inner.validateConfiguration) {
      this.validateConfiguration = async () => {
        const startedAt = Date.now();
        const result = await (inner.validateConfiguration as () => Promise<ProviderValidationResult>)();
        this.logger.log(`llm.validate provider=${inner.providerName} model=${inner.modelName ?? 'n/a'} executionMode=LIVE valid=${result.valid} durationMs=${Date.now() - startedAt}`);
        return result;
      };
    }
  }

  get providerName(): string {
    return this.inner.providerName;
  }

  get modelName(): string | undefined {
    return this.inner.modelName;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const startedAt = Date.now();
    const base = `provider=${this.inner.providerName} model=${this.inner.modelName ?? 'n/a'} executionMode=LIVE`;
    try {
      const result = await this.inner.complete(request);
      this.logger.log(`llm.call ${base} ok=true durationMs=${Date.now() - startedAt} stopReason=${result.stopReason} toolCalls=${result.toolCalls.length} textChars=${result.text?.length ?? 0}`);
      return result;
    } catch (error) {
      this.logger.warn(`llm.call ${base} ok=false durationMs=${Date.now() - startedAt} errorType=${error instanceof Error ? error.name : 'unknown'}`);
      throw error;
    }
  }
}
