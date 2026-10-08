/**
 * Plain (non-React) module holding the current session so `apiFetch` can read/refresh it outside of the component tree — React state alone can't be read
 * from a fetch helper. `AuthProvider` (auth-context.tsx) and the refresh in `api-client.ts` are the only places that call `setStoredAuth`.
 *
 * Es liegt **nichts** im Browser-Speicher: das kurzlebige Zugangstoken lebt nur hier (im Arbeitsspeicher dieses Tabs), das langlebige Refresh-Token steckt
 * ausschließlich in einem httpOnly-Cookie und ist für Skripte der Seite unlesbar. Nach einem Neuladen holt sich die Seite über dieses Cookie ein neues
 * Zugangstoken (`restoreSession` in api-client.ts). Ein Skript auf der Seite (XSS) kann das Token so nicht mehr mitnehmen; es kann den Refresh höchstens
 * im Namen des Browsers auslösen, solange die Seite offen ist.
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
  user: AuthUser;
}

/** Frühere Versionen legten Zugangs- und Refresh-Token im localStorage ab; dieser Eintrag wird entfernt (die betroffenen Nutzer melden sich einmal neu an). */
const LEGACY_STORAGE_KEY = 'orbit.auth';

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Speicher nicht verfügbar: nichts zu bereinigen.
  }
}

let current: StoredAuth | null = null;
const listeners = new Set<(auth: StoredAuth | null) => void>();

export function getStoredAuth(): StoredAuth | null {
  return current;
}

export function setStoredAuth(auth: StoredAuth | null): void {
  current = auth;
  for (const listener of listeners) listener(auth);
}

export function subscribeToAuth(listener: (auth: StoredAuth | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
