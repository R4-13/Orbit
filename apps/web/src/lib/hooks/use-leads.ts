import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Company, Contact, Lead, LeadSource, Opportunity } from '@orbit/domain';
import { apiFetch } from '../api-client';

export type LeadDetail = Lead & { contact: Contact; company: Company | null; opportunities: Opportunity[] };

export function useLeads() {
  return useQuery({
    queryKey: ['leads'],
    queryFn: () => apiFetch<Lead[]>('/v1/leads'),
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['leads', id],
    queryFn: () => apiFetch<LeadDetail>(`/v1/leads/${id}`),
    enabled: Boolean(id),
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
