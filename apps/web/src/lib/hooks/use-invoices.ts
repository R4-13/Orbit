import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingProposal, FinanceTransfer, Invoice, InvoiceStatus, Supplier } from '@orbit/domain';
import { apiFetch } from '../api-client';

export type InvoiceDetail = Invoice & {
  supplier: Supplier | null;
  document: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
  case: { id: string; title: string } | null;
  bookingProposals: BookingProposal[];
  financeTransfers: FinanceTransfer[];
};

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
    queryFn: () => apiFetch<InvoiceDetail>(`/v1/invoices/${id}`),
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
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useRejectInvoice(invoiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Invoice>(`/v1/invoices/${invoiceId}/reject`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Confirms a flagged IBAN change is legitimate (§59 Szenario C) — updates the supplier's IBAN on file and re-enters the normal booking-proposal/approval flow. */
export function useConfirmBankChange(invoiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Invoice>(`/v1/invoices/${invoiceId}/confirm-bank-change`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
}
