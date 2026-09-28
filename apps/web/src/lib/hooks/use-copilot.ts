import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Conversation, ConversationMessage } from '@orbit/domain';
import { apiFetch } from '../api-client';

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
const CONVERSATION_LIST_KEY = ['copilot', 'conversation-list'];
const messagesKey = (conversationId: string | null) => ['copilot', 'messages', conversationId];

export function useConversations() {
  return useQuery({
    queryKey: CONVERSATION_LIST_KEY,
    queryFn: () => apiFetch<Conversation[]>('/v1/copilot/conversations'),
  });
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: messagesKey(conversationId),
    queryFn: () => apiFetch<ConversationMessage[]>(`/v1/copilot/conversations/${conversationId}/messages`),
    enabled: conversationId !== null,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) =>
      apiFetch<Conversation>('/v1/copilot/conversations', { method: 'POST', body: JSON.stringify({ title }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONVERSATION_LIST_KEY }),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<void>(`/v1/copilot/conversations/${conversationId}`, { method: 'DELETE' }),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: CONVERSATION_LIST_KEY });
      // removeQueries, not invalidateQueries: the conversation is gone, so
      // refetching its messages would just 404.
      queryClient.removeQueries({ queryKey: messagesKey(conversationId) });
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
      queryClient.invalidateQueries({ queryKey: messagesKey(conversationId) });
      queryClient.invalidateQueries({ queryKey: CONVERSATION_LIST_KEY });
    },
  });
}
