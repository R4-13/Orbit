import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PolicyConfig } from '@orbit/domain';
import type { PolicyMode } from '@orbit/shared';
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
