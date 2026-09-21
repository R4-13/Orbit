import { useQuery } from '@tanstack/react-query';
import type { Approval, ApprovalStatus } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useApprovals(status?: ApprovalStatus) {
  return useQuery({
    queryKey: ['approvals', status ?? 'all'],
    queryFn: () => apiFetch<Approval[]>(`/v1/approvals${status ? `?status=${status}` : ''}`),
  });
}
