import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionDescriptor, CaseCommandType, CaseGraphView, CaseNodeDetail } from '@orbit/shared';
import { ApiError, apiFetch, apiFetchStream } from '../api-client';

export type OrchestrationMode = 'COMBINED' | 'ACTUAL' | 'DEFINITION';

export interface CaseEventRow {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

/** The orchestration graph, exactly as the server projects it. The client derives no state of its own. */
export function useOrchestration(caseId: string, options: { mode: OrchestrationMode; planRevision?: number }) {
  const params = new URLSearchParams({ mode: options.mode });
  if (options.planRevision) params.set('planRevision', String(options.planRevision));
  return useQuery({
    queryKey: ['orchestration', caseId, options.mode, options.planRevision ?? 'latest'],
    queryFn: () => apiFetch<CaseGraphView>(`/v1/cases/${caseId}/orchestration?${params.toString()}`),
    enabled: Boolean(caseId),
  });
}

export function useNodeDetail(caseId: string, nodeId: string | null, planRevision?: number) {
  return useQuery({
    queryKey: ['orchestration-node', caseId, nodeId, planRevision ?? 'latest'],
    queryFn: () => apiFetch<CaseNodeDetail>(`/v1/cases/${caseId}/orchestration/nodes/${encodeURIComponent(nodeId ?? '')}${planRevision ? `?planRevision=${planRevision}` : ''}`),
    enabled: Boolean(caseId && nodeId),
  });
}

export function useCaseEventHistory(caseId: string) {
  return useQuery({
    queryKey: ['case-events', caseId],
    queryFn: () => apiFetch<CaseEventRow[]>(`/v1/cases/${caseId}/events?limit=500`),
    enabled: Boolean(caseId),
  });
}

export interface CommandInput {
  action: ActionDescriptor;
  /** Values the user typed into the action's form fields. */
  values?: Record<string, string>;
}

export class StaleViewError extends Error {
  constructor(public readonly currentRevision?: number) {
    super('Der Vorgang wurde inzwischen geändert. Die Ansicht wurde aktualisiert — bitte prüfen Sie die Aktion erneut.');
    this.name = 'StaleViewError';
  }
}

/** Builds the command payload from the action's fixed payload plus the typed form values (only declared fields are sent). */
export function buildCommandPayload(action: ActionDescriptor, values: Record<string, string> = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(action.payload ?? {}) };
  const typed: Record<string, unknown> = {};
  for (const field of action.fields) {
    const raw = values[field.name]?.trim();
    if (raw === undefined || raw === '') continue;
    typed[field.name] = field.type === 'number' ? Number(raw) : raw;
  }
  switch (action.commandKey) {
    case 'ADD_FACTS':
      return { facts: [{ key: typed.key, value: typed.value }] };
    case 'COMPLETE_MANUAL_TASK':
      return { ...payload, result: { ...(payload.result as object | undefined), ...(typed.note ? { note: typed.note } : {}) } };
    default:
      return { ...payload, ...typed };
  }
}

/**
 * Sends one validated command (`POST /cases/:id/commands`). The id makes the request idempotent end to end, the revision
 * binds it to the state the user was looking at. A 409 means that state is outdated: the views are refetched and the
 * caller gets a `StaleViewError` instead of silently applying the action to something the user has not seen.
 */
export function useCaseCommand(caseId: string) {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['orchestration', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['orchestration-node', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['case-events', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['cases', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  };
  return useMutation({
    mutationFn: async ({ action, values }: CommandInput) => {
      try {
        return await apiFetch<{ commandId: string; status: string; caseRevision: number; replayed: boolean }>(`/v1/cases/${caseId}/commands`, {
          method: 'POST',
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            type: action.commandKey as CaseCommandType,
            expectedCaseRevision: action.expectedCaseRevision,
            ...(action.targetRef ? { targetRef: action.targetRef } : {}),
            payload: buildCommandPayload(action, values),
          }),
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          refresh();
          throw new StaleViewError((error.details as { currentRevision?: number } | undefined)?.currentRevision);
        }
        throw error;
      }
    },
    onSuccess: refresh,
  });
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/**
 * Live updates (Amendment 02 §18.2). Opens the case event stream with the sequence cursor and refreshes the views when
 * events arrive. After an interruption it reconnects from the last seen sequence — a gap is impossible because the
 * server replays everything after the cursor. While disconnected the status says so; nothing is shown as live then.
 */
export function useCaseEventStream(caseId: string, enabled = true): { status: StreamStatus; lastSequence: number } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [lastSequence, setLastSequence] = useState(0);
  const cursor = useRef(0);

  useEffect(() => {
    if (!caseId || !enabled) return;
    const controller = new AbortController();
    let attempt = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = (): void => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void queryClient.invalidateQueries({ queryKey: ['orchestration', caseId] });
        void queryClient.invalidateQueries({ queryKey: ['orchestration-node', caseId] });
        void queryClient.invalidateQueries({ queryKey: ['case-events', caseId] });
        void queryClient.invalidateQueries({ queryKey: ['cases', caseId] });
      }, 250);
    };

    const run = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        try {
          setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
          const response = await apiFetchStream(`/v1/cases/${caseId}/events/stream?after=${cursor.current}`, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
          if (!response.body) throw new Error('no stream body');
          setStatus('live');
          attempt = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() ?? '';
            for (const block of blocks) {
              const id = /^id: (\d+)$/m.exec(block);
              if (id && /^event: case-event$/m.test(block)) {
                cursor.current = Number(id[1]);
                setLastSequence(cursor.current);
                scheduleRefresh();
              }
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          // A 4xx (not found / forbidden) will not heal by retrying.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401) {
            setStatus('offline');
            return;
          }
        }
        if (controller.signal.aborted) return;
        attempt += 1;
        setStatus('reconnecting');
        await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4))));
      }
    };
    void run();
    return () => {
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [caseId, enabled, queryClient]);

  return { status, lastSequence };
}
