import { useQuery } from '@tanstack/react-query';
import type { Company } from '@orbit/domain';
import { apiFetch } from '../api-client';

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: () => apiFetch<Company[]>('/v1/companies'),
  });
}
