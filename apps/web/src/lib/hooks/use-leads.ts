import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Lead, LeadSource } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useLeads() {
  return useQuery({
    queryKey: ['leads'],
    queryFn: () => apiFetch<Lead[]>('/v1/leads'),
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contactId: string; companyId?: string; source: LeadSource; notes?: string }) =>
      apiFetch<Lead>('/v1/leads', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
