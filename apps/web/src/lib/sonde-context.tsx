'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** What the user is looking at, handed to Sonde as a hint; the server validates it again (tenant, permission) before using it. */
export interface SondeCaseContextValue {
  caseId: string;
  nodeId?: string;
  planRevision?: number;
}

interface Store {
  context: SondeCaseContextValue | null;
  setContext: (value: SondeCaseContextValue | null) => void;
}

const SondeContext = createContext<Store>({ context: null, setContext: () => undefined });

export function SondeContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<SondeCaseContextValue | null>(null);
  const store = useMemo(() => ({ context, setContext }), [context]);
  return <SondeContext.Provider value={store}>{children}</SondeContext.Provider>;
}

export function useSondeCaseContext(): Store {
  return useContext(SondeContext);
}
