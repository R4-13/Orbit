import { createSessionCookie } from '../common/session-cookie';

/**
 * Refresh-Token der Mandantenanmeldung als httpOnly-Cookie (Cookie-Modus des Browsers). Anders als bei der Betreiberanmeldung ist es ein **dauerhaftes** Cookie
 * mit der Lebensdauer des Refresh-Tokens (`JWT_REFRESH_TTL`): Mandantennutzer waren bisher über Browserneustarts hinweg angemeldet, das bleibt so.
 * Begründung und Schutzmaßnahmen siehe `common/session-cookie.ts`.
 */
export const TENANT_REFRESH_COOKIE = 'orbit_rt';
export const TENANT_COOKIE_MODE_HEADER = 'x-orbit-cookie';

export const tenantSessionCookie = createSessionCookie({ name: TENANT_REFRESH_COOKIE, modeHeader: TENANT_COOKIE_MODE_HEADER, path: '/api/v1/auth' });
