import type { Permission } from '@orbit/shared';

/** Shape of the signed JWT access-token payload. */
export interface JwtPayload {
  /** Subject — the user id. */
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: Permission[];
}

/** `request.user` once JwtAuthGuard has validated the access token. */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: Permission[];
}
