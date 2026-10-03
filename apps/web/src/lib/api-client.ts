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

function rawFetch(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}/api${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
  });
}

async function refreshAccessToken(): Promise<string | null> {
  const auth = getStoredAuth();
  if (!auth) return null;

  const response = await rawFetch('/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });

  if (!response.ok) {
    setStoredAuth(null);
    return null;
  }

  const data = (await response.json()) as { accessToken: string; refreshToken: string; user: typeof auth.user };
  setStoredAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
  return data.accessToken;
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
