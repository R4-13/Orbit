import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Integration, IntegrationConnectorType } from '@orbit/domain';
import { apiFetch } from '../api-client';

export type IntegrationSummary = Omit<Integration, 'encryptedCredentials'> & { hasCredentials: boolean };

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiFetch<IntegrationSummary[]>('/v1/integrations'),
  });
}

export function useUpsertIntegrationCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectorType,
      credentials,
      config,
    }: {
      connectorType: IntegrationConnectorType;
      credentials: Record<string, unknown>;
      config?: Record<string, unknown>;
    }) =>
      apiFetch<IntegrationSummary>(`/v1/integrations/${connectorType}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ credentials, config }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useDisconnectIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectorType: IntegrationConnectorType) =>
      apiFetch<IntegrationSummary>(`/v1/integrations/${connectorType}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });
}
