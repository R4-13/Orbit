import type { CookieOptions, Request } from 'express';
import type { OrbitEnv } from '@orbit/config';
import { createSessionCookie } from '../../common/session-cookie';

/** Refresh-Token der Betreibersitzung als httpOnly-Cookie (Cookie-Modus); Begründung und Schutzmaßnahmen siehe `common/session-cookie.ts`. Sitzungs-Cookie. */
export const PLATFORM_REFRESH_COOKIE = 'orbit_platform_rt';
export const PLATFORM_COOKIE_MODE_HEADER = 'x-orbit-platform-cookie';

const cookie = createSessionCookie({ name: PLATFORM_REFRESH_COOKIE, modeHeader: PLATFORM_COOKIE_MODE_HEADER, path: '/api/v1/platform/auth' });

export const isCookieMode = (request: Pick<Request, 'headers'>): boolean => cookie.isCookieMode(request);
export const readRefreshCookie = (request: Pick<Request, 'headers'>): string | undefined => cookie.read(request);
export const refreshCookieOptions = (env: Pick<OrbitEnv, 'ORBIT_ENVIRONMENT'>): CookieOptions => cookie.options(env);
export const clearCookieOptions = (env: Pick<OrbitEnv, 'ORBIT_ENVIRONMENT'>): CookieOptions => cookie.clearOptions(env);
