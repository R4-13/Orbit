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
  status: 'COMPLETED' | 'FAILED' | 'WAITING_FOR_APPROVAL' | 'REJECTED';
  steps: Array<{ order: number; agentDefinitionKey: string; skipped: boolean; agentRunId?: string }>;
}

export interface TriggerWorkflowAsyncResult {
  workflowRunId: string;
}

export function useWorkflowDefinitions() {
  return useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => apiFetch<WorkflowDefinitionWithSteps[]>('/v1/workflow-definitions'),
  });
}

export function useWorkflowRuns(key: string | undefined, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ['workflow-definitions', key, 'runs'],
    queryFn: () => apiFetch<WorkflowRunWithStepRuns[]>(`/v1/workflow-definitions/${key}/runs`),
    enabled: Boolean(key),
    refetchInterval: options?.refetchInterval,
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

/**
 * docs/SCALABILITY_CONCEPT.md, Migrationsschritt 3 — nur der Enqueue-Call
 * selbst (202 + WorkflowRun.id, bevor irgendein Schritt gelaufen ist).
 * Anders als `useTriggerWorkflowDefinition()` invalidiert dieser Hook noch
 * NICHT `agent-runs`/`approvals` — das würde zu diesem Zeitpunkt nichts
 * Neues zeigen, weil der Worker-Prozess den Lauf noch gar nicht begonnen
 * hat. Der aufrufende Code muss stattdessen die zurückgegebene
 * `workflowRunId` per Polling gegen `useWorkflowRuns(key, { refetchInterval })`
 * beobachten und erst beim Erreichen von COMPLETED/FAILED invalidieren.
 */
export function useTriggerWorkflowDefinitionAsync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, input }: { key: string; input: Record<string, unknown> }) =>
      apiFetch<TriggerWorkflowAsyncResult>(`/v1/workflow-definitions/${key}/trigger-async`, {
        method: 'POST',
        body: JSON.stringify({ input }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions', variables.key, 'runs'] });
    },
  });
}
