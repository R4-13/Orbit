import { Inject, Injectable } from '@nestjs/common';
import { AnthropicLLMProvider, OpenAILLMProvider, type LLMProvider } from '@orbit/agent-core';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';

export interface AdapterBuildInput {
  apiKey: string;
  providerModelId: string;
}

export type AdapterFactory = (input: AdapterBuildInput) => LLMProvider;

/**
 * Einziger Ort, an dem ein Adapter-Schlüssel (`openai`, `anthropic`, …) auf Code abgebildet wird (Amendment 03 §8.2: „ein SDK macht noch keinen
 * produktiven Anbieter“). Ein neuer Anbieter = ein neuer Adapter hier + Registry-Einträge in der Plattform; kein Businesscode ändert sich (OPS-05/11).
 * Tests registrieren weitere Adapter über `register()`.
 */
@Injectable()
export class AiAdapterRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  constructor(@Inject(ORBIT_ENV) private readonly env: OrbitEnv) {
    this.register('openai', ({ apiKey, providerModelId }) => new OpenAILLMProvider(apiKey, providerModelId, { reasoningEffort: this.env.OPENAI_REASONING_EFFORT }));
    this.register('anthropic', ({ apiKey, providerModelId }) => new AnthropicLLMProvider(apiKey, providerModelId));
  }

  register(adapterKey: string, factory: AdapterFactory): void {
    this.factories.set(adapterKey, factory);
  }

  has(adapterKey: string): boolean {
    return this.factories.has(adapterKey);
  }

  keys(): string[] {
    return [...this.factories.keys()].sort();
  }

  build(adapterKey: string, input: AdapterBuildInput): LLMProvider {
    const factory = this.factories.get(adapterKey);
    if (!factory) throw new Error(`Kein Adapter für "${adapterKey}" registriert.`);
    return factory(input);
  }
}
