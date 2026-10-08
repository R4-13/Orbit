'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { StepUpDialog } from '../../components/platform/step-up-dialog';
import { isStepUpRequired, platformLogin, platformLogout, platformStepUp, restorePlatformSession } from './platform-client';
import { getStoredPlatformAuth, subscribeToPlatformAuth, type PlatformPrincipalView, type StoredPlatformAuth } from './platform-store';

interface PlatformAuthValue {
  principal: PlatformPrincipalView | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasScope: (scope: string) => boolean;
  /** Führt eine kritische Aktion aus; verlangt der Server eine erneute Passwortprüfung, fragt ein Dialog danach und wiederholt die Aktion genau einmal. */
  withStepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

const Context = createContext<PlatformAuthValue | undefined>(undefined);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredPlatformAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToPlatformAuth(setAuth);
    // Nach einem Neuladen ist der Arbeitsspeicher leer: das httpOnly-Cookie stellt die Sitzung wieder her (oder es bleibt bei der Anmeldung).
    void restorePlatformSession().finally(() => {
      setAuth(getStoredPlatformAuth());
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = useCallback((email: string, password: string) => platformLogin(email, password), []);
  const logout = useCallback(() => platformLogout(), []);
  const hasScope = useCallback((scope: string) => auth?.principal.platformScopes.includes(scope) ?? false, [auth]);

  const askForStepUp = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setStepUpOpen(true);
      }),
    [],
  );

  const withStepUp = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (!isStepUpRequired(error)) throw error;
        await askForStepUp();
        return action();
      }
    },
    [askForStepUp],
  );

  return (
    <Context.Provider value={{ principal: auth?.principal ?? null, isAuthenticated: auth !== null, isLoading, login, logout, hasScope, withStepUp }}>
      {children}
      <StepUpDialog
        open={stepUpOpen}
        onSubmit={async (password) => {
          await platformStepUp(password);
          setStepUpOpen(false);
          pending.current?.resolve();
          pending.current = null;
        }}
        onCancel={() => {
          setStepUpOpen(false);
          pending.current?.reject(new Error('Die erneute Bestätigung wurde abgebrochen.'));
          pending.current = null;
        }}
      />
    </Context.Provider>
  );
}

export function usePlatformAuth(): PlatformAuthValue {
  const value = useContext(Context);
  if (!value) throw new Error('usePlatformAuth muss innerhalb von PlatformAuthProvider verwendet werden.');
  return value;
}
