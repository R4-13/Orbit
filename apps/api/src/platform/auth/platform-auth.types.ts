import type { PlatformPrincipal } from '@orbit/shared';

/** Signierter Access-Token-Inhalt der Plattformdomäne. Rollen/Scopes stehen bewusst NICHT im Token: sie werden bei jedem Request frisch aus der Datenbank gelesen. */
export interface PlatformJwtPayload {
  sub: string;
  sid: string;
  dom: 'PLATFORM';
  env: string;
}

export interface PlatformRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  platformPrincipal?: PlatformPrincipal;
}

export const PLATFORM_AUDIENCE = 'orbit-platform';
export const PLATFORM_ISSUER = 'orbit';
