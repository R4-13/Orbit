import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingProposal, Invoice, InvoiceStatus } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useInvoices(status?: InvoiceStatus) {
  return useQuery({
    queryKey: ['invoices', status ?? 'all'],
    queryFn: () =>
      apiFetch<Invoice[]>(`/v1/invoices${status ? `?status=${status}` : ''}`),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: () => apiFetch<Invoice>(`/v1/invoices/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateInvoiceFromDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; caseId?: string }) =>
      apiFetch<Invoice>('/v1/invoices', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useAddBookingProposal(invoiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountCode: string; costCenter?: string; description?: string; amount: number }) =>
      apiFetch<BookingProposal>(`/v1/invoices/${invoiceId}/booking-proposal`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] }),
  });
}

export function useApproveInvoice(invoiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Invoice>(`/v1/invoices/${invoiceId}/approve`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useTransferInvoice(invoiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Invoice>(`/v1/invoices/${invoiceId}/transfer`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}
