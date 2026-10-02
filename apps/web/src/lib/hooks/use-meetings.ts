import { useQuery } from '@tanstack/react-query';
import type { Meeting } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useMeetings() {
  return useQuery({
    queryKey: ['meetings'],
    queryFn: () => apiFetch<Meeting[]>('/v1/meetings'),
  });
}
