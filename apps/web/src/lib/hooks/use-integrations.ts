import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Integration, IntegrationConnectorType } from '@orbit/domain';
import type { ConnectorMetadata } from '@orbit/integration-core';
import { apiFetch } from '../api-client';

export type IntegrationSummary = Omit<Integration, 'credentialReference'> & { hasCredentials: boolean };

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiFetch<IntegrationSummary[]>('/v1/integrations'),
  });
}

/** §4/§13 des Integration-Framework-Amendments — der statische Connector-Katalog (Capabilities, Auth-Typ, Pflichtfelder). Ändert sich praktisch nie zur Laufzeit, daher keine aggressive Invalidierung nötig. */
export function useConnectors() {
  return useQuery({
    queryKey: ['integration-connectors'],
    queryFn: () => apiFetch<ConnectorMetadata[]>('/v1/integrations/connectors'),
    staleTime: 5 * 60 * 1000,
  });
}

/** Startet den OAuth-Flow (aktuell nur GMAIL, siehe `liveConnectSupported`) und liefert die Google-Autorisierungs-URL, zu der die aufrufende Seite weiterleiten muss. */
export function useStartConnect() {
  return useMutation({
    mutationFn: (connectorType: IntegrationConnectorType) =>
      apiFetch<{ authorizationUrl: string }>(`/v1/integrations/${connectorType}/connect`, { method: 'POST' }),
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectorType: IntegrationConnectorType) =>
      apiFetch<{ ok: boolean }>(`/v1/integrations/${connectorType}/test`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
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
