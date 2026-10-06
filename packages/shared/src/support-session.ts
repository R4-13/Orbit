/**
 * Support-Sessions (Amendment 03 §18): expliziter, zeitlich begrenzter, scopebasierter Zugriff auf einen Mandanten – kein stilles, dauerhaftes
 * Impersonation. Reine Regeln, damit API, Tests und (später) die Plattform-UI dieselben Grenzen kennen.
 */

export const SUPPORT_SCOPES = {
  DIAGNOSTICS_READ: 'diagnostics.read',
  CONNECTOR_STATUS_READ: 'connector.status.read',
  TENANT_CONFIG_READ: 'tenant.config.read',
  CASE_METADATA_READ: 'case.metadata.read',
  CASE_PAYLOAD_READ: 'case.payload.read',
  /** Besonders restriktiv (Amendment 03 §18.3): erfordert konkrete Policy/Freigabe. In dieser Version **nicht verfügbar**. */
  TENANT_ACTION_EXECUTE: 'tenant.action.execute',
} as const;

export type SupportScope = (typeof SUPPORT_SCOPES)[keyof typeof SUPPORT_SCOPES];

export const SUPPORT_MODES = ['READ_DIAGNOSTICS', 'READ_TENANT_CONTEXT', 'ASSISTED_ACTION'] as const;
export type SupportMode = (typeof SUPPORT_MODES)[number];

export const SUPPORT_REASON_CODES = ['INCIDENT', 'CUSTOMER_REQUEST', 'SECURITY', 'QUALITY'] as const;
export type SupportReasonCode = (typeof SUPPORT_REASON_CODES)[number];

/** Welche Scopes ein Modus überhaupt tragen darf. */
export const SUPPORT_MODE_SCOPES: Record<SupportMode, readonly SupportScope[]> = {
  READ_DIAGNOSTICS: ['diagnostics.read', 'connector.status.read'],
  READ_TENANT_CONTEXT: ['diagnostics.read', 'connector.status.read', 'tenant.config.read', 'case.metadata.read', 'case.payload.read'],
  ASSISTED_ACTION: [],
};

/** Scopes, die Fachinhalte des Mandanten offenlegen und deshalb eine zweite Person (Vier-Augen) brauchen. */
export const SUPPORT_SENSITIVE_SCOPES: readonly SupportScope[] = ['case.payload.read'];

export function supportScopesNeedApproval(scopes: readonly string[]): boolean {
  return scopes.some((scope) => (SUPPORT_SENSITIVE_SCOPES as readonly string[]).includes(scope));
}

export function isSupportScope(value: string): value is SupportScope {
  return (Object.values(SUPPORT_SCOPES) as string[]).includes(value);
}

/** Leere Liste = Anforderung zulässig. */
export function validateSupportRequest(input: { mode: string; scopes: readonly string[]; minutes: number; maxMinutes: number }): string[] {
  const issues: string[] = [];
  if (!(SUPPORT_MODES as readonly string[]).includes(input.mode)) return ['MODE_UNKNOWN'];
  const mode = input.mode as SupportMode;
  if (mode === 'ASSISTED_ACTION') issues.push('ASSISTED_ACTION_NOT_AVAILABLE');
  if (input.scopes.length === 0) issues.push('SCOPES_REQUIRED');
  for (const scope of input.scopes) {
    if (!isSupportScope(scope)) issues.push(`SCOPE_UNKNOWN:${scope}`);
    else if (scope === 'tenant.action.execute') issues.push('ACTION_SCOPE_NOT_AVAILABLE');
    else if (!SUPPORT_MODE_SCOPES[mode].includes(scope)) issues.push(`SCOPE_NOT_IN_MODE:${scope}`);
  }
  if (input.minutes > input.maxMinutes) issues.push(`DURATION_EXCEEDS_POLICY:${input.maxMinutes}`);
  return [...new Set(issues)];
}

export function describeSupportIssue(code: string): string {
  const [base, detail] = code.split(':');
  const labels: Record<string, string> = {
    MODE_UNKNOWN: 'Unbekannter Zugriffsmodus.',
    ASSISTED_ACTION_NOT_AVAILABLE: 'Unterstützte Aktionen im Mandanten (ASSISTED_ACTION) sind in dieser Version nicht verfügbar.',
    ACTION_SCOPE_NOT_AVAILABLE: 'Der Scope „tenant.action.execute“ ist in dieser Version nicht verfügbar; er erfordert eine konkrete Policy und Freigabe.',
    SCOPES_REQUIRED: 'Mindestens ein Scope ist erforderlich.',
    SCOPE_UNKNOWN: `Unbekannter Scope${detail ? ` „${detail}“` : ''}.`,
    SCOPE_NOT_IN_MODE: `Der Scope${detail ? ` „${detail}“` : ''} gehört nicht zu diesem Zugriffsmodus.`,
    DURATION_EXCEEDS_POLICY: `Die Dauer überschreitet die Plattformrichtlinie${detail ? ` (höchstens ${detail} Minuten)` : ''}.`,
  };
  return labels[base ?? ''] ?? 'Die Anforderung ist nicht zulässig.';
}
