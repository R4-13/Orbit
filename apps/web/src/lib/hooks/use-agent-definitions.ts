import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDefinition, AgentDefinitionVersion } from '@orbit/domain';
import { apiFetch } from '../api-client';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  policyAction: string;
  inputSchema: Record<string, unknown>;
}

export interface CreateAgentDefinitionInput {
  key: string;
  name: string;
  description?: string;
  baseType: 'ORCHESTRATOR' | 'COMMUNICATION' | 'FINANCE' | 'SALES';
  systemPrompt: string;
  allowedTools: string[];
}

export interface UpdateAgentDefinitionInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  status?: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  changeNote?: string;
}

export interface ToolCallOutcome {
  toolCallId: string;
  toolName: string;
  decision: 'ALLOW' | 'SUGGEST_ONLY' | 'REQUIRE_APPROVAL' | 'DENY';
  output?: unknown;
  error?: string;
}

export interface TestRunResult {
  agentRunId: string;
  toolCallOutcomes: ToolCallOutcome[];
}

export interface EvaluationCase {
  id: string;
  agentDefinitionKey: string;
  name: string;
  userMessage: string;
  expectedTools: string[];
  forbiddenTools: string[];
  expectedApprovalRequired: boolean | null;
  critical: boolean;
  createdAt: string;
}

export interface CreateEvaluationCaseInput {
  name: string;
  userMessage: string;
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectedApprovalRequired?: boolean;
  critical?: boolean;
}

export interface EvaluationCaseResult {
  evaluationCaseId: string;
  name: string;
  critical: boolean;
  agentRunId: string;
  passed: boolean;
  failures: string[];
  toolCallOutcomes: ToolCallOutcome[];
}

export function useAgentDefinitions() {
  return useQuery({
    queryKey: ['agent-definitions'],
    queryFn: () => apiFetch<AgentDefinition[]>('/v1/agent-definitions'),
  });
}

export function useToolCatalog() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: () => apiFetch<ToolCatalogEntry[]>('/v1/tools'),
  });
}

export function useAgentDefinitionVersions(key: string | undefined) {
  return useQuery({
    queryKey: ['agent-definitions', key, 'versions'],
    queryFn: () => apiFetch<AgentDefinitionVersion[]>(`/v1/agent-definitions/${key}/versions`),
    enabled: Boolean(key),
  });
}

export function useCreateAgentDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentDefinitionInput) =>
      apiFetch<AgentDefinition>('/v1/agent-definitions', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-definitions'] }),
  });
}

export function useUpdateAgentDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...input }: UpdateAgentDefinitionInput & { key: string }) =>
      apiFetch<AgentDefinition>(`/v1/agent-definitions/${key}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-definitions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-definitions', variables.key, 'versions'] });
    },
  });
}

export function useRollbackAgentDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, version }: { key: string; version: number }) =>
      apiFetch<AgentDefinition>(`/v1/agent-definitions/${key}/rollback/${version}`, { method: 'POST' }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-definitions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-definitions', variables.key, 'versions'] });
    },
  });
}

export function useTestRunAgentDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, userMessage }: { key: string; userMessage: string }) =>
      apiFetch<TestRunResult>(`/v1/agent-definitions/${key}/test-run`, { method: 'POST', body: JSON.stringify({ userMessage }) }),
    onSuccess: () => {
      // A test run creates a completely ordinary AgentRun/ToolInvocation
      // and, for a blocked tool call, an Approval — same records a real
      // call produces (see AgentDefinitionTestRunService's own comment).
      queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

export function useEvaluationCases(key: string | undefined) {
  return useQuery({
    queryKey: ['agent-definitions', key, 'evaluation-cases'],
    queryFn: () => apiFetch<EvaluationCase[]>(`/v1/agent-definitions/${key}/evaluation-cases`),
    enabled: Boolean(key),
  });
}

export function useCreateEvaluationCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...input }: CreateEvaluationCaseInput & { key: string }) =>
      apiFetch<EvaluationCase>(`/v1/agent-definitions/${key}/evaluation-cases`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['agent-definitions', variables.key, 'evaluation-cases'] }),
  });
}

export function useDeleteEvaluationCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, caseId }: { key: string; caseId: string }) =>
      apiFetch<void>(`/v1/agent-definitions/${key}/evaluation-cases/${caseId}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['agent-definitions', variables.key, 'evaluation-cases'] }),
  });
}

export function useRunEvaluationSuite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<EvaluationCaseResult[]>(`/v1/agent-definitions/${key}/evaluate`, { method: 'POST' }),
    onSuccess: () => {
      // Same real-side-effect rationale as useTestRunAgentDefinition — an
      // evaluation run is a real AgentRun/ToolInvocation, and a blocked
      // outcome creates a real Approval.
      queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}
