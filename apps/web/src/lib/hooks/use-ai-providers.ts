import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AIProviderConnection, AIProviderKey } from '@orbit/domain';
import type { AiRuntimeStatus } from '@orbit/shared';
import { apiFetch } from '../api-client';

export type AiProviderConnectionSummary = Omit<AIProviderConnection, 'encryptedCredentials'> & {
  hasCredentials: boolean;
};

export interface AiProviderStatus {
  mode: 'ORBIT_MANAGED' | 'TENANT_MANAGED';
  connection: AiProviderConnectionSummary | null;
  /** What actually serves AI requests and whether that was verified — separate from the configuration kind above. */
  runtime: AiRuntimeStatus;
}

export function useAiProviderStatus() {
  return useQuery({
    queryKey: ['ai-providers', 'status'],
    queryFn: () => apiFetch<AiProviderStatus>('/v1/ai-providers/status'),
  });
}

export function useUpsertAiProviderConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerKey, apiKey, model }: { providerKey: AIProviderKey; apiKey: string; model?: string }) =>
      apiFetch<AiProviderConnectionSummary>(`/v1/ai-providers/${providerKey}`, {
        method: 'PUT',
        body: JSON.stringify({ apiKey, model }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-providers', 'status'] }),
  });
}

export function useTestAiProviderConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<AiProviderConnectionSummary>('/v1/ai-providers/test', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-providers', 'status'] }),
  });
}

/** Really calls the provider serving this tenant (a simulated provider is reported as such, never as verified). */
export function useVerifyAiRuntime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<AiRuntimeStatus>('/v1/ai-providers/verify', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-providers', 'status'] }),
  });
}

export function useDisconnectAiProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<AiProviderConnectionSummary>('/v1/ai-providers', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-providers', 'status'] }),
  });
}
