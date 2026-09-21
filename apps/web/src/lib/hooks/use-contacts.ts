import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Contact } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => apiFetch<Contact[]>('/v1/contacts'),
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email?: string; firstName: string; lastName: string; phone?: string }) =>
      apiFetch<Contact>('/v1/contacts', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
