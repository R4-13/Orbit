/**
 * ZERIONUS Platform Control Plane — Rollen, Scopes und Sicherheitsdomäne (Amendment 03 §2, §23).
 *
 * Die Plattformdomäne ist von den Mandantenrollen (`ROLES` in permissions.ts) strikt getrennt: eigene Identität (`platform_users`),
 * eigenes Token-Secret, eigene Scopes. Eine Mandantenrolle (auch die Mandantenrolle `SYSTEM_ADMIN`) impliziert nie eine Plattformrolle.
 */

export const PLATFORM_ROLES = {
  PLATFORM_OWNER: 'PLATFORM_OWNER',
  PLATFORM_OPERATOR: 'PLATFORM_OPERATOR',
  PLATFORM_SUPPORT: 'PLATFORM_SUPPORT',
  PLATFORM_SECURITY: 'PLATFORM_SECURITY',
  PLATFORM_FINOPS: 'PLATFORM_FINOPS',
  PLATFORM_RELEASE_MANAGER: 'PLATFORM_RELEASE_MANAGER',
  PLATFORM_ENGINEERING: 'PLATFORM_ENGINEERING',
  PLATFORM_AUDITOR: 'PLATFORM_AUDITOR',
} as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[keyof typeof PLATFORM_ROLES];

/** Reservierter Präfix: Mandantenrollen dürfen so nie heißen (Anlegen/Umbenennen wird abgewiesen; zusätzlich DB-Check auf `roles.name`). */
export const PLATFORM_ROLE_PREFIX = 'PLATFORM_';

export function isReservedRoleName(name: string): boolean {
  return name.trim().toUpperCase().startsWith(PLATFORM_ROLE_PREFIX);
}

/** Jeder Pfad, der eine Mandantenrolle anlegt oder umbenennt, ruft das auf (Amendment 03 §2.4, OPR-03). Zusätzlich verbietet ein DB-Check `roles.name` mit diesem Präfix. */
export function assertTenantRoleName(name: string): void {
  if (isReservedRoleName(name)) throw new Error(`Der Rollenname "${name}" ist für die Plattformdomäne reserviert und darf keine Mandantenrolle bezeichnen.`);
}

export function isPlatformRole(value: string): value is PlatformRole {
  return (Object.values(PLATFORM_ROLES) as string[]).includes(value);
}

export const PLATFORM_SCOPES = {
  IDENTITY_MANAGE: 'platform.identity.manage',
  CONFIG_READ: 'platform.config.read',
  CONFIG_WRITE: 'platform.config.write',
  TENANTS_READ: 'platform.tenants.read',
  TENANTS_LIFECYCLE_WRITE: 'platform.tenants.lifecycle.write',
  AI_READ: 'platform.ai.read',
  AI_WRITE: 'platform.ai.write',
  AI_SECRETS_WRITE: 'platform.ai.secrets.write',
  AI_COST_READ: 'platform.ai.cost.read',
  CONNECTORS_READ: 'platform.connectors.read',
  CONNECTORS_WRITE: 'platform.connectors.write',
  CONNECTORS_SUSPEND: 'platform.connectors.suspend',
  FEATURES_READ: 'platform.features.read',
  FEATURES_WRITE: 'platform.features.write',
  KILLSWITCH_WRITE: 'platform.killswitch.write',
  RUNTIME_READ: 'platform.runtime.read',
  DIAGNOSTICS_READ: 'platform.diagnostics.read',
  /** Wird **nie** statisch durch eine Rolle vergeben, sondern nur durch eine aktive Support-Session (Amendment 03 §18). */
  DIAGNOSTICS_PAYLOAD_READ: 'platform.diagnostics.payload.read',
  SECURITY_READ: 'platform.security.read',
  SECURITY_WRITE: 'platform.security.write',
  SUPPORT_SESSION_REQUEST: 'platform.support.session.request',
  SUPPORT_SESSION_READ: 'platform.support.session.read',
  SUPPORT_SESSION_APPROVE: 'platform.support.session.approve',
  AUDIT_READ: 'platform.audit.read',
  /** Eingeschränkte Sicht auf das Audit: nur Ereignisse des eigenen Fachbereichs (Kosten, Release, Technik). */
  AUDIT_READ_SCOPED: 'platform.audit.read.scoped',
  /** Support: nur Ereignisse der eigenen Support-Sessions. */
  AUDIT_READ_OWN: 'platform.audit.read.own',
} as const;

export type PlatformScope = (typeof PLATFORM_SCOPES)[keyof typeof PLATFORM_SCOPES];

const S = PLATFORM_SCOPES;
const ALL_ROLE_SCOPES = (Object.values(S) as PlatformScope[]).filter((scope) => scope !== S.DIAGNOSTICS_PAYLOAD_READ);

/**
 * Rollenmatrix (Amendment 03 §2.3), als Code – die Trennung der Verantwortlichkeiten darf nicht still aufgeweicht werden; Änderungen laufen
 * über Review und `platform.spec.ts`. Fachliche Mandantendaten liest niemand über eine Rolle, sondern nur über eine Support-Session.
 */
export const PLATFORM_ROLE_SCOPES: Record<PlatformRole, readonly PlatformScope[]> = {
  PLATFORM_OWNER: ALL_ROLE_SCOPES,
  PLATFORM_OPERATOR: [
    S.CONFIG_READ,
    S.TENANTS_READ,
    S.TENANTS_LIFECYCLE_WRITE,
    S.AI_READ,
    S.AI_WRITE,
    S.AI_SECRETS_WRITE,
    S.AI_COST_READ,
    S.CONNECTORS_READ,
    S.CONNECTORS_WRITE,
    S.CONNECTORS_SUSPEND,
    S.FEATURES_READ,
    S.FEATURES_WRITE,
    S.RUNTIME_READ,
    S.DIAGNOSTICS_READ,
    S.SECURITY_READ,
    S.SUPPORT_SESSION_REQUEST,
    S.SUPPORT_SESSION_READ,
    S.AUDIT_READ_SCOPED,
  ],
  PLATFORM_SUPPORT: [
    S.CONFIG_READ,
    S.TENANTS_READ,
    S.AI_READ,
    S.CONNECTORS_READ,
    S.FEATURES_READ,
    S.RUNTIME_READ,
    S.DIAGNOSTICS_READ,
    S.SUPPORT_SESSION_REQUEST,
    S.SUPPORT_SESSION_READ,
    S.AUDIT_READ_OWN,
  ],
  PLATFORM_SECURITY: [
    S.CONFIG_READ,
    S.TENANTS_READ,
    S.AI_READ,
    S.CONNECTORS_READ,
    S.CONNECTORS_SUSPEND,
    S.FEATURES_READ,
    S.KILLSWITCH_WRITE,
    S.RUNTIME_READ,
    S.DIAGNOSTICS_READ,
    S.SECURITY_READ,
    S.SECURITY_WRITE,
    S.SUPPORT_SESSION_READ,
    S.SUPPORT_SESSION_APPROVE,
    S.AUDIT_READ,
  ],
  PLATFORM_FINOPS: [S.CONFIG_READ, S.TENANTS_READ, S.AI_READ, S.AI_COST_READ, S.AUDIT_READ_SCOPED],
  PLATFORM_RELEASE_MANAGER: [
    S.CONFIG_READ,
    S.CONFIG_WRITE,
    S.TENANTS_READ,
    S.AI_READ,
    S.CONNECTORS_READ,
    S.CONNECTORS_WRITE,
    S.FEATURES_READ,
    S.FEATURES_WRITE,
    S.KILLSWITCH_WRITE,
    S.AUDIT_READ_SCOPED,
  ],
  PLATFORM_ENGINEERING: [
    S.CONFIG_READ,
    S.TENANTS_READ,
    S.AI_READ,
    S.AI_WRITE,
    S.AI_COST_READ,
    S.CONNECTORS_READ,
    S.CONNECTORS_WRITE,
    S.FEATURES_READ,
    S.FEATURES_WRITE,
    S.RUNTIME_READ,
    S.DIAGNOSTICS_READ,
    S.SECURITY_READ,
    S.AUDIT_READ_SCOPED,
  ],
  PLATFORM_AUDITOR: [
    S.CONFIG_READ,
    S.TENANTS_READ,
    S.AI_READ,
    S.AI_COST_READ,
    S.CONNECTORS_READ,
    S.FEATURES_READ,
    S.RUNTIME_READ,
    S.DIAGNOSTICS_READ,
    S.SECURITY_READ,
    S.SUPPORT_SESSION_READ,
    S.AUDIT_READ,
  ],
};

export function scopesForRoles(roles: readonly string[]): PlatformScope[] {
  const scopes = new Set<PlatformScope>();
  for (const role of roles) {
    if (!isPlatformRole(role)) continue;
    for (const scope of PLATFORM_ROLE_SCOPES[role]) scopes.add(scope);
  }
  return [...scopes].sort();
}

/** Authentifizierungsgüte der Plattformsitzung. `MFA` ist als Erweiterungsgrenze reserviert, aber noch nicht implementiert (ASSUMPTIONS #OPS-A5). */
export type PlatformAssurance = 'PASSWORD' | 'PASSWORD_STEP_UP' | 'MFA';

/** Serverseitig aufgebauter Plattformkontext (Amendment 03 §3.1). Nie vom Client gesetzt. */
export interface PlatformPrincipal {
  userId: string;
  email: string;
  displayName: string;
  platformRoles: PlatformRole[];
  platformScopes: PlatformScope[];
  authenticationAssurance: PlatformAssurance;
  /** Ende des Step-up-Fensters; kritische Operationen verlangen `stepUpUntil > jetzt`. */
  stepUpUntil?: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  environment: string;
}

/** Plattform-Audit-Ereignistypen (Amendment 03 §19.1). Dieselbe Audit-Tabelle wie die Mandanten, `domain = PLATFORM`. */
/** Mindestlänge eines Betreiberpassworts: eine Quelle für Anlegen und Wechseln. */
export const PLATFORM_MIN_PASSWORD_LENGTH = 14;

export const PLATFORM_AUDIT_EVENT_TYPES = [
  'PLATFORM_LOGIN',
  'PLATFORM_LOGIN_FAILED',
  'PLATFORM_LOGOUT',
  'PLATFORM_STEP_UP',
  'PLATFORM_PASSWORD_CHANGED',
  'PLATFORM_RUNTIME_STATE_CHANGED',
  'PLATFORM_ACCESS_DENIED',
  'PLATFORM_IDENTITY_CREATED',
  'PLATFORM_ROLE_GRANTED',
  'PLATFORM_ROLE_REVOKED',
  'PLATFORM_IDENTITY_DISABLED',
  'PLATFORM_TENANT_LIFECYCLE_CHANGED',
  'PLATFORM_TENANT_OVERRIDE_CHANGED',
  'PLATFORM_AI_PROVIDER_CHANGED',
  'PLATFORM_AI_MODEL_CHANGED',
  'PLATFORM_AI_PROFILE_PUBLISHED',
  'PLATFORM_AI_ROUTE_CHANGED',
  'PLATFORM_SECRET_CHANGED',
  'PLATFORM_CONNECTOR_CHANGED',
  'PLATFORM_FEATURE_FLAG_CHANGED',
  'PLATFORM_KILL_SWITCH_CHANGED',
  'PLATFORM_SECURITY_POLICY_CHANGED',
  'PLATFORM_SUPPORT_SESSION_REQUESTED',
  'PLATFORM_SUPPORT_SESSION_ACTIVATED',
  'PLATFORM_SUPPORT_SESSION_CLOSED',
  'PLATFORM_SUPPORT_ACCESS',
  'PLATFORM_DIAGNOSTICS_READ',
  'PLATFORM_DIAGNOSTIC_EXPORTED',
] as const;

export type PlatformAuditEventType = (typeof PLATFORM_AUDIT_EVENT_TYPES)[number];

/** Umgebungen (Amendment 03 §21). Unbekannte Werte werden als `development` behandelt – nie stillschweigend als `production`. */
export const PLATFORM_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type PlatformEnvironment = (typeof PLATFORM_ENVIRONMENTS)[number];

export function normalizeEnvironment(value: string | undefined): PlatformEnvironment {
  return (PLATFORM_ENVIRONMENTS as readonly string[]).includes(value ?? '') ? (value as PlatformEnvironment) : 'development';
}
