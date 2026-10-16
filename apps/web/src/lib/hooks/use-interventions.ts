import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';

export interface InterventionReport {
  days: number;
  generatedAt: string;
  truncated: boolean;
  cases: { total: number; automated: number; withHuman: number; running: number; automationRate: number | null; byType: Array<{ type: string; total: number; withHuman: number }> };
  attention: { total: number; open: number; byKind: Array<{ kind: string; count: number }>; medianReactionMinutes: number | null };
  approvals: { total: number; approved: number; rejected: number; pending: number; byAction: Array<{ action: string; approved: number; rejected: number; pending: number; rejectionRate: number | null }> };
  topReasons: Array<{ reason: string; count: number }>;
  suggestions: Array<{ kind: 'OFT_ABGELEHNT' | 'IMMER_FREIGEGEBEN' | 'HAEUFIGER_GRUND' | 'LANGSAME_REAKTION'; subject: string; message: string; evidence: string }>;
}

export function useInterventionReport(days: number) {
  return useQuery({
    queryKey: ['interventions-report', days],
    queryFn: () => apiFetch<InterventionReport>(`/v1/reports/interventions?days=${days}`),
  });
}
