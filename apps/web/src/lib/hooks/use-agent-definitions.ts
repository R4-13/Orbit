import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDefinition, AgentDefinitionVersion } from '@orbit/domain';
import { apiFetch } from '../api-client';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  policyAction: string;
  inputSchema: Record<string, unknown>;
}

export interface CreateAgentDefinitionInput {
  key: string;
  name: string;
  description?: string;
  baseType: 'ORCHESTRATOR' | 'COMMUNICATION' | 'FINANCE' | 'SALES';
  systemPrompt: string;
  allowedTools: string[];
}

export interface UpdateAgentDefinitionInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  status?: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  changeNote?: string;
}

export function useAgentDefinitions() {
  return useQuery({
    queryKey: ['agent-definitions'],
    queryFn: () => apiFetch<AgentDefinition[]>('/v1/agent-definitions'),
  });
}

export function useToolCatalog() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: () => apiFetch<ToolCatalogEntry[]>('/v1/tools'),
  });
}

export function useAgentDefinitionVersions(key: string | undefined) {
  return useQuery({
    queryKey: ['agent-definitions', key, 'versions'],
    queryFn: () => apiFetch<AgentDefinitionVersion[]>(`/v1/agent-definitions/${key}/versions`),
    enabled: Boolean(key),
  });
}

export function useCreateAgentDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentDefinitionInput) =>
      apiFetch<AgentDefinition>('/v1/agent-definitions', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-definitions'] }),
  });
}

export function useUpdateAgentDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...input }: UpdateAgentDefinitionInput & { key: string }) =>
      apiFetch<AgentDefinition>(`/v1/agent-definitions/${key}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-definitions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-definitions', variables.key, 'versions'] });
    },
  });
}

export function useRollbackAgentDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, version }: { key: string; version: number }) =>
      apiFetch<AgentDefinition>(`/v1/agent-definitions/${key}/rollback/${version}`, { method: 'POST' }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-definitions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-definitions', variables.key, 'versions'] });
    },
  });
}
