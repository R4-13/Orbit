import { getStoredPlatformAuth, setStoredPlatformAuth, type PlatformPrincipalView } from './platform-store';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export class PlatformApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

export const isStepUpRequired = (error: unknown): boolean => error instanceof PlatformApiError && error.code === 'STEP_UP_REQUIRED';

/** Im Cookie-Modus bleibt `refreshToken` leer: das Token kommt nie in den Antwortkörper, sondern nur als httpOnly-Cookie. */
interface PlatformTokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  principal: PlatformPrincipalView;
}

/** Cookie-Modus (Browser): Cookies mitsenden und den Modus-Header setzen; der Server liefert das Refresh-Token dann nur als httpOnly-Cookie und verlangt den Header beim Refresh. */
function rawFetch(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Orbit-Platform-Cookie': '1' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}/api/v1/platform${path}`, { ...options, credentials: 'include', headers: { ...headers, ...(options.headers as Record<string, string> | undefined) } });
}

async function toError(response: Response): Promise<PlatformApiError> {
  let body: { code?: string; message?: string; details?: unknown } = {};
  try {
    body = await response.json();
  } catch {
    // keine JSON-Antwort: Standardwerte unten
  }
  return new PlatformApiError(response.status, body.code ?? (response.status === 401 ? 'UNAUTHORIZED' : 'UNKNOWN_ERROR'), body.message ?? response.statusText, body.details);
}

let refreshing: Promise<string | null> | null = null;

/**
 * Holt über das httpOnly-Cookie ein neues Zugangstoken. Pro Tab nur ein Refresh gleichzeitig, und tab-übergreifend serialisiert (Web Locks): das Cookie
 * rotiert bei jedem Refresh, zwei gleichzeitige Versuche würden sich sonst gegenseitig das Token entwerten. Nach dem Warten auf die Sperre sendet der Browser
 * automatisch das jeweils aktuelle Cookie.
 */
function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  const run = async (): Promise<string | null> => {
    const response = await rawFetch('/auth/refresh', { method: 'POST', body: '{}' });
    if (!response.ok) {
      setStoredPlatformAuth(null);
      return null;
    }
    const data = (await response.json()) as PlatformTokensResponse;
    setStoredPlatformAuth({ accessToken: data.accessToken, principal: data.principal });
    return data.accessToken;
  };
  const locked: Promise<string | null> = typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator.locks.request('orbit-platform-refresh', run) as unknown as Promise<string | null>) : run();
  const tracked = locked.finally(() => {
    refreshing = null;
  });
  refreshing = tracked;
  return tracked;
}

/** Nach dem Laden der Seite: gibt es ein gültiges Cookie, wird die Sitzung ohne erneute Anmeldung wiederhergestellt. */
export async function restorePlatformSession(): Promise<boolean> {
  if (getStoredPlatformAuth()) return true;
  try {
    return (await refreshAccessToken()) !== null;
  } catch {
    return false;
  }
}

/** Jeder authentifizierte Plattform-Aufruf: Token anhängen, bei 401 einmal erneuern, Fehler typisieren. `path` ist relativ zu `/api/v1/platform`. */
export async function platformFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const auth = getStoredPlatformAuth();
  let response = await rawFetch(path, options, auth?.accessToken);
  if (response.status === 401 && auth) {
    const token = await refreshAccessToken();
    if (token) response = await rawFetch(path, options, token);
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function platformLogin(email: string, password: string): Promise<void> {
  const response = await rawFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!response.ok) throw await toError(response);
  const data = (await response.json()) as PlatformTokensResponse;
  setStoredPlatformAuth({ accessToken: data.accessToken, principal: data.principal });
}

export async function platformLogout(): Promise<void> {
  try {
    await platformFetch<void>('/auth/logout', { method: 'POST' });
  } catch {
    // Widerruf ist best effort; die lokale Sitzung wird in jedem Fall verworfen.
  }
  setStoredPlatformAuth(null);
}

export async function platformStepUp(password: string): Promise<void> {
  await platformFetch<{ stepUpUntil: string }>('/auth/step-up', { method: 'POST', body: JSON.stringify({ password }) });
}

export const platformErrorMessage = (error: unknown, fallback: string): string => (error instanceof PlatformApiError ? error.message : fallback);
