'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, restoreSession } from './api-client';
import { getStoredAuth, setStoredAuth, subscribeToAuth, type AuthUser, type StoredAuth } from './token-store';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True until the initial localStorage read on mount has completed. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuth);
    // Nach einem Neuladen ist der Arbeitsspeicher leer: das httpOnly-Cookie stellt die Sitzung wieder her (oder es bleibt bei der Anmeldung).
    void restoreSession().finally(() => {
      setAuth(getStoredAuth());
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<LoginResponse>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredAuth({ accessToken: data.accessToken, user: data.user });
  }, []);

  const logout = useCallback(async () => {
    try {
      // Das Refresh-Token kommt aus dem httpOnly-Cookie; der Server widerruft es und löscht das Cookie.
      await apiFetch('/v1/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      // Best-effort server-side revocation; clear the local session regardless.
    }
    setStoredAuth(null);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => auth?.user.permissions.includes(permission) ?? false,
    [auth],
  );

  return (
    <AuthContext.Provider
      value={{
        user: auth?.user ?? null,
        isAuthenticated: auth !== null,
        isLoading,
        login,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth() must be used within <AuthProvider>.');
  }
  return context;
}
