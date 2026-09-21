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
 * Every request to the API goes through here: attaches the current access
 * token, transparently refreshes once on a 401 and retries, and turns a
 * non-2xx response into a typed ApiError (matching OrbitExceptionFilter's
 * {code, message, details} body on the backend).
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}
