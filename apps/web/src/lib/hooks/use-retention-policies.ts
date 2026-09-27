import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RetentionCategory, RetentionPolicy } from '@orbit/domain';
import { apiFetch } from '../api-client';

export interface RetentionPreview {
  category: RetentionCategory;
  retentionDays: number;
  cutoffAt: string;
  matchingCount: number;
  oldestMatchingAt: string | null;
  newestMatchingAt: string | null;
}

export interface RetentionApplyResult {
  category: RetentionCategory;
  retentionDays: number;
  cutoffAt: string;
  deletedCount: number;
}

export function useRetentionPolicies() {
  return useQuery({
    queryKey: ['retention-policies'],
    queryFn: () => apiFetch<RetentionPolicy[]>('/v1/retention-policies'),
  });
}

export function useUpdateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ category, retentionDays }: { category: RetentionCategory; retentionDays: number }) =>
      apiFetch<RetentionPolicy>(`/v1/retention-policies/${category}`, {
        method: 'PUT',
        body: JSON.stringify({ retentionDays }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['retention-policies'] }),
  });
}

/** On-demand dry-run: only fetched when a caller explicitly calls `refetch()` — never automatically, since it's only meaningful right before a manual apply. */
export function useRetentionPreview(category: RetentionCategory) {
  return useQuery({
    queryKey: ['retention-preview', category],
    queryFn: () => apiFetch<RetentionPreview>(`/v1/retention-policies/${category}/preview`),
    enabled: false,
    retry: false,
  });
}

export function useApplyRetention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (category: RetentionCategory) =>
      apiFetch<RetentionApplyResult>(`/v1/retention-policies/${category}/apply`, { method: 'POST' }),
    onSuccess: (_data, category) => {
      queryClient.invalidateQueries({ queryKey: ['retention-policies'] });
      queryClient.invalidateQueries({ queryKey: ['retention-preview', category] });
    },
  });
}
