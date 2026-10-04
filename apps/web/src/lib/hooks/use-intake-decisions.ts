import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';

export interface IntakeDecisionItem {
  id: string;
  intakeEventId: string;
  status: string;
  appliedRelevance: string | null;
  category: string | null;
  conciseReason: string | null;
  confidence: { intent: number; relevance: number; extraction: number } | null;
  riskFlags: string[];
  basis: string | null;
  failureReason: string | null;
  execution: { provider: string; model: string | null; mode: string; latencyMs: number } | null;
  subject: string | null;
  sender: { address?: string; displayName?: string } | null;
  occurredAt: string;
  action: 'Keine' | 'Prüfung erforderlich' | 'Triage ausstehend';
  reviewed: { byUserId: string | null; at: string | null; note: string | null; previousRelevance: string | null } | null;
}

export function useIntakeVisibility() {
  return useQuery({ queryKey: ['intake-decisions', 'visibility'], queryFn: () => apiFetch<{ showExcludedByDefault: boolean }>('/v1/intake-decisions/visibility'), staleTime: 5 * 60_000 });
}

export function useExcludedIntake(enabled: boolean) {
  return useQuery({
    queryKey: ['intake-decisions', 'EXCLUDED'],
    queryFn: () => apiFetch<IntakeDecisionItem[]>('/v1/intake-decisions?view=EXCLUDED&limit=50'),
    enabled,
  });
}

/** "Als geschäftsrelevant prüfen": an auditable correction that never starts a process by itself. */
export function useReviewIntakeDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => apiFetch<IntakeDecisionItem>(`/v1/intake-decisions/${id}/review`, { method: 'POST', body: JSON.stringify({ note }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['intake-decisions'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
