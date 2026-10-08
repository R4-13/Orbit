import type { BrowserContext } from '@playwright/test';
import { API_BASE_URL } from './login';

export interface PlatformApiSession {
  accessToken: string;
  refreshToken: string;
  principal: unknown;
}

/** Meldet über die Plattform-API an (ohne Cookie-Modus, daher steht das Refresh-Token im Körper) – für Vorbereitung und direkte API-Aufrufe der Tests. */
export async function platformApiLogin(email: string, password: string): Promise<PlatformApiSession> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(`Plattform-Login ${email}: ${response.status} ${await response.text()}`);
  return (await response.json()) as PlatformApiSession;
}

/**
 * Legt die Sitzung so im Browser an, wie es die Anwendung selbst tut: als httpOnly-Cookie (kein Browser-Speicher). Die Seite stellt daraus beim Laden ihr
 * Zugangstoken her. Das Refresh-Token ist danach im Browser eingelöst (rotiert); für weitere API-Aufrufe des Tests dient das Zugangstoken.
 */
export async function installPlatformSession(context: BrowserContext, session: Pick<PlatformApiSession, 'refreshToken'>): Promise<void> {
  const host = new URL(API_BASE_URL).hostname;
  await context.addCookies([{ name: 'orbit_platform_rt', value: session.refreshToken, domain: host, path: '/api/v1/platform/auth', httpOnly: true, secure: false, sameSite: 'Strict' }]);
}
