import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentRun,
  Case,
  CaseStatus,
  CaseType,
  Document,
  EmailMessage,
  Invoice,
  Lead,
  Task,
  ToolInvocation,
} from '@orbit/domain';
import { apiFetch } from '../api-client';

export type CaseDetail = Case & {
  tasks: Task[];
  documents: Document[];
  emailMessages: EmailMessage[];
  invoices: Invoice[];
  leads: Lead[];
  agentRuns: Array<AgentRun & { toolInvocations: ToolInvocation[] }>;
};

export function useCases(query?: { type?: CaseType; status?: CaseStatus }) {
  const params = new URLSearchParams();
  if (query?.type) params.set('type', query.type);
  if (query?.status) params.set('status', query.status);
  const qs = params.toString();

  return useQuery({
    queryKey: ['cases', query?.type ?? 'all', query?.status ?? 'all'],
    queryFn: () => apiFetch<Case[]>(`/v1/cases${qs ? `?${qs}` : ''}`),
  });
}

export function useCase(id: string) {
  return useQuery({
    queryKey: ['cases', id],
    queryFn: () => apiFetch<CaseDetail>(`/v1/cases/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateCaseStatus(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: CaseStatus) =>
      apiFetch<Case>(`/v1/cases/${caseId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases', caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}
