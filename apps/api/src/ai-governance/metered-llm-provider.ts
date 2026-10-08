import type { LLMCompletionRequest, LLMCompletionResult, LLMProvider, ProviderValidationResult } from '@orbit/agent-core';
import { classifyLlmError } from '@orbit/shared';
import type { AiMeterService, MeterContext } from './ai-meter.service';

/** Fehlerklassen, bei denen ein anderer – ausdrücklich freigegebener – Kandidat die Anfrage sinnvoll übernehmen kann. */
const FAILOVER_CLASSES = new Set(['RATE_LIMITED', 'AUTH', 'TIMEOUT', 'PROVIDER_ERROR']);

/**
 * Misst einen Aufruf (Nutzung, Latenz, Gesundheit), ohne Prompt- oder Antwortinhalt zu sehen oder zu verändern. Der echte Fehler wird unverändert
 * weitergereicht. Der Mock-Provider wird nie umhüllt (er verursacht keine externe Nutzung).
 */
export class MeteredLLMProvider implements LLMProvider {
  readonly validateConfiguration?: () => Promise<ProviderValidationResult>;

  constructor(
    private readonly inner: LLMProvider,
    private readonly meter: AiMeterService,
    private readonly context: MeterContext,
    /** Vorabprüfung vor jedem externen Aufruf (z. B. durchgesetztes Kostenlimit); wirft einen ehrlichen Fehler, ruft den Anbieter dann nicht auf und misst nichts. */
    private readonly guard?: () => Promise<void>,
  ) {
    if (inner.validateConfiguration) this.validateConfiguration = () => (inner.validateConfiguration as () => Promise<ProviderValidationResult>)();
  }

  get providerName(): string {
    return this.inner.providerName;
  }

  get modelName(): string | undefined {
    return this.inner.modelName;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    await this.guard?.();
    const startedAt = Date.now();
    try {
      const result = await this.inner.complete(request);
      await this.meter.record(this.context, { ok: true, latencyMs: Date.now() - startedAt, usage: result.usage });
      return result;
    } catch (error) {
      await this.meter.record(this.context, { ok: false, latencyMs: Date.now() - startedAt, error });
      throw error;
    }
  }
}

/**
 * Probiert freigegebene Kandidaten der Reihe nach (Amendment 03 §11): nur bei Fehlern, die ein anderer Kandidat beheben kann, und nur innerhalb der
 * von der Route erlaubten Kette. Ist die Kette erschöpft, wird der letzte Fehler ehrlich weitergereicht – nie ein stiller Erfolg.
 */
export class FailoverLLMProvider implements LLMProvider {
  readonly validateConfiguration?: () => Promise<ProviderValidationResult>;

  constructor(private readonly candidates: LLMProvider[]) {
    if (candidates.length === 0) throw new Error('FailoverLLMProvider braucht mindestens einen Kandidaten.');
    const first = candidates[0] as LLMProvider;
    if (first.validateConfiguration) this.validateConfiguration = () => (first.validateConfiguration as () => Promise<ProviderValidationResult>)();
  }

  get providerName(): string {
    return (this.candidates[0] as LLMProvider).providerName;
  }

  get modelName(): string | undefined {
    return (this.candidates[0] as LLMProvider).modelName;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    let lastError: unknown;
    for (const candidate of this.candidates) {
      try {
        return await candidate.complete(request);
      } catch (error) {
        lastError = error;
        if (!FAILOVER_CLASSES.has(classifyLlmError(error))) throw error;
      }
    }
    throw lastError;
  }
}
