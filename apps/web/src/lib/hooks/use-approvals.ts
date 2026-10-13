import { useQuery } from '@tanstack/react-query';
import type { Approval } from '@orbit/domain';
import { apiFetch } from '../api-client';

/** Anzahl offener Freigaben für das Navigations-Badge – fragt nur mit Leserecht an. */
export function useApprovalCount(enabled: boolean): number | undefined {
  const { data } = useQuery({
    queryKey: ['approvals', 'PENDING'],
    queryFn: () => apiFetch<Approval[]>('/v1/approvals?status=PENDING'),
    enabled,
    refetchInterval: 60_000,
  });
  return data?.length;
}
