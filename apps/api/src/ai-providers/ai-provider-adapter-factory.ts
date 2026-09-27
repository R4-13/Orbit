import { AnthropicLLMProvider, OpenAILLMProvider, type LLMProvider } from '@orbit/agent-core';
import type { AIProviderKey } from '@orbit/domain';

/**
 * §39 des Unified-Evolution-Konzepts ("Provider Adapters") — der einzige
 * Ort, der einen `AIProviderKey` (DB-Enum) auf eine konkrete `LLMProvider`-
 * Adapter-Instanz abbildet. Bewusst eine reine Funktion ohne DI: sowohl
 * `AiProvidersService` (Test-Connection) als auch `AiProviderResolverService`
 * (Laufzeit-Auflösung pro Tenant) brauchen dieselbe Abbildung, aber keiner
 * von beiden braucht dafür einen eigenen injizierbaren Service.
 */
export function buildProviderAdapter(providerKey: AIProviderKey, apiKey: string, model: string): LLMProvider {
  if (providerKey === 'ANTHROPIC') {
    return new AnthropicLLMProvider(apiKey, model);
  }
  return new OpenAILLMProvider(apiKey, model);
}
