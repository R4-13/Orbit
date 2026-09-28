'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { Badge, Button } from '@orbit/ui';
import type { ConversationMessage } from '@orbit/domain';
import { ApiError } from '../../lib/api-client';
import {
  COPILOT_CONVERSATION_LIST_KEY,
  copilotMessagesKey,
  streamCopilotMessage,
  useConversationMessages,
  useConversations,
  useCopilotCapabilities,
  useCreateConversation,
  useDeleteConversation,
} from '../../lib/hooks/use-copilot';

const FUTURE_MODES = ['Prepare', 'Act', 'Delegate', 'Navigate'] as const;

/**
 * §15/§37 der UI/UX-Spezifikation + Master-Spec §25-33 (Sonde ASK-Mode,
 * Phase 6+7). Verdrahtet gegen das echte /copilot/*-Backend — keine
 * simulierte Konversation mehr. Bewusst weiterhin ehrlich in dem, was NICHT
 * funktioniert: nur "Ask" ist ein echter, klickbarer Modus (das Backend
 * unterstützt aktuell ausschließlich ASK-Mode, siehe GET
 * /copilot/capabilities); Prepare/Act/Delegate/Navigate bleiben als
 * deaktivierte Chips mit erklärendem Tooltip sichtbar, kein Streaming
 * (Antworten erscheinen erst nach vollständigem Abschluss des Turns).
 */
export function SondePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: capabilities } = useCopilotCapabilities();
  const { data: conversations } = useConversations();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading: messagesLoading } = useConversationMessages(activeConversationId);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

  useEffect(() => {
    if (!activeConversationId && conversations && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending, streamingStatus]);

  async function handleNewConversation() {
    setError(null);
    try {
      const conversation = await createConversation.mutateAsync(undefined);
      setActiveConversationId(conversation.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Unterhaltung konnte nicht angelegt werden.');
    }
  }

  async function handleDeleteConversation() {
    if (!activeConversationId) return;
    const conversationId = activeConversationId;
    setError(null);
    // Clear the active conversation *before* awaiting the request so the
    // messages query stops being observed immediately — otherwise it's
    // still mounted (enabled: true) when the mutation's cache cleanup
    // removes its entry, and React Query auto-refetches an actively
    // observed query whose data just vanished, hitting the now-404 endpoint.
    setActiveConversationId(null);
    try {
      await deleteConversation.mutateAsync(conversationId);
    } catch (err) {
      setActiveConversationId(conversationId);
      setError(err instanceof ApiError ? err.message : 'Die Unterhaltung konnte nicht gelöscht werden.');
    }
  }

  async function handleSend() {
    const content = draft.trim();
    if (!content || isSending) return;
    setError(null);

    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const conversation = await createConversation.mutateAsync(undefined);
        conversationId = conversation.id;
        setActiveConversationId(conversationId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Die Unterhaltung konnte nicht angelegt werden.');
        return;
      }
    }

    setDraft('');
    setIsSending(true);
    setStreamingStatus('Sonde denkt nach …');
    // Optimistically shows the user's own message immediately — the SSE
    // turn's `message.completed` (below) triggers a refetch that replaces
    // this local-only entry with the real persisted history.
    queryClient.setQueryData<ConversationMessage[]>(copilotMessagesKey(conversationId), (prev) => [
      ...(prev ?? []),
      {
        id: `optimistic-${Date.now()}`,
        tenantId: '',
        conversationId,
        userId: null,
        role: 'USER',
        content,
        agentRunId: null,
        createdAt: new Date(),
      },
    ]);

    await streamCopilotMessage(conversationId, content, {
      onToolStarted: (toolName) => setStreamingStatus(`Sonde ruft „${toolName}" auf …`),
      onToolCompleted: () => setStreamingStatus('Sonde wertet das Ergebnis aus …'),
      onMessageCompleted: () => {
        setStreamingStatus(null);
        setIsSending(false);
        void queryClient.invalidateQueries({ queryKey: copilotMessagesKey(conversationId) });
        void queryClient.invalidateQueries({ queryKey: COPILOT_CONVERSATION_LIST_KEY });
      },
      onError: (message) => {
        setStreamingStatus(null);
        setIsSending(false);
        setError(message);
        void queryClient.invalidateQueries({ queryKey: copilotMessagesKey(conversationId) });
      },
    });
  }

  return (
    <aside className="flex h-screen w-[400px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Sparkles size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Sonde</p>
            <p className="text-xs text-slate-400">
              {capabilities ? 'Ask-Modus aktiv' : 'Wird geladen …'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="px-1.5"
            onClick={handleNewConversation}
            disabled={createConversation.isPending}
            aria-label="Neue Unterhaltung"
            title="Neue Unterhaltung"
          >
            <Plus size={16} />
          </Button>
          {activeConversationId ? (
            <Button
              variant="ghost"
              className="px-1.5"
              onClick={handleDeleteConversation}
              disabled={deleteConversation.isPending}
              aria-label="Unterhaltung löschen"
              title="Unterhaltung löschen"
            >
              <Trash2 size={16} />
            </Button>
          ) : null}
          <Button variant="ghost" className="px-1.5" onClick={onClose} aria-label="Sonde schließen">
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5">
        <Badge tone="success">Ask</Badge>
        {FUTURE_MODES.map((mode) => (
          <Badge key={mode} tone="neutral" title={`${mode}-Modus ist noch nicht verfügbar`} className="opacity-50">
            {mode}
          </Badge>
        ))}
      </div>

      {conversations && conversations.length > 0 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 px-4 py-2">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => setActiveConversationId(conversation.id)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                conversation.id === activeConversationId
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {conversation.title ?? 'Unterhaltung'}
            </button>
          ))}
        </div>
      ) : null}

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {!activeConversationId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-300">
              <Sparkles size={22} />
            </span>
            <p className="text-sm font-medium text-slate-700">Stellen Sie Sonde eine Frage</p>
            <p className="text-xs text-slate-400">
              Sonde kann im Ask-Modus offene Vorgänge, Freigaben und Fälle für Sie nachschlagen.
            </p>
          </div>
        ) : messagesLoading ? (
          <div className="flex flex-1 items-center justify-center text-slate-300">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : messages && messages.length > 0 ? (
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                message.role === 'USER'
                  ? 'ml-auto bg-brand text-brand-foreground'
                  : 'mr-auto bg-slate-100 text-slate-800'
              }`}
            >
              {message.content}
            </div>
          ))
        ) : (
          <p className="text-center text-xs text-slate-400">Noch keine Nachrichten in dieser Unterhaltung.</p>
        )}

        {isSending ? (
          <div className="mr-auto flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            {streamingStatus ?? 'Sonde antwortet …'}
          </div>
        ) : null}
      </div>

      {error ? <p className="px-4 pb-2 text-xs text-red-600">{error}</p> : null}

      <div className="border-t border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            disabled={isSending || createConversation.isPending}
            placeholder="Fragen Sie Sonde etwas …"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:bg-slate-50"
          />
          <Button
            variant="primary"
            className="px-2.5"
            onClick={() => void handleSend()}
            disabled={!draft.trim() || isSending || createConversation.isPending}
            aria-label="Senden"
          >
            <Send size={16} />
          </Button>
        </div>
      </div>
    </aside>
  );
}
