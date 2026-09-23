import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowDefinition, WorkflowRun, WorkflowStepDefinition, WorkflowStepRun } from '@orbit/domain';
import { apiFetch } from '../api-client';

export type WorkflowDefinitionWithSteps = WorkflowDefinition & { steps: WorkflowStepDefinition[] };
export type WorkflowRunWithStepRuns = WorkflowRun & { stepRuns: WorkflowStepRun[] };

export interface WorkflowStepInput {
  order: number;
  agentDefinitionKey: string;
  inputMapping?: Record<string, string>;
  condition?: { field: string; equals: string };
}

export interface CreateWorkflowDefinitionInput {
  key: string;
  name: string;
  description?: string;
  triggerType: 'EMAIL' | 'WEBHOOK' | 'SCHEDULE' | 'MANUAL';
  steps: WorkflowStepInput[];
}

export interface UpdateWorkflowDefinitionInput {
  name?: string;
  description?: string;
  steps?: WorkflowStepInput[];
  status?: 'DRAFT' | 'ACTIVE' | 'DISABLED';
}

export interface WorkflowRunResult {
  workflowRunId: string;
  status: 'COMPLETED' | 'FAILED';
  steps: Array<{ order: number; agentDefinitionKey: string; skipped: boolean; agentRunId?: string }>;
}

export function useWorkflowDefinitions() {
  return useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => apiFetch<WorkflowDefinitionWithSteps[]>('/v1/workflow-definitions'),
  });
}

export function useWorkflowRuns(key: string | undefined) {
  return useQuery({
    queryKey: ['workflow-definitions', key, 'runs'],
    queryFn: () => apiFetch<WorkflowRunWithStepRuns[]>(`/v1/workflow-definitions/${key}/runs`),
    enabled: Boolean(key),
  });
}

export function useCreateWorkflowDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkflowDefinitionInput) =>
      apiFetch<WorkflowDefinitionWithSteps>('/v1/workflow-definitions', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] }),
  });
}

export function useUpdateWorkflowDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...input }: UpdateWorkflowDefinitionInput & { key: string }) =>
      apiFetch<WorkflowDefinitionWithSteps>(`/v1/workflow-definitions/${key}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] }),
  });
}

export function useTriggerWorkflowDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, input }: { key: string; input: Record<string, unknown> }) =>
      apiFetch<WorkflowRunResult>(`/v1/workflow-definitions/${key}/trigger`, { method: 'POST', body: JSON.stringify({ input }) }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions', variables.key, 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}
