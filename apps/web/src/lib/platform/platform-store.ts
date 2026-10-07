/**
 * Sitzung der Plattformdomäne (Amendment 03 §3). Bewusst getrennt vom Mandanten-Token-Speicher (`token-store.ts`): eigener Schlüssel, eigener
 * Speicher, keine gemeinsame Sitzung. Der Speicher ist `sessionStorage` (pro Tab, endet mit dem Tab) – Betreiberzugänge sollen nicht über Neustarts
 * des Browsers hinweg bestehen. Die Serverseite bleibt maßgeblich: Sitzung, Rollen und Scopes werden bei jedem Request neu geprüft.
 */
export interface PlatformPrincipalView {
  userId: string;
  email: string;
  displayName: string;
  platformRoles: string[];
  platformScopes: string[];
  authenticationAssurance: string;
  environment: string;
  expiresAt: string;
}

export interface StoredPlatformAuth {
  accessToken: string;
  refreshToken: string;
  principal: PlatformPrincipalView;
}

const STORAGE_KEY = 'orbit.platform.auth';
let current: StoredPlatformAuth | null | undefined;
const listeners = new Set<(auth: StoredPlatformAuth | null) => void>();

function readFromStorage(): StoredPlatformAuth | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPlatformAuth) : null;
  } catch {
    return null;
  }
}

export function getStoredPlatformAuth(): StoredPlatformAuth | null {
  if (current === undefined) current = readFromStorage();
  return current;
}

export function setStoredPlatformAuth(auth: StoredPlatformAuth | null): void {
  current = auth;
  if (typeof window !== 'undefined') {
    try {
      if (auth) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Speicher nicht verfügbar: die Sitzung lebt dann nur im Arbeitsspeicher dieses Tabs.
    }
  }
  for (const listener of listeners) listener(auth);
}

export function subscribeToPlatformAuth(listener: (auth: StoredPlatformAuth | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
