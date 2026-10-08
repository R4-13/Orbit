import type { CookieOptions, Request } from 'express';
import type { OrbitEnv } from '@orbit/config';

/**
 * Refresh-Token der Betreibersitzung als httpOnly-Cookie (Cookie-Modus). Das Skript der Seite kann das Token dadurch nie lesen – ein Cross-Site-Skript
 * kann es nicht mitnehmen; es kann den Refresh höchstens im Namen des Browsers auslösen, solange die Seite offen ist. Der Pfad begrenzt das Cookie auf die
 * Anmelderouten, `SameSite=Strict` verhindert das Mitsenden bei fremden Seiten; zusätzlich verlangt der Cookie-Weg den Header `X-Orbit-Platform-Cookie`
 * (ein nicht einfacher Header löst eine CORS-Vorabprüfung aus – ein fremdes Formular kann ihn nicht setzen).
 * API-Clients ohne Browser nutzen weiter das Refresh-Token im Antwortkörper.
 */
export const PLATFORM_REFRESH_COOKIE = 'orbit_platform_rt';
export const PLATFORM_COOKIE_MODE_HEADER = 'x-orbit-platform-cookie';
const COOKIE_PATH = '/api/v1/platform/auth';

export function isCookieMode(request: Pick<Request, 'headers'>): boolean {
  return request.headers[PLATFORM_COOKIE_MODE_HEADER] === '1';
}

/** Liest nur das eigene Cookie aus dem Header (kein Cookie-Parser nötig). */
export function readRefreshCookie(request: Pick<Request, 'headers'>): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PLATFORM_REFRESH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Sitzungs-Cookie (endet mit dem Browser). `Secure` überall außer in Entwicklung und Test, wo oft ohne TLS gearbeitet wird. */
export function refreshCookieOptions(env: Pick<OrbitEnv, 'ORBIT_ENVIRONMENT'>): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', path: COOKIE_PATH, secure: !['development', 'test'].includes(env.ORBIT_ENVIRONMENT) };
}

export function clearCookieOptions(env: Pick<OrbitEnv, 'ORBIT_ENVIRONMENT'>): CookieOptions {
  const { maxAge: _maxAge, ...rest } = refreshCookieOptions(env);
  return rest;
}
