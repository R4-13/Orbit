import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Supplier, SupplierStatus } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useSuppliers(status?: SupplierStatus) {
  return useQuery({
    queryKey: ['suppliers', status ?? 'all'],
    queryFn: () => apiFetch<Supplier[]>(`/v1/suppliers${status ? `?status=${status}` : ''}`),
  });
}

export function useApproveSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Supplier>(`/v1/suppliers/${id}/approve`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useRejectSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Supplier>(`/v1/suppliers/${id}/reject`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}
