'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, History, Link2, Link2Off, Loader2, Pin, PinOff, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { SONDE_MODE_LABELS, type SondeModeKey } from '@orbit/shared';
import { useConversationMessages, useConversations, useCopilotCapabilities, type SondeMode } from '../../lib/hooks/use-copilot';
import { effectiveSondeContext, useSondeCaseContext } from '../../lib/sonde-context';
import { useSondeWorkspace } from '../../lib/sonde-workspace';

/**
 * Vorschlags-Chips (Sonde-Konzept §27/§28): anklickbar, nie automatisch eingeblendet oder gesendet. Die erste Frage ist
 * wörtlich das Beispiel „Was braucht heute meine Aufmerksamkeit?“.
 */
const QUICK_PROMPTS = ['Was braucht heute meine Aufmerksamkeit?', 'Zeige offene Freigaben'] as const;

const MODE_ORDER: SondeModeKey[] = ['ASK', 'PREPARE', 'ACT', 'DELEGATE', 'NAVIGATE'];
const MAX_COMPOSER_HEIGHT = 120; // ≈ 5 Zeilen, danach scrollt das Eingabefeld selbst (§8.1 SONDE-02)

function readinessLabel(capabilities: ReturnType<typeof useCopilotCapabilities>['data'], failed: boolean): { text: string; tone: 'ok' | 'warn' | 'error' } {
  if (failed) return { text: 'Nicht erreichbar', tone: 'error' };
  if (!capabilities) return { text: 'Wird geladen …', tone: 'warn' };
  const readiness = capabilities.readiness;
  if (!readiness) return { text: 'Bereit', tone: 'ok' };
  if (readiness.health === 'ERROR') return { text: 'Modell gestört', tone: 'error' };
  if (readiness.health === 'SIMULATED') return { text: 'Simulationsmodus – kein echtes Modell', tone: 'warn' };
  if (readiness.health === 'VERIFIED') return { text: 'Bereit', tone: 'ok' };
  return { text: 'Bereit – Modell noch nicht geprüft', tone: 'warn' };
}

const TONE_CLASS = { ok: 'text-emerald-700', warn: 'text-amber-700', error: 'text-red-700' } as const;

/**
 * UI/UX v2 §8: Sonde als durchgängig erreichbarer Arbeitszugang. Der Aufbau ist ein Grid mit genau einer flexiblen Zeile –
 * nur die Nachrichtenliste scrollt; Kopf, Kontext, Modus und Eingabe bleiben sichtbar (SONDE-01/02). Der Zustand lebt im
 * `SondeWorkspaceProvider`, nicht hier: Schließen und Seitenwechsel verlieren weder Entwurf noch laufende Anfrage.
 */
export function SondePanel({ onClose, autoFocus = false }: { onClose: () => void; autoFocus?: boolean }) {
  const workspace = useSondeWorkspace();
  const contextStore = useSondeCaseContext();
  const { data: capabilities, isError: capabilitiesFailed } = useCopilotCapabilities();
  const { data: conversations } = useConversations();
  const { data: messages, isLoading: messagesLoading } = useConversationMessages(workspace.activeConversationId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);

  const readiness = readinessLabel(capabilities, capabilitiesFailed);
  const sentContext = effectiveSondeContext(contextStore);
  const contextLabel = contextStore.contextDisabled
    ? 'Ohne Kontext'
    : (contextStore.pinned?.label ?? contextStore.context?.label ?? contextStore.pageLabel ?? 'Aktuelle Seite');
  const activeConversation = conversations?.find((c) => c.id === workspace.activeConversationId);

  // Eine Antwort, die während der geöffneten Ansicht eintrifft, ist gelesen.
  useEffect(() => {
    workspace.markRead();
  }, [workspace, messages?.length]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // Wächst das Eingabefeld, dann begrenzt (≈ 5 Zeilen) – danach scrollt es selbst.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [workspace.draft]);

  // Streaming erzwingt kein Scrollen, wenn der Nutzer ältere Nachrichten liest (§8.4): „Neue Antwort“ führt dorthin.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTo({ top: el.scrollHeight });
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [messages, workspace.isSending, workspace.streamingStatus]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottom.current = nearBottom;
    if (nearBottom) setShowJump(false);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowJump(false);
  }

  const busy = workspace.isSending;

  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[auto_auto_auto_minmax(0,1fr)_auto_auto] bg-white text-slate-900">
      {/* 1 · Kopf */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight">Sonde</h2>
            <p className={`truncate text-xs ${TONE_CLASS[readiness.tone]}`} role="status">
              {readiness.text}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              aria-haspopup="menu"
              aria-label="Verlauf der Unterhaltungen"
              title="Verlauf"
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
            >
              <History size={17} />
            </button>
            {historyOpen ? (
              <div role="menu" className="absolute right-0 top-10 z-20 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                {conversations && conversations.length > 0 ? (
                  conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      role="menuitemradio"
                      aria-checked={conversation.id === workspace.activeConversationId}
                      onClick={() => {
                        workspace.selectConversation(conversation.id);
                        setHistoryOpen(false);
                      }}
                      className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 ${conversation.id === workspace.activeConversationId ? 'bg-slate-100 font-medium' : ''}`}
                    >
                      {conversation.title ?? 'Unterhaltung'}
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-sm text-slate-500">Noch keine Unterhaltungen.</p>
                )}
                {workspace.activeConversationId ? (
                  <button
                    role="menuitem"
                    disabled={busy}
                    onClick={() => {
                      setHistoryOpen(false);
                      void workspace.removeConversation();
                    }}
                    className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-slate-100 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={14} /> Unterhaltung löschen
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void workspace.newConversation()}
            disabled={!workspace.canStartNew}
            aria-label="Neue Unterhaltung"
            title={busy ? 'Eine Anfrage läuft noch' : 'Neue Unterhaltung'}
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            <Plus size={18} />
          </button>
          <button type="button" onClick={onClose} aria-label="Sonde schließen" className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 2 · Kontext */}
      <div className="relative flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        {sentContext ? <Link2 size={14} className="shrink-0" aria-hidden="true" /> : <Link2Off size={14} className="shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">
          <span className="text-slate-500">Kontext: </span>
          <span className="font-medium text-slate-800">{contextLabel}</span>
          {contextStore.pinned ? <span className="ml-1 text-slate-500">(fixiert)</span> : null}
        </span>
        <button
          type="button"
          onClick={() => setContextMenuOpen((open) => !open)}
          aria-expanded={contextMenuOpen}
          aria-haspopup="menu"
          className="shrink-0 rounded-md px-2 py-1 font-medium text-brand hover:bg-white"
        >
          Kontext ändern
        </button>
        {contextMenuOpen ? (
          <div role="menu" className="absolute right-4 top-9 z-20 w-60 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-800 shadow-lg">
            <button
              role="menuitem"
              className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-100"
              onClick={() => {
                contextStore.setContextDisabled(false);
                contextStore.pin(null);
                setContextMenuOpen(false);
              }}
            >
              Aktuelle Seite verwenden
            </button>
            <button
              role="menuitem"
              className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-100"
              onClick={() => {
                contextStore.setContextDisabled(true);
                setContextMenuOpen(false);
              }}
            >
              Ohne Kontext fragen
            </button>
            {contextStore.context ? (
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-slate-100"
                onClick={() => {
                  contextStore.pin(contextStore.pinned ? null : contextStore.context);
                  contextStore.setContextDisabled(false);
                  setContextMenuOpen(false);
                }}
              >
                {contextStore.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                {contextStore.pinned ? 'Fixierung lösen' : 'Diesen Vorgang fixieren'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 3 · Modus */}
      <div className="border-b border-slate-100 px-4 py-2.5">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600" htmlFor="sonde-mode">
          Modus
          <select
            id="sonde-mode"
            value={workspace.mode}
            onChange={(event) => workspace.setMode(event.target.value as SondeMode)}
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {MODE_ORDER.map((key) => {
              const available = capabilities?.modes.includes(key as SondeMode) ?? key === 'ASK';
              return (
                <option key={key} value={key} disabled={!available}>
                  {SONDE_MODE_LABELS[key].label}
                  {available ? '' : ' (noch nicht verfügbar)'}
                </option>
              );
            })}
          </select>
        </label>
        <p className="mt-1 text-xs text-slate-500">{SONDE_MODE_LABELS[workspace.mode].hint}</p>
      </div>

      {/* 4 · Nachrichten (die einzige scrollende Fläche) */}
      <div className="relative min-h-0">
        <div ref={scrollRef} onScroll={handleScroll} role="log" aria-live="polite" aria-label="Unterhaltung mit Sonde" className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-4">
          {!workspace.activeConversationId ? (
            <div className="my-auto flex flex-col items-center gap-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-500" aria-hidden="true">
                <Sparkles size={22} />
              </span>
              <p className="text-sm font-medium text-slate-700">Stellen Sie Sonde eine Frage</p>
              <p className="text-sm text-slate-500">
                Sonde erklärt offene Vorgänge und Freigaben. Im Modus „Vorbereiten“ erstellt sie Entwürfe, im Modus „Ausführen“ legt sie Aufgaben oder Kontakte an – ein Versand wartet immer auf Ihre Freigabe.
              </p>
            </div>
          ) : messagesLoading ? (
            <div className="my-auto flex items-center justify-center text-slate-500">
              <Loader2 size={20} className="animate-spin" aria-label="Wird geladen" />
            </div>
          ) : messages && messages.length > 0 ? (
            messages.map((message) => (
              <div key={message.id} className={`flex max-w-[88%] flex-col gap-0.5 ${message.role === 'USER' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                <span className="text-[11px] font-medium text-slate-500">{message.role === 'USER' ? 'Sie' : 'Sonde'}</span>
                <div
                  className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    message.role === 'USER' ? 'bg-brand text-brand-foreground' : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))
          ) : (
            <p className="my-auto text-center text-sm text-slate-500">Noch keine Nachrichten in dieser Unterhaltung.</p>
          )}

          {busy ? (
            <div className="mr-auto flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              {workspace.streamingStatus ?? 'Sonde antwortet …'}
            </div>
          ) : null}
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground shadow-md"
          >
            <ArrowDown size={14} /> Neue Antwort
          </button>
        ) : null}
      </div>

      {/* 5 · Aktueller Auftrag / Fehler */}
      <div className="px-4">
        {workspace.error ? (
          <div role="alert" className="mt-2 flex items-start justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span>{workspace.error}</span>
            <button type="button" onClick={workspace.clearError} aria-label="Hinweis schließen" className="shrink-0 text-red-700 hover:text-red-900">
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {/* 6 · Eingabe */}
      <div className="border-t border-slate-200 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {activeConversation === undefined || (messages?.length ?? 0) === 0 ? (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void workspace.send(prompt)}
                disabled={busy}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <label htmlFor="sonde-composer" className="sr-only">
            Nachricht an Sonde
          </label>
          <textarea
            id="sonde-composer"
            ref={textareaRef}
            rows={1}
            value={workspace.draft}
            onChange={(event) => workspace.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void workspace.send();
              }
            }}
            placeholder="Fragen Sie Sonde etwas …"
            className="min-h-[40px] w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <button
            type="button"
            onClick={() => void workspace.send()}
            disabled={!workspace.draft.trim() || busy}
            aria-label="Nachricht senden"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">Eingabetaste sendet, Umschalt + Eingabe fügt eine Zeile ein.</p>
      </div>
    </div>
  );
}
