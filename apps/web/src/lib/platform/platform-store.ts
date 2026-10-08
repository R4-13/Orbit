/**
 * Sitzung der Plattformdomäne (Amendment 03 §3) – nur im Arbeitsspeicher dieses Tabs. Bewusst getrennt vom Mandanten-Token-Speicher (`token-store.ts`).
 *
 * Es wird **nichts** im Browser-Speicher abgelegt (weder `sessionStorage` noch `localStorage`): das kurzlebige Zugangstoken (15 Minuten) lebt hier, das
 * langlebige Refresh-Token steckt ausschließlich in einem httpOnly-Cookie und ist für Skripte der Seite unlesbar. Nach einem Neuladen holt sich die Seite über
 * dieses Cookie ein neues Zugangstoken (`restorePlatformSession`). Die Serverseite bleibt maßgeblich: Sitzung, Rollen und Scopes werden bei jedem Request neu geprüft.
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
  principal: PlatformPrincipalView;
}

let current: StoredPlatformAuth | null = null;
const listeners = new Set<(auth: StoredPlatformAuth | null) => void>();

export function getStoredPlatformAuth(): StoredPlatformAuth | null {
  return current;
}

export function setStoredPlatformAuth(auth: StoredPlatformAuth | null): void {
  current = auth;
  for (const listener of listeners) listener(auth);
}

export function subscribeToPlatformAuth(listener: (auth: StoredPlatformAuth | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
