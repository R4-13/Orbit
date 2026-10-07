/** Fachliche Bezeichnungen für Support-Sitzungen (Amendment 03 §18); technische Schlüssel erscheinen nie in der Oberfläche. */
export const SUPPORT_MODE_LABELS: Record<string, string> = {
  READ_DIAGNOSTICS: 'Nur Diagnose lesen',
  READ_TENANT_CONTEXT: 'Mandantenkontext lesen',
  ASSISTED_ACTION: 'Unterstützte Aktion (nicht verfügbar)',
};

export const SUPPORT_SCOPE_LABELS: Record<string, string> = {
  'diagnostics.read': 'Diagnose von Vorgängen',
  'connector.status.read': 'Zustand der Anbindungen',
  'tenant.config.read': 'Konfiguration des Mandanten',
  'case.metadata.read': 'Vorgänge (nur Metadaten)',
  'case.payload.read': 'Inhalte von Vorgängen (sensibel, Vier-Augen-Freigabe)',
  'tenant.action.execute': 'Aktionen im Mandanten (nicht verfügbar)',
};

export const SUPPORT_REASON_LABELS: Record<string, string> = {
  INCIDENT: 'Störung',
  CUSTOMER_REQUEST: 'Kundenanfrage',
  SECURITY: 'Sicherheit',
  QUALITY: 'Qualitätsprüfung',
};

export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Angefordert',
  ACTIVE: 'Aktiv',
  EXPIRED: 'Abgelaufen',
  REVOKED: 'Widerrufen',
  CLOSED: 'Beendet',
};

export const supportModeLabel = (mode: string): string => SUPPORT_MODE_LABELS[mode] ?? 'Unbekannter Modus';
export const supportScopeLabel = (scope: string): string => SUPPORT_SCOPE_LABELS[scope] ?? 'Unbekannter Zugriff';
export const supportReasonLabel = (reason: string): string => SUPPORT_REASON_LABELS[reason] ?? 'Sonstiger Grund';
export const supportStatusLabel = (status: string): string => SUPPORT_STATUS_LABELS[status] ?? 'Unbekannter Zustand';
