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

interface PlatformTokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  principal: PlatformPrincipalView;
}

function rawFetch(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}/api/v1/platform${path}`, { ...options, headers: { ...headers, ...(options.headers as Record<string, string> | undefined) } });
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

/** Ein einziger Refresh gleichzeitig: das Refresh-Token rotiert, ein zweiter paralleler Versuch würde die Sitzung widerrufen. */
function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const auth = getStoredPlatformAuth();
    if (!auth) return null;
    const response = await rawFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: auth.refreshToken }) });
    if (!response.ok) {
      setStoredPlatformAuth(null);
      return null;
    }
    const data = (await response.json()) as PlatformTokensResponse;
    setStoredPlatformAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, principal: data.principal });
    return data.accessToken;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
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
  setStoredPlatformAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, principal: data.principal });
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
