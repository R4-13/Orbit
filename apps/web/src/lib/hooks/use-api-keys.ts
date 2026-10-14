import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function useApiKeys() {
  return useQuery({ queryKey: ['api-keys'], queryFn: () => apiFetch<ApiKeyView[]>('/v1/tenant/api-keys') });
}

/** Der Klartext-Schlüssel steckt nur in der Antwort der Anlage und wird nie erneut geliefert. */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; scopes: string[] }) => apiFetch<ApiKeyView & { key: string }>('/v1/tenant/api-keys', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<ApiKeyView>(`/v1/tenant/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}
