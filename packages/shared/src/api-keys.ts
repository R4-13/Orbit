import { PERMISSIONS, type Permission } from './permissions';

/**
 * Zugriffsschlüssel (Dienstzugang, AUT-12): ein Schlüssel gehört einem Mandanten und darf nur, was seine Bereiche erlauben – nie mehr als ein Konto mit genau
 * dieser Berechtigung. Heute gibt es einen Bereich; weitere kommen mit Bedarf (jeder Bereich = genau eine Berechtigung).
 */
export const API_KEY_SCOPES = ['staff.sync'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'staff.sync': 'Mitarbeiterverzeichnis abgleichen (PUT /staff/sync)',
};

const SCOPE_PERMISSION: Record<ApiKeyScope, Permission> = { 'staff.sync': PERMISSIONS.STAFF_SYNC };

export const permissionsForScopes = (scopes: readonly string[]): Permission[] => scopes.flatMap((s) => (s in SCOPE_PERMISSION ? [SCOPE_PERMISSION[s as ApiKeyScope]] : []));

/** Präfix aller Schlüssel – erkennt einen Schlüssel im Header, bevor etwas nachgeschlagen wird, und lässt Geheimnis-Scanner ihn finden. */
export const API_KEY_PREFIX = 'osk_';
