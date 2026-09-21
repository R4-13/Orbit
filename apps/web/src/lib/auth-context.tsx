'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from './api-client';
import { getStoredAuth, setStoredAuth, subscribeToAuth, type AuthUser, type StoredAuth } from './token-store';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
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
    setAuth(getStoredAuth());
    setIsLoading(false);
    return subscribeToAuth(setAuth);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<LoginResponse>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
  }, []);

  const logout = useCallback(async () => {
    const current = getStoredAuth();
    if (current) {
      try {
        await apiFetch('/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
      } catch {
        // Best-effort server-side revocation; clear the local session regardless.
      }
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
