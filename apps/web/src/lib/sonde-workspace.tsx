'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationMessage } from '@orbit/domain';
import { ApiError } from './api-client';
import { useAuth } from './auth-context';
import {
  COPILOT_CONVERSATION_LIST_KEY,
  copilotMessagesKey,
  streamCopilotMessage,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  type SondeMode,
} from './hooks/use-copilot';
import { effectiveSondeContext, useSondeCaseContext } from './sonde-context';

interface WorkspaceStore {
  activeConversationId: string | null;
  selectConversation: (id: string | null) => void;
  draft: string;
  setDraft: (value: string) => void;
  mode: SondeMode;
  setMode: (mode: SondeMode) => void;
  isSending: boolean;
  streamingStatus: string | null;
  error: string | null;
  clearError: () => void;
  /** True, wenn eine Antwort eintraf, während Sonde geschlossen war (Hinweis am Sonde-Button). */
  unreadReply: boolean;
  markRead: () => void;
  send: (overrideContent?: string) => Promise<void>;
  newConversation: () => Promise<void>;
  removeConversation: () => Promise<void>;
  /** Bei laufender Anfrage ist „Neue Unterhaltung“ gesperrt, damit kein laufender Auftrag unbeabsichtigt zurückgesetzt wird (§8.1 SONDE-03). */
  canStartNew: boolean;
}

const WorkspaceContext = createContext<WorkspaceStore | null>(null);

function draftKey(tenantId: string, userId: string): string {
  return `orbit.sonde.draft.${tenantId}.${userId}`;
}

/** Tool-Namen aus dem Backend werden in der Statuszeile nicht roh gezeigt, sondern in verständliche Wörter übersetzt. */
const TOOL_STATUS: Record<string, string> = {
  get_dashboard_summary: 'Sonde prüft die aktuelle Übersicht …',
  list_open_approvals: 'Sonde sucht offene Freigaben …',
  get_case: 'Sonde liest den Vorgang …',
  list_overdue_tasks: 'Sonde prüft überfällige Aufgaben …',
  list_failed_agent_runs: 'Sonde prüft fehlgeschlagene Bearbeitungen …',
  draft_email: 'Sonde bereitet einen Entwurf vor …',
  create_meeting: 'Sonde bereitet einen Terminvorschlag vor …',
  create_booking_proposal: 'Sonde bereitet einen Buchungsvorschlag vor …',
  create_task: 'Sonde legt eine Aufgabe an …',
  create_contact: 'Sonde legt einen Kontakt an …',
  create_lead: 'Sonde legt einen Interessenten an …',
  send_email: 'Sonde bereitet die Freigabe zum Versand vor …',
};

/**
 * Hält Gespräch, Entwurf und Modus außerhalb des Panels: Schließen, Seitenwechsel und Layoutwechsel verlieren weder den
 * ungesendeten Text noch eine laufende Anfrage (UI v2 SONDE-03, AC-09). Jede Nachricht bindet den Kontext, der beim Absenden
 * galt – ein späterer Seitenwechsel schiebt einer laufenden Anfrage keinen anderen Kontext unter.
 */
export function SondeWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const contextStore = useSondeCaseContext();
  const { data: conversations } = useConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraftState] = useState('');
  const [mode, setMode] = useState<SondeMode>('ASK');
  const [isSending, setIsSending] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadReply, setUnreadReply] = useState(false);
  const key = user ? draftKey(user.tenantId, user.id) : null;
  const keyRef = useRef(key);
  keyRef.current = key;

  // Entwurf nach Neuladen wiederherstellen (ungesendeter Text geht nicht verloren).
  useEffect(() => {
    if (!key) {
      setDraftState('');
      return;
    }
    try {
      setDraftState(window.localStorage.getItem(key) ?? '');
    } catch {
      setDraftState('');
    }
  }, [key]);

  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    const current = keyRef.current;
    if (!current) return;
    try {
      if (value) window.localStorage.setItem(current, value);
      else window.localStorage.removeItem(current);
    } catch {
      /* ohne Speicher gilt der Entwurf nur im Arbeitsspeicher */
    }
  }, []);

  useEffect(() => {
    if (!activeConversationId && conversations && conversations.length > 0) {
      setActiveConversationId(conversations[0]!.id);
    }
  }, [conversations, activeConversationId]);

  const newConversation = useCallback(async () => {
    setError(null);
    try {
      const conversation = await createConversation.mutateAsync(undefined);
      setActiveConversationId(conversation.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Unterhaltung konnte nicht angelegt werden. Bitte versuchen Sie es erneut.');
    }
  }, [createConversation]);

  const removeConversation = useCallback(async () => {
    if (!activeConversationId) return;
    const conversationId = activeConversationId;
    setError(null);
    // Erst abwählen, dann löschen: die Nachrichten-Query wird sonst noch beobachtet und lädt die gelöschte Unterhaltung nach (404).
    setActiveConversationId(null);
    try {
      await deleteConversation.mutateAsync(conversationId);
    } catch (err) {
      setActiveConversationId(conversationId);
      setError(err instanceof ApiError ? err.message : 'Die Unterhaltung konnte nicht gelöscht werden.');
    }
  }, [activeConversationId, deleteConversation]);

  const send = useCallback(
    async (overrideContent?: string) => {
      const content = (overrideContent ?? draft).trim();
      if (!content || isSending) return;
      setError(null);

      let conversationId = activeConversationId;
      if (!conversationId) {
        try {
          const conversation = await createConversation.mutateAsync(undefined);
          conversationId = conversation.id;
          setActiveConversationId(conversationId);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Die Unterhaltung konnte nicht angelegt werden. Ihr Text bleibt erhalten.');
          return;
        }
      }
      const targetConversation = conversationId;
      // Kontext und Modus werden JETZT gebunden (Snapshot dieser Nachricht).
      const boundContext = effectiveSondeContext(contextStore);
      const boundMode = mode;

      const previousDraft = overrideContent === undefined ? draft : null;
      if (previousDraft !== null) setDraft('');
      setIsSending(true);
      setStreamingStatus('Sonde bearbeitet Ihre Anfrage …');
      queryClient.setQueryData<ConversationMessage[]>(copilotMessagesKey(targetConversation), (prev) => [
        ...(prev ?? []),
        {
          id: `optimistic-${Date.now()}`,
          tenantId: '',
          conversationId: targetConversation,
          userId: null,
          role: 'USER',
          content,
          agentRunId: null,
          createdAt: new Date(),
        },
      ]);

      await streamCopilotMessage(
        targetConversation,
        content,
        {
          onToolStarted: (toolName) => setStreamingStatus(TOOL_STATUS[toolName] ?? 'Sonde arbeitet …'),
          onToolCompleted: () => setStreamingStatus('Sonde wertet das Ergebnis aus …'),
          onMessageCompleted: () => {
            setStreamingStatus(null);
            setIsSending(false);
            setUnreadReply(true);
            void queryClient.invalidateQueries({ queryKey: copilotMessagesKey(targetConversation) });
            void queryClient.invalidateQueries({ queryKey: COPILOT_CONVERSATION_LIST_KEY });
          },
          onError: (message) => {
            setStreamingStatus(null);
            setIsSending(false);
            // Bei Ausfall bleibt die Eingabe erhalten (§8.6): der Text kehrt in den Entwurf zurück, wenn nichts Neues getippt wurde.
            if (previousDraft !== null) setDraftState((current) => (current === '' ? previousDraft : current));
            setError(`${message} Ihr Text bleibt erhalten – Sie können es erneut versuchen.`);
            void queryClient.invalidateQueries({ queryKey: copilotMessagesKey(targetConversation) });
          },
        },
        { context: boundContext, mode: boundMode },
      );
    },
    [activeConversationId, contextStore, createConversation, draft, isSending, mode, queryClient, setDraft],
  );

  const store = useMemo<WorkspaceStore>(
    () => ({
      activeConversationId,
      selectConversation: setActiveConversationId,
      draft,
      setDraft,
      mode,
      setMode,
      isSending,
      streamingStatus,
      error,
      clearError: () => setError(null),
      unreadReply,
      markRead: () => setUnreadReply(false),
      send,
      newConversation,
      removeConversation,
      canStartNew: !isSending && !createConversation.isPending,
    }),
    [activeConversationId, draft, setDraft, mode, isSending, streamingStatus, error, unreadReply, send, newConversation, removeConversation, createConversation.isPending],
  );

  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}

export function useSondeWorkspace(): WorkspaceStore {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useSondeWorkspace must be used inside SondeWorkspaceProvider');
  return value;
}
