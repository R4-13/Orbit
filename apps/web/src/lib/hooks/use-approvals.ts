import { useQuery } from '@tanstack/react-query';
import type { Approval, ApprovalStatus } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useApprovals(status?: ApprovalStatus) {
  return useQuery({
    queryKey: ['approvals', status ?? 'all'],
    queryFn: () => apiFetch<Approval[]>(`/v1/approvals${status ? `?status=${status}` : ''}`),
  });
}

/** Anzahl offener Freigaben für das Navigations-Badge – teilt den Cache mit `useApprovals('PENDING')`; fragt nur mit Leserecht an. */
export function useApprovalCount(enabled: boolean): number | undefined {
  const { data } = useQuery({
    queryKey: ['approvals', 'PENDING'],
    queryFn: () => apiFetch<Approval[]>('/v1/approvals?status=PENDING'),
    enabled,
    refetchInterval: 60_000,
  });
  return data?.length;
}
