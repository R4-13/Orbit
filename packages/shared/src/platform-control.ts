import { sha256Hex } from './sha256';
import { stableBucket } from './ai-governance';

/**
 * Plattformsteuerung (Amendment 03 §6, §14, §15): Kill Switches, Feature Flags, Mandantenlebenszyklus. Reine, datenbankfreie Entscheidungslogik –
 * die Laufzeit (`PlatformControlService`) und die Tests nutzen dieselben Funktionen.
 */

// ── Kill Switches ────────────────────────────────────────────────────────────────────────────────────────────────────

export const KILL_SWITCHES = {
  /** Keine neuen KI-Ausführungen (alle Profile, auch BYOK). Bestehende Historie bleibt, laufende Fälle gehen in einen ehrlichen Wartezustand. */
  AI_EXECUTIONS: 'ai.executions',
  /** Keine neuen autonomen externen Sendungen: AUTONOMOUS wird auf REQUIRE_APPROVAL zurückgenommen (Plattform vor Mandantenpolicy). */
  AUTONOMOUS_EXTERNAL_SEND: 'external.autonomous_send',
  /** Kein KI-Planer: Neuplanung/Planbildung meldet „nicht verfügbar“; Referenzgraphen laufen deterministisch weiter. */
  ADAPTIVE_PLANNER: 'planner.adaptive',
} as const;

export type KillSwitchKey = (typeof KILL_SWITCHES)[keyof typeof KILL_SWITCHES];

export const KILL_SWITCH_DESCRIPTIONS: Record<KillSwitchKey, { title: string; effect: string }> = {
  'ai.executions': { title: 'KI-Ausführungen stoppen', effect: 'Neue KI-Aufrufe aller Mandanten (ORBIT Managed und eigener Schlüssel) werden mit einem ehrlichen Fehler abgewiesen; Vorgänge warten, bis der Schalter gelöst wird.' },
  'external.autonomous_send': { title: 'Autonomen externen Versand stoppen', effect: 'Aktionen mit externem Versand laufen nicht mehr autonom, sondern nur noch nach Freigabe; nichts wird versendet, bis ein Mensch freigibt.' },
  'planner.adaptive': { title: 'KI-Planer stoppen', effect: 'Der KI-Planer plant nicht mehr (auch nicht neu); feste Referenzgraphen laufen weiter.' },
};

export function isKillSwitchKey(value: string): value is KillSwitchKey {
  return (Object.values(KILL_SWITCHES) as string[]).includes(value);
}

/** Policy-Aktionen mit externer Wirkung nach außen (Versand), die der Kill Switch `external.autonomous_send` betrifft. */
export const EXTERNAL_SEND_POLICY_ACTIONS: readonly string[] = ['followup.send', 'email.send.clarification', 'email.send.quote_delivery'];

/**
 * Reine Lese-/Analyseaktionen ohne Wirkung. Eine Sperre der Automatisierung (AUTOMATION/BILLING/Quarantäne) nimmt Autonomie nur dort zurück, wo etwas
 * verändert oder versendet wird – Lesen und Einordnen (z. B. für die Sonde oder die Triage) bleibt möglich.
 */
export const READ_ONLY_POLICY_ACTIONS: readonly string[] = ['copilot.read', 'calendar.read', 'context.lookup', 'requirements.resolve', 'pricing.resolve', 'email.classify', 'email.triage', 'process.plan', 'email.draft'];

// ── Mandantenlebenszyklus ────────────────────────────────────────────────────────────────────────────────────────────

export const TENANT_LIFECYCLE_STATUSES = ['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'CLOSED'] as const;
export type TenantLifecycleStatus = (typeof TENANT_LIFECYCLE_STATUSES)[number];

/** Feingranulare Sperrarten (Amendment 03 §6.2) – ein pauschaler Boolean reicht nicht. */
export const TENANT_SUSPENSION_SCOPES = ['LOGIN', 'AUTOMATION', 'CONNECTORS', 'BILLING', 'SECURITY_QUARANTINE'] as const;
export type TenantSuspensionScope = (typeof TENANT_SUSPENSION_SCOPES)[number];

export interface TenantGate {
  status: string;
  scopes: readonly string[];
  loginAllowed: boolean;
  /** Autonome Verarbeitung erlaubt (sonst: nur noch nach Freigabe). */
  automationAllowed: boolean;
  /** Verbindungsaktivität (Capabilities mit Connector) erlaubt. */
  connectorsAllowed: boolean;
}

/**
 * Was ein Mandantenzustand erlaubt. Plattformbeschränkungen werden nur strenger, nie lockerer: `SECURITY_QUARANTINE` sperrt Anmeldung, Automatisierung und
 * Verbindungen; `BILLING` sperrt die Anmeldung nicht, aber neue Automatisierung; ein nicht aktiver Lebenszyklus sperrt alles.
 */
export function tenantGateOf(status: string, scopes: readonly string[]): TenantGate {
  const active = status === 'ACTIVE';
  const quarantine = scopes.includes('SECURITY_QUARANTINE');
  return {
    status,
    scopes,
    loginAllowed: active && !scopes.includes('LOGIN') && !quarantine,
    automationAllowed: active && !scopes.includes('AUTOMATION') && !scopes.includes('BILLING') && !quarantine,
    connectorsAllowed: active && !scopes.includes('CONNECTORS') && !quarantine,
  };
}

/** Beschreibt die Wirkung eines Zielzustands in Klartext (für die Bestätigung – kein generisches „OK“, Amendment 03 §26.2). */
export function describeTenantTarget(target: { status: string; scopes: readonly string[]; cohorts: readonly string[] }, activeUsers: number): string[] {
  const gate = tenantGateOf(target.status, target.scopes);
  const effects: string[] = [];
  if (!gate.loginAllowed) effects.push(`${activeUsers} aktive Nutzer können sich nicht mehr anmelden; bestehende Sitzungen enden spätestens nach wenigen Sekunden.`);
  if (!gate.automationAllowed) effects.push('Neue autonome Verarbeitung ist gestoppt: Aktionen laufen nur noch nach Freigabe.');
  if (!gate.connectorsAllowed) effects.push('Alle Verbindungsaktivität ist gestoppt: Vorgänge mit externen Systemen warten mit verständlichem Status.');
  if (effects.length === 0) effects.push('Der Mandant ist uneingeschränkt aktiv.');
  if (target.cohorts.length > 0) effects.push(`Feature-Kohorten: ${target.cohorts.join(', ')}.`);
  return effects;
}

/** Bestätigungs-Token: bindet die Bestätigung an genau diesen Zielzustand und seine beschriebene Wirkung. */
export function confirmationTokenFor(tenantId: string, target: { status: string; scopes: readonly string[]; cohorts: readonly string[] }, effects: readonly string[]): string {
  const canonical = JSON.stringify({ tenantId, status: target.status, scopes: [...target.scopes].sort(), cohorts: [...target.cohorts].sort(), effects });
  return sha256Hex(canonical).slice(0, 24);
}

// ── Feature Flags ────────────────────────────────────────────────────────────────────────────────────────────────────

export type FlagValue = boolean | string | number;

export interface FlagDefinition {
  key: string;
  lifecycle: string;
  defaultValue: FlagValue;
  environmentOverrides: Array<{ environment: string; value: FlagValue }>;
  /** `percent` (1–100): stabiler Anteil der Mandanten der Kohorte; fehlt er, gilt die ganze Kohorte. */
  cohortOverrides: Array<{ cohort: string; value: FlagValue; percent?: number }>;
  tenantOverrides: Array<{ tenantId: string; value: FlagValue }>;
  expiresAt?: Date | null;
}

export interface FlagEvaluation {
  value: FlagValue;
  /** Welche Ebene den Wert bestimmt hat – für Vorschau und Diagnose. */
  source: 'TENANT' | 'COHORT' | 'ENVIRONMENT' | 'DEFAULT' | 'EXPIRED' | 'RETIRED' | 'DRAFT';
}

/**
 * Auswertung eines Flags für einen Mandanten (Amendment 03 §14): Mandant > Kohorte > Umgebung > Standard. Abgelaufene/zurückgezogene Flags liefern den
 * Standardwert (kein stilles Weiterwirken eines Rollouts), Entwürfe liefern den Standard. Ein Flag kann nie Mandantenisolation umgehen – es liefert nur Werte.
 */
export function evaluateFlag(flag: FlagDefinition, context: { tenantId: string; cohorts: readonly string[]; environment: string; now?: Date }): FlagEvaluation {
  const now = context.now ?? new Date();
  if (flag.lifecycle === 'RETIRED') return { value: flag.defaultValue, source: 'RETIRED' };
  if (flag.lifecycle === 'EXPIRED' || (flag.expiresAt && flag.expiresAt.getTime() <= now.getTime())) return { value: flag.defaultValue, source: 'EXPIRED' };
  if (flag.lifecycle === 'DRAFT') return { value: flag.defaultValue, source: 'DRAFT' };

  const tenant = flag.tenantOverrides.find((o) => o.tenantId === context.tenantId);
  if (tenant) return { value: tenant.value, source: 'TENANT' };
  for (const cohort of flag.cohortOverrides) {
    if (!context.cohorts.includes(cohort.cohort)) continue;
    if (cohort.percent !== undefined && stableBucket(context.tenantId, `${flag.key}:${cohort.cohort}`) >= cohort.percent) continue;
    return { value: cohort.value, source: 'COHORT' };
  }
  const environment = flag.environmentOverrides.find((o) => o.environment === context.environment);
  if (environment) return { value: environment.value, source: 'ENVIRONMENT' };
  return { value: flag.defaultValue, source: 'DEFAULT' };
}

/** Sicherheitskontrollen dürfen nicht allein hinter einem optionalen Flag liegen (Amendment 03 §14.3): solche Schlüssel sind reserviert und nicht als Flag anlegbar. */
export const RESERVED_FLAG_PREFIXES = ['security.', 'tenant_isolation', 'auth.', 'audit.'] as const;

export function isReservedFlagKey(key: string): boolean {
  return RESERVED_FLAG_PREFIXES.some((prefix) => key.startsWith(prefix));
}
