import { useQuery } from '@tanstack/react-query';
import type { EntityType } from '@orbit/shared';
import { apiFetch } from '../api-client';
import { useAuth } from '../auth-context';

export interface SearchResult {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string;
  statusLabel?: string;
  href: string;
}

export function useGlobalSearch(query: string) {
  const { user } = useAuth();
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['search', user?.tenantId, trimmed],
    queryFn: () => apiFetch<SearchResult[]>(`/v1/search?q=${encodeURIComponent(trimmed)}`),
    enabled: Boolean(user) && trimmed.length >= 2,
    staleTime: 15_000,
  });
}
