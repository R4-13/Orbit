import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PolicyConfig } from '@orbit/domain';
import type { AutomationLevel, AutomationPresetKey, PolicyMode } from '@orbit/shared';
import { apiFetch } from '../api-client';

export function usePolicies() {
  return useQuery({
    queryKey: ['policies'],
    queryFn: () => apiFetch<PolicyConfig[]>('/v1/policies'),
  });
}

export function useUpdatePolicyMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, mode }: { action: string; mode: PolicyMode }) =>
      apiFetch<PolicyConfig>(`/v1/policies/${action}`, { method: 'PATCH', body: JSON.stringify({ mode }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policies'] }),
  });
}

export interface AutomationOverview {
  current: AutomationLevel;
  presets: Array<{ key: AutomationPresetKey; label: string; description: string; changes: Array<{ action: string; from: PolicyMode; to: PolicyMode }> }>;
}

/** Automatisierungsgrad: aktuelle Stufe und was jede Stufe ändern würde. */
export function useAutomation() {
  return useQuery({ queryKey: ['policies', 'automation'], queryFn: () => apiFetch<AutomationOverview>('/v1/policies/automation') });
}

export function useApplyAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preset: AutomationPresetKey) => apiFetch<{ current: AutomationLevel; changed: number }>('/v1/policies/automation', { method: 'POST', body: JSON.stringify({ preset }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policies'] }),
  });
}
