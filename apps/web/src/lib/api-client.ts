import { getStoredAuth, setStoredAuth } from './token-store';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Cookie-Modus (Browser): Cookies mitsenden und den Modus-Header setzen; der Server liefert das Refresh-Token dann nur als httpOnly-Cookie und verlangt den
 * Header beim Refresh über das Cookie.
 */
function rawFetch(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Orbit-Cookie': '1' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}/api${path}`, {
    credentials: 'include',
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
  });
}

let refreshing: Promise<string | null> | null = null;

/**
 * Holt über das httpOnly-Cookie ein neues Zugangstoken. Pro Tab nur ein Refresh gleichzeitig, und tab-übergreifend serialisiert (Web Locks): das Cookie
 * rotiert bei jedem Refresh, zwei gleichzeitige Versuche würden sich sonst gegenseitig das Token entwerten. Nach dem Warten auf die Sperre sendet der
 * Browser automatisch das jeweils aktuelle Cookie.
 */
function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  const run = async (): Promise<string | null> => {
    const response = await rawFetch('/v1/auth/refresh', { method: 'POST', body: '{}' });
    if (!response.ok) {
      setStoredAuth(null);
      return null;
    }
    const data = (await response.json()) as { accessToken: string; user: NonNullable<ReturnType<typeof getStoredAuth>>['user'] };
    setStoredAuth({ accessToken: data.accessToken, user: data.user });
    return data.accessToken;
  };
  const locked: Promise<string | null> = typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator.locks.request('orbit-tenant-refresh', run) as unknown as Promise<string | null>) : run();
  const tracked = locked.finally(() => {
    refreshing = null;
  });
  refreshing = tracked;
  return tracked;
}

/** Nach dem Laden der Seite: gibt es ein gültiges Cookie, wird die Sitzung ohne erneute Anmeldung wiederhergestellt. */
export async function restoreSession(): Promise<boolean> {
  if (getStoredAuth()) return true;
  try {
    return (await refreshAccessToken()) !== null;
  } catch {
    return false;
  }
}

/**
 * Attaches the current access token, transparently refreshes once on a 401
 * and retries, and turns a non-2xx response into a typed ApiError (matching
 * OrbitExceptionFilter's {code, message, details} body on the backend).
 * Returns the raw `Response` — `apiFetch` below parses it as JSON; a
 * streaming caller (`apiFetchStream`) reads `response.body` itself.
 */
async function authenticatedFetch(path: string, options: RequestInit): Promise<Response> {
  const auth = getStoredAuth();
  let response = await rawFetch(path, options, auth?.accessToken);

  if (response.status === 401 && auth) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await rawFetch(path, options, newToken);
    }
  }

  if (!response.ok) {
    let body: { code?: string; message?: string; details?: unknown } = {};
    try {
      body = await response.json();
    } catch {
      // non-JSON error body — fall through with defaults below
    }
    throw new ApiError(
      response.status,
      body.code ?? 'UNKNOWN_ERROR',
      body.message ?? response.statusText,
      body.details,
    );
  }

  return response;
}

/** UI-7 error-state rollout — the one place that turns a caught query/mutation error into the German text shown to the user, instead of each page repeating its own `error instanceof ApiError ? ... : '...'` fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Every ordinary (non-streaming) request to the API goes through here. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/**
 * Same auth/refresh/error handling as `apiFetch`, but returns the raw
 * `Response` for a caller that reads `response.body` as a stream (Sonde's
 * SSE endpoint, `POST .../messages/stream` — see `use-copilot.ts`).
 */
export async function apiFetchStream(path: string, options: RequestInit = {}): Promise<Response> {
  return authenticatedFetch(path, options);
}
