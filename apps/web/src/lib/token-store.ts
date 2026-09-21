/**
 * Plain (non-React) module holding the current session so `apiFetch` can
 * read/refresh it outside of component tree — React state alone can't be
 * read from a fetch helper. `AuthProvider` (auth-context.tsx) is the only
 * thing that should call `setStoredAuth`; everything else only reads.
 *
 * MVP simplification: the JWT pair lives in localStorage, not an httpOnly
 * cookie — acceptable for this demo/MVP stage, but it means a successful
 * XSS on this origin could read the tokens. Revisit as part of Phase 15
 * (Security Hardening) if this ships beyond an internal demo.
 */
export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const STORAGE_KEY = 'orbit.auth';

let current: StoredAuth | null | undefined;
const listeners = new Set<(auth: StoredAuth | null) => void>();

function readFromStorage(): StoredAuth | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function getStoredAuth(): StoredAuth | null {
  if (current === undefined) {
    current = readFromStorage();
  }
  return current;
}

export function setStoredAuth(auth: StoredAuth | null): void {
  current = auth;
  if (typeof window !== 'undefined') {
    if (auth) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }
  for (const listener of listeners) listener(auth);
}

export function subscribeToAuth(listener: (auth: StoredAuth | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
