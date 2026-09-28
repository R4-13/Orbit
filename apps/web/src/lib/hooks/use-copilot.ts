import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Conversation, ConversationMessage } from '@orbit/domain';
import { ApiError, apiFetch, apiFetchStream } from '../api-client';

export interface CopilotCapabilities {
  mode: 'ASK';
  tools: string[];
}

export function useCopilotCapabilities() {
  return useQuery({
    queryKey: ['copilot', 'capabilities'],
    queryFn: () => apiFetch<CopilotCapabilities>('/v1/copilot/capabilities'),
    staleTime: 5 * 60 * 1000,
  });
}

// Deliberately NOT a prefix of the messages query key below (which starts
// with 'copilot'/'messages', not 'copilot'/'conversation-list') — React
// Query's invalidateQueries matches by key prefix, so sharing a prefix
// would also invalidate/refetch an unrelated (or, for delete, just-deleted
// and now 404ing) conversation's messages every time the list changes.
export const COPILOT_CONVERSATION_LIST_KEY = ['copilot', 'conversation-list'];
export const copilotMessagesKey = (conversationId: string | null) => ['copilot', 'messages', conversationId];

export function useConversations() {
  return useQuery({
    queryKey: COPILOT_CONVERSATION_LIST_KEY,
    queryFn: () => apiFetch<Conversation[]>('/v1/copilot/conversations'),
  });
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: copilotMessagesKey(conversationId),
    queryFn: () => apiFetch<ConversationMessage[]>(`/v1/copilot/conversations/${conversationId}/messages`),
    enabled: conversationId !== null,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) =>
      apiFetch<Conversation>('/v1/copilot/conversations', { method: 'POST', body: JSON.stringify({ title }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COPILOT_CONVERSATION_LIST_KEY }),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<void>(`/v1/copilot/conversations/${conversationId}`, { method: 'DELETE' }),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: COPILOT_CONVERSATION_LIST_KEY });
      // removeQueries, not invalidateQueries: the conversation is gone, so
      // refetching its messages would just 404.
      queryClient.removeQueries({ queryKey: copilotMessagesKey(conversationId) });
    },
  });
}

/**
 * Optimistically appends the user's own message before the request
 * completes (perceived latency of a real ASK-mode turn is roughly the
 * LLM round-trip, ~1-3s) — the server response (both persisted messages,
 * incl. the real assistant reply) replaces it via a refetch on success.
 */
export function useSendMessage(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => {
      if (!conversationId) throw new Error('No conversation selected');
      return apiFetch<ConversationMessage>(`/v1/copilot/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: copilotMessagesKey(conversationId) });
      queryClient.invalidateQueries({ queryKey: COPILOT_CONVERSATION_LIST_KEY });
    },
  });
}

export interface CopilotStreamHandlers {
  onToolStarted?: (toolName: string) => void;
  onToolCompleted?: (toolName: string, decision: string, error?: string) => void;
  onMessageCompleted?: (message: ConversationMessage) => void;
  onError?: (message: string) => void;
}

/**
 * §33 des Master-Dokuments ("Sonde action cards, streaming and API") —
 * konsumiert `POST /copilot/conversations/:id/messages/stream` über einen
 * rohen `fetch()` + `ReadableStream`-Reader statt des nativen
 * `EventSource`: `EventSource` unterstützt weder POST-Bodies noch eigene
 * Header, kann also den Authorization-Bearer-Token nicht mitschicken.
 * Keine react-query-Query/-Mutation — ein offener Stream mit mehreren
 * Zwischen-Events passt nicht in deren Request/Response-Cache-Modell; der
 * Aufrufer (SondePanel) hält den Fortschritt selbst in lokalem State und
 * invalidiert die betroffenen Queries in `onMessageCompleted`.
 *
 * Bewusst ohne `apiFetch`s automatischen 401-Refresh-und-Retry (siehe
 * `authenticatedFetch` in api-client.ts) — ein Zugriffstoken, das exakt
 * während eines offenen SSE-Streams abläuft, ist ein schmaler Randfall;
 * `onError` zeigt die verständliche deutsche Fehlermeldung, statt eine
 * zweite, stream-spezifische Refresh-Implementierung zu duplizieren.
 */
export async function streamCopilotMessage(
  conversationId: string,
  content: string,
  handlers: CopilotStreamHandlers,
): Promise<void> {
  let response: Response;
  try {
    response = await apiFetchStream(`/v1/copilot/conversations/${conversationId}/messages/stream`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    handlers.onError?.(err instanceof ApiError ? err.message : 'Die Verbindung zu Sonde ist fehlgeschlagen.');
    return;
  }

  if (!response.body) {
    handlers.onError?.('Die Verbindung zu Sonde ist fehlgeschlagen.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      dispatchSseFrame(buffer.slice(0, boundary), handlers);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function dispatchSseFrame(frame: string, handlers: CopilotStreamHandlers): void {
  const lines = frame.split('\n');
  const eventLine = lines.find((line) => line.startsWith('event: '));
  const dataLine = lines.find((line) => line.startsWith('data: '));
  if (!eventLine || !dataLine) return;

  const eventType = eventLine.slice('event: '.length);
  let data: unknown;
  try {
    data = JSON.parse(dataLine.slice('data: '.length));
  } catch {
    return;
  }
  if (typeof data !== 'object' || data === null) return;
  const record = data as Record<string, unknown>;

  switch (eventType) {
    case 'tool.started':
      if (typeof record.toolName === 'string') handlers.onToolStarted?.(record.toolName);
      break;
    case 'tool.completed':
      if (typeof record.toolName === 'string' && typeof record.decision === 'string') {
        handlers.onToolCompleted?.(record.toolName, record.decision, typeof record.error === 'string' ? record.error : undefined);
      }
      break;
    case 'message.completed':
      handlers.onMessageCompleted?.(data as ConversationMessage);
      break;
    case 'error':
      if (typeof record.message === 'string') handlers.onError?.(record.message);
      break;
    default:
      break;
  }
}
