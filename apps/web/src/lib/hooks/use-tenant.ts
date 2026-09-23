import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  locale: string;
  timezone: string;
  deletionRequestedAt: string | null;
  deletionRequestedByUserId: string | null;
  createdAt: string;
}

export function useOwnTenant() {
  return useQuery({
    queryKey: ['tenant', 'me'],
    queryFn: () => apiFetch<TenantSummary>('/v1/tenants/me'),
  });
}

export function useExportTenantData() {
  return useMutation({
    mutationFn: () => apiFetch<Record<string, unknown>>('/v1/tenants/me/export'),
  });
}

export function useRequestTenantDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<TenantSummary>('/v1/tenants/me/deletion-request', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant', 'me'] }),
  });
}

export function useCancelTenantDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<TenantSummary>('/v1/tenants/me/deletion-request', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant', 'me'] }),
  });
}

export function useConfirmTenantDeletion() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ tenantId: string; deletedAt: string }>('/v1/tenants/me/deletion-confirm', { method: 'POST' }),
  });
}
