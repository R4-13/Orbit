/** Fachliche Bezeichnungen der Mandantenzustände und Sperrarten (Amendment 03 §6); die technischen Schlüssel erscheinen nie in der Oberfläche. */
export const TENANT_STATUS_LABELS: Record<string, string> = {
  PROVISIONING: 'In Einrichtung',
  ACTIVE: 'Aktiv',
  SUSPENDED: 'Gesperrt',
  OFFBOARDING: 'Wird abgeschaltet',
  CLOSED: 'Geschlossen',
};

export const SUSPENSION_SCOPE_LABELS: Record<string, string> = {
  LOGIN: 'Anmeldung',
  AUTOMATION: 'Automatisierung',
  CONNECTORS: 'Anbindungen',
  BILLING: 'Abrechnung',
  SECURITY_QUARANTINE: 'Sicherheitsquarantäne',
};

export const tenantStatusLabel = (status: string): string => TENANT_STATUS_LABELS[status] ?? 'Unbekannter Zustand';
export const suspensionScopeLabel = (scope: string): string => SUSPENSION_SCOPE_LABELS[scope] ?? 'Unbekannte Sperrart';
