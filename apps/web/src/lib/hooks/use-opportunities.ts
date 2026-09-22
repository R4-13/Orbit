import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Opportunity, OpportunityStage } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useOpportunities(stage?: OpportunityStage) {
  return useQuery({
    queryKey: ['opportunities', stage ?? 'all'],
    queryFn: () => apiFetch<Opportunity[]>(`/v1/opportunities${stage ? `?stage=${stage}` : ''}`),
  });
}

export function useOpportunity(id: string) {
  return useQuery({
    queryKey: ['opportunities', id],
    queryFn: () => apiFetch<Opportunity>(`/v1/opportunities/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; leadId?: string; companyId?: string; contactId?: string; value?: number }) =>
      apiFetch<Opportunity>('/v1/opportunities', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
  });
}

export function useUpdateOpportunityStage(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stage: OpportunityStage) =>
      apiFetch<Opportunity>(`/v1/opportunities/${opportunityId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities', opportunityId] });
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    },
  });
}
