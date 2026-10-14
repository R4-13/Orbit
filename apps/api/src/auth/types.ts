import type { Permission } from '@orbit/shared';

/** Shape of the signed JWT access-token payload. */
export interface JwtPayload {
  /** Subject — the user id. */
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: Permission[];
  /** Das Konto hat noch ein Startpasswort (Claim `pcr`). */
  pcr?: boolean;
}

/** `request.user` once JwtAuthGuard has validated the access token. */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: Permission[];
  /** Gesetzt, solange das Startpasswort noch nicht geändert wurde: bis dahin sind nur Passwortwechsel, Kontoabfrage und Abmelden erlaubt. */
  passwordChangeRequired?: boolean;
}
