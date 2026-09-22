import { useQuery } from '@tanstack/react-query';
import type { AgentRun, AgentType, ToolInvocation } from '@orbit/domain';
import { apiFetch } from '../api-client';

export type AgentRunDetail = AgentRun & { toolInvocations: ToolInvocation[] };

export function useAgentRuns(query?: { agentType?: AgentType; caseId?: string }) {
  const params = new URLSearchParams();
  if (query?.agentType) params.set('agentType', query.agentType);
  if (query?.caseId) params.set('caseId', query.caseId);
  const qs = params.toString();

  return useQuery({
    queryKey: ['agent-runs', query?.agentType ?? 'all', query?.caseId ?? 'all'],
    queryFn: () => apiFetch<AgentRunDetail[]>(`/v1/agent-runs${qs ? `?${qs}` : ''}`),
  });
}

export function useAgentRun(id: string) {
  return useQuery({
    queryKey: ['agent-runs', id],
    queryFn: () => apiFetch<AgentRunDetail>(`/v1/agent-runs/${id}`),
    enabled: Boolean(id),
  });
}
