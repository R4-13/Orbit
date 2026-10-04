import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlueprintStatus, CapabilityDefinition, PlanIssue } from '@orbit/shared';
import { apiFetch } from '../api-client';

export interface BlueprintRow {
  id: string;
  key: string;
  version: string;
  status: BlueprintStatus;
  definitionHash: string;
  active: boolean;
  createdAt: string;
  publishedAt: string | null;
  validation: { valid: boolean; issues: PlanIssue[] } | null;
  definition: { title?: string; description?: string; planMode?: string; goals?: string[] };
}

export interface CapabilityRow extends CapabilityDefinition {
  executability?: { executable: boolean; reasons: string[] };
}

export interface ValidationView {
  valid: boolean;
  issues: PlanIssue[];
}

export function useBlueprints() {
  return useQuery({ queryKey: ['process-blueprints'], queryFn: () => apiFetch<BlueprintRow[]>('/v1/process-blueprints') });
}

export function useCapabilities() {
  return useQuery({ queryKey: ['process-capabilities'], queryFn: () => apiFetch<CapabilityRow[]>('/v1/process-blueprints/capabilities') });
}

export function useValidateBlueprint() {
  return useMutation({ mutationFn: (definition: unknown) => apiFetch<ValidationView>('/v1/process-blueprints/validate', { method: 'POST', body: JSON.stringify({ definition }) }) });
}

export function useImportBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (definition: unknown) => apiFetch<{ key: string; version: string; status: string; validation: ValidationView }>('/v1/process-blueprints', { method: 'POST', body: JSON.stringify({ definition }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['process-blueprints'] }),
  });
}

export function useBlueprintLifecycle() {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['process-blueprints'] });
    void queryClient.invalidateQueries({ queryKey: ['process-capabilities'] });
  };
  return {
    transition: useMutation({
      mutationFn: ({ key, version, to }: { key: string; version: string; to: BlueprintStatus }) => apiFetch(`/v1/process-blueprints/${key}/${version}/transition`, { method: 'POST', body: JSON.stringify({ to }) }),
      onSuccess: refresh,
    }),
    activate: useMutation({
      mutationFn: ({ key, version }: { key: string; version: string }) => apiFetch(`/v1/process-blueprints/${key}/${version}/activate`, { method: 'POST' }),
      onSuccess: refresh,
    }),
    deactivate: useMutation({
      mutationFn: ({ key }: { key: string }) => apiFetch(`/v1/process-blueprints/${key}/activation`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}
