/** Rollen der Plattformdomäne in Alltagssprache (Amendment 03 §4, Matrix `PLATFORM_ROLE_SCOPES`); die Rechte dahinter bestimmt allein der Server. */
export const PLATFORM_ROLE_LABELS: Record<string, { label: string; description: string }> = {
  PLATFORM_OWNER: { label: 'Owner', description: 'Alle Bereiche; als Einzige verwalten sie Betreiberzugänge' },
  PLATFORM_OPERATOR: { label: 'Betrieb', description: 'Mandantenzustand, KI-Register samt Zugangsdaten, Anbindungen, Feature-Flags; kein Notschalter' },
  PLATFORM_SUPPORT: { label: 'Support', description: 'Lesen und Support-Sitzungen anfordern; keine Änderungen' },
  PLATFORM_SECURITY: { label: 'Sicherheit', description: 'Notschalter, Anbindungen sperren, Support-Sitzungen freigeben, gesamtes Audit' },
  PLATFORM_FINOPS: { label: 'Kosten', description: 'KI-Nutzung und Kosten einsehen' },
  PLATFORM_RELEASE_MANAGER: { label: 'Releases', description: 'Feature-Flags, Konfiguration, Anbindungen, Notschalter' },
  PLATFORM_ENGINEERING: { label: 'Technik', description: 'KI-Register, Anbindungen und Feature-Flags; keine Zugangsdaten, kein Notschalter' },
  PLATFORM_AUDITOR: { label: 'Audit', description: 'Nur lesen, einschließlich des gesamten Audits' },
};

export const platformRoleLabel = (role: string): string => PLATFORM_ROLE_LABELS[role]?.label ?? 'Unbekannte Rolle';
