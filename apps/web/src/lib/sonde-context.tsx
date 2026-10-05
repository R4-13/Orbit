'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** What the user is looking at, handed to Sonde as a hint; the server validates it again (tenant, permission) before using it. */
export interface SondeCaseContextValue {
  caseId: string;
  nodeId?: string;
  planRevision?: number;
  /** Fachlicher Anzeigename für die Kontextzeile (nie eine nackte ID). */
  label?: string;
}

interface Store {
  /** Der Kontext, den die aktuelle Seite anbietet (Vorgang/Knoten). */
  context: SondeCaseContextValue | null;
  setContext: (value: SondeCaseContextValue | null) => void;
  /** Ein ausdrücklich fixierter Kontext bleibt beim Seitenwechsel erhalten (UI v2 §8.4). */
  pinned: SondeCaseContextValue | null;
  pin: (value: SondeCaseContextValue | null) => void;
  /** Nutzer hat den Seitenkontext für seine nächsten Nachrichten abgewählt. */
  contextDisabled: boolean;
  setContextDisabled: (value: boolean) => void;
  /** Seitenbezeichnung für die Kontextzeile, wenn kein Objektkontext existiert (z. B. „Rechnungen“). */
  pageLabel: string | null;
  setPageLabel: (value: string | null) => void;
}

const SondeContext = createContext<Store>({
  context: null,
  setContext: () => undefined,
  pinned: null,
  pin: () => undefined,
  contextDisabled: false,
  setContextDisabled: () => undefined,
  pageLabel: null,
  setPageLabel: () => undefined,
});

export function SondeContextProvider({ children }: { children: ReactNode }) {
  const [context, setContextState] = useState<SondeCaseContextValue | null>(null);
  const [pinned, setPinned] = useState<SondeCaseContextValue | null>(null);
  const [contextDisabled, setContextDisabled] = useState(false);
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  const setContext = useCallback((value: SondeCaseContextValue | null) => setContextState(value), []);
  const pin = useCallback((value: SondeCaseContextValue | null) => setPinned(value), []);
  const store = useMemo(
    () => ({ context, setContext, pinned, pin, contextDisabled, setContextDisabled, pageLabel, setPageLabel }),
    [context, setContext, pinned, pin, contextDisabled, pageLabel],
  );
  return <SondeContext.Provider value={store}>{children}</SondeContext.Provider>;
}

export function useSondeCaseContext(): Store {
  return useContext(SondeContext);
}

/** Der Kontext, der mit der nächsten Nachricht gesendet würde: fixiert vor Seite, und nichts, wenn abgewählt. */
export function effectiveSondeContext(store: Pick<Store, 'context' | 'pinned' | 'contextDisabled'>): SondeCaseContextValue | null {
  if (store.contextDisabled) return null;
  return store.pinned ?? store.context;
}
