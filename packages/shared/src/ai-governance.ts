import { sha256Bytes } from './sha256';

/**
 * AI Platform Governance (Amendment 03 §8–§12): reine, datenbankfreie Entscheidungslogik für Modellprofile, Routen und Fallback.
 * Alles, was „darf dieses Modell diesen Aufruf bedienen?“ entscheidet, steht hier – deterministisch und einzeln testbar. Geschäftscode kennt nur
 * logische Profile (`AiProfileKey`), nie Anbieter- oder Modellnamen (OPS-07).
 */

export const AI_PROFILE_KEYS = ['FAST_CLASSIFICATION', 'DOCUMENT_EXTRACTION', 'COMPLEX_REASONING', 'BUSINESS_DRAFTING', 'COPILOT_INTERACTIVE', 'AGENT_TOOL_USE'] as const;
export type AiProfileKey = (typeof AI_PROFILE_KEYS)[number];

/** Fähigkeiten, die ein Modell besitzen kann (Capability-Tags im Modellregister). */
export const AI_CAPABILITIES = ['chat', 'tool_use', 'structured_output', 'long_context'] as const;

export interface DefaultProfileDefinition {
  key: AiProfileKey;
  purpose: string;
  requiredCapabilities: string[];
  /** Obergrenze für Fallback, die eine Route dieses Profils nutzen darf. */
  fallbackMode: AiFallbackMode;
}

export type AiFallbackMode = 'NO_FALLBACK' | 'SAME_PROVIDER_FALLBACK' | 'APPROVED_CROSS_PROVIDER_FALLBACK';

const FALLBACK_RANK: Record<AiFallbackMode, number> = { NO_FALLBACK: 0, SAME_PROVIDER_FALLBACK: 1, APPROVED_CROSS_PROVIDER_FALLBACK: 2 };

/** Ist `requested` höchstens so weitgehend wie `allowed`? */
export function fallbackWithin(requested: AiFallbackMode, allowed: AiFallbackMode): boolean {
  return FALLBACK_RANK[requested] <= FALLBACK_RANK[allowed];
}

/** Standardprofile der Plattform. Alle heutigen Aufrufer arbeiten mit Tool-Aufrufen (strukturierte Ergebnisse), daher `tool_use`. */
export const DEFAULT_PROFILE_DEFINITIONS: DefaultProfileDefinition[] = [
  { key: 'FAST_CLASSIFICATION', purpose: 'Schnelle Einordnung eingehender Nachrichten (Triage).', requiredCapabilities: ['chat', 'tool_use'], fallbackMode: 'SAME_PROVIDER_FALLBACK' },
  { key: 'DOCUMENT_EXTRACTION', purpose: 'Strukturierte Fakten aus Nachrichten und Dokumenten gewinnen.', requiredCapabilities: ['chat', 'tool_use', 'structured_output'], fallbackMode: 'SAME_PROVIDER_FALLBACK' },
  { key: 'COMPLEX_REASONING', purpose: 'Planung und mehrstufiges fachliches Abwägen.', requiredCapabilities: ['chat', 'tool_use'], fallbackMode: 'SAME_PROVIDER_FALLBACK' },
  { key: 'BUSINESS_DRAFTING', purpose: 'Formulierung geschäftlicher Texte (Entwürfe).', requiredCapabilities: ['chat'], fallbackMode: 'SAME_PROVIDER_FALLBACK' },
  { key: 'COPILOT_INTERACTIVE', purpose: 'Interaktive Sonde im Dialog mit Nutzerinnen und Nutzern.', requiredCapabilities: ['chat', 'tool_use'], fallbackMode: 'SAME_PROVIDER_FALLBACK' },
  { key: 'AGENT_TOOL_USE', purpose: 'Agentenläufe mit Werkzeugaufrufen unter Policy.', requiredCapabilities: ['chat', 'tool_use'], fallbackMode: 'SAME_PROVIDER_FALLBACK' },
];

export type AiHealthStatusValue = 'UP' | 'DEGRADED' | 'RATE_LIMITED' | 'DOWN' | 'DISABLED' | 'UNKNOWN';

export interface CandidateInput {
  profile: { key: string; requiredCapabilities: readonly string[]; requiredDataPolicyRefs: readonly string[] };
  provider: { providerKey: string; lifecycle: string; supportedRegions: readonly string[] };
  model: {
    id: string;
    lifecycle: string;
    capabilityTags: readonly string[];
    toolUseSupported: boolean;
    structuredOutputSupported: boolean;
    regionAvailability: readonly string[];
    dataPolicyRefs: readonly string[];
  };
  connection?: { lifecycle: string; allowedProfileKeys: readonly string[] } | null;
  health?: { status: AiHealthStatusValue } | null;
  /** Region/Datenraum des Mandanten (z. B. `EU`). Leer = keine Einschränkung bekannt. */
  tenantRegion?: string;
}

export interface CandidateVerdict {
  usable: boolean;
  /** Nutzbar, aber mit Einschränkung (z. B. Anbieter gedrosselt/degradiert). */
  degraded: boolean;
  reasons: string[];
}

export function modelCapabilities(model: Pick<CandidateInput['model'], 'capabilityTags' | 'toolUseSupported' | 'structuredOutputSupported'>): Set<string> {
  const caps = new Set(model.capabilityTags);
  if (model.toolUseSupported) caps.add('tool_use');
  if (model.structuredOutputSupported) caps.add('structured_output');
  return caps;
}

/**
 * Darf dieses Modell diesen Aufruf bedienen? „Der Anbieter ist gesund“ allein reicht nie (Amendment 03 §22): Lifecycle, Freigabe, Verbindung,
 * Fähigkeiten, Region und Datenrichtlinie müssen ebenfalls passen. Die Gründe sind stabile Codes (für Audit, API und ehrliche Fehlermeldungen).
 */
export function evaluateCandidate(input: CandidateInput): CandidateVerdict {
  const reasons: string[] = [];
  if (input.provider.lifecycle !== 'ACTIVE') reasons.push('PROVIDER_NOT_ACTIVE');
  if (input.model.lifecycle !== 'APPROVED') reasons.push('MODEL_NOT_APPROVED');

  if (!input.connection) reasons.push('CONNECTION_MISSING');
  else {
    if (!['ACTIVE', 'DEGRADED'].includes(input.connection.lifecycle)) reasons.push('CONNECTION_NOT_ACTIVE');
    if (input.connection.allowedProfileKeys.length > 0 && !input.connection.allowedProfileKeys.includes(input.profile.key)) reasons.push('PROFILE_NOT_ALLOWED_ON_CONNECTION');
  }

  const caps = modelCapabilities(input.model);
  for (const required of input.profile.requiredCapabilities) if (!caps.has(required)) reasons.push(`CAPABILITY_MISSING:${required}`);

  if (input.tenantRegion) {
    const regionOk = (input.model.regionAvailability.length === 0 || input.model.regionAvailability.includes(input.tenantRegion)) && (input.provider.supportedRegions.length === 0 || input.provider.supportedRegions.includes(input.tenantRegion));
    if (!regionOk) reasons.push('REGION_NOT_ALLOWED');
  }
  for (const ref of input.profile.requiredDataPolicyRefs) if (!input.model.dataPolicyRefs.includes(ref)) reasons.push(`DATA_POLICY_MISSING:${ref}`);

  const health = input.health?.status ?? 'UNKNOWN';
  if (health === 'DOWN') reasons.push('HEALTH_DOWN');
  if (health === 'DISABLED') reasons.push('HEALTH_DISABLED');

  return { usable: reasons.length === 0, degraded: reasons.length === 0 && (health === 'DEGRADED' || health === 'RATE_LIMITED' || input.connection?.lifecycle === 'DEGRADED'), reasons };
}

/**
 * Reihenfolge der Modelle für einen Aufruf gemäß Fallback-Modus der Route (Amendment 03 §10.3, §11). Ohne ausdrücklich erlaubten Fallback kommt nie ein
 * anderes Modell als das primäre in Frage; ein anderer Anbieter nur im Modus APPROVED_CROSS_PROVIDER_FALLBACK.
 */
export function planFallbackChain(route: { primaryModelId: string; fallbackModelIds: readonly string[]; fallbackMode: AiFallbackMode }, providerOf: (modelId: string) => string | undefined): string[] {
  const chain = [route.primaryModelId];
  if (route.fallbackMode === 'NO_FALLBACK') return chain;
  const primaryProvider = providerOf(route.primaryModelId);
  for (const id of route.fallbackModelIds) {
    if (chain.includes(id)) continue;
    const provider = providerOf(id);
    if (!provider) continue;
    if (route.fallbackMode === 'SAME_PROVIDER_FALLBACK' && provider !== primaryProvider) continue;
    chain.push(id);
  }
  return chain;
}

/** Stabiler Prozentsatz-Bucket (0–99) je Mandant und Route: dieselbe Zuordnung bei jedem Aufruf (Amendment 03 §14.3 – kein Flackern). */
export function stableBucket(subject: string, salt: string): number {
  const digest = sha256Bytes(`${salt}:${subject}`);
  return (((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0) % 100;
}

export function routeInWindow(route: { activeFrom?: Date | null; activeUntil?: Date | null }, now: Date): boolean {
  if (route.activeFrom && route.activeFrom.getTime() > now.getTime()) return false;
  if (route.activeUntil && route.activeUntil.getTime() <= now.getTime()) return false;
  return true;
}

export interface RouteActivationInput {
  profile: { lifecycle: string; fallbackMode: AiFallbackMode; requiredCapabilities: readonly string[]; requiredDataPolicyRefs: readonly string[]; key: string } | null;
  route: { fallbackMode: AiFallbackMode; primaryModelId: string; fallbackModelIds: readonly string[]; environment: string; trafficPercent: number };
  primary: { model: CandidateInput['model'] & { evaluationStatus: string }; provider: CandidateInput['provider']; connection?: CandidateInput['connection']; health?: CandidateInput['health'] } | null;
  fallbacks: Array<{ model: CandidateInput['model'] & { evaluationStatus: string }; provider: CandidateInput['provider']; connection?: CandidateInput['connection']; health?: CandidateInput['health'] }>;
  tenantRegion?: string;
}

/**
 * Vorbedingungen für die Aktivierung einer Route (Amendment 03 §8.5): Adapter aktiv, Modell freigegeben, Evaluation bestanden, Region/Datenrichtlinie
 * kompatibel, Verbindung gesund, Profil veröffentlicht, Fallback innerhalb der Profilgrenze. Leere Liste = aktivierbar.
 */
export function checkRouteActivation(input: RouteActivationInput): string[] {
  const issues: string[] = [];
  if (!input.profile) return ['PROFILE_NOT_FOUND'];
  if (input.profile.lifecycle !== 'PUBLISHED') issues.push('PROFILE_NOT_PUBLISHED');
  if (!fallbackWithin(input.route.fallbackMode, input.profile.fallbackMode)) issues.push('FALLBACK_EXCEEDS_PROFILE');
  if (input.route.fallbackMode === 'NO_FALLBACK' && input.route.fallbackModelIds.length > 0) issues.push('FALLBACK_MODELS_WITHOUT_FALLBACK_MODE');
  if (input.route.trafficPercent < 1 || input.route.trafficPercent > 100) issues.push('TRAFFIC_PERCENT_INVALID');
  if (!input.primary) return [...issues, 'PRIMARY_MODEL_NOT_FOUND'];

  const check = (entry: NonNullable<RouteActivationInput['primary']>, label: string) => {
    const verdict = evaluateCandidate({
      profile: input.profile!,
      provider: entry.provider,
      model: entry.model,
      connection: entry.connection,
      health: entry.health ?? { status: 'UP' },
      tenantRegion: input.tenantRegion,
    });
    for (const reason of verdict.reasons) issues.push(`${label}:${reason}`);
    if (entry.model.evaluationStatus !== 'PASSED') issues.push(`${label}:EVALUATION_NOT_PASSED`);
  };
  check(input.primary, 'PRIMARY');
  input.fallbacks.forEach((fallback, index) => check(fallback, `FALLBACK_${index + 1}`));
  if (input.route.fallbackMode === 'SAME_PROVIDER_FALLBACK') {
    for (const [index, fallback] of input.fallbacks.entries()) if (fallback.provider.providerKey !== input.primary.provider.providerKey) issues.push(`FALLBACK_${index + 1}:PROVIDER_MISMATCH`);
  }
  return issues;
}

/** Verständliche Beschreibung eines Grundcodes (für Platform-UI und ehrliche Fehler; nie Rohtext des Anbieters). */
export function describeAiReason(code: string): string {
  const [base, detail] = code.replace(/^(PRIMARY|FALLBACK_\d+):/, '').split(':');
  const labels: Record<string, string> = {
    PROVIDER_NOT_ACTIVE: 'Der Anbieter ist nicht aktiv.',
    MODEL_NOT_APPROVED: 'Das Modell ist nicht freigegeben.',
    CONNECTION_MISSING: 'Es gibt keine Plattformverbindung für diesen Anbieter in dieser Umgebung.',
    CONNECTION_NOT_ACTIVE: 'Die Plattformverbindung ist nicht aktiv.',
    PROFILE_NOT_ALLOWED_ON_CONNECTION: 'Die Verbindung ist für dieses Profil nicht freigegeben.',
    CAPABILITY_MISSING: `Dem Modell fehlt die erforderliche Fähigkeit${detail ? ` „${detail}“` : ''}.`,
    REGION_NOT_ALLOWED: 'Region oder Datenraum sind für dieses Modell nicht zulässig.',
    DATA_POLICY_MISSING: `Die erforderliche Datenrichtlinie${detail ? ` „${detail}“` : ''} wird vom Modell nicht erfüllt.`,
    HEALTH_DOWN: 'Der Anbieter ist derzeit nicht erreichbar.',
    HEALTH_DISABLED: 'Der Anbieter ist deaktiviert.',
    EVALUATION_NOT_PASSED: 'Die Evaluation des Modells ist nicht bestanden.',
    PROFILE_NOT_PUBLISHED: 'Das Profil ist nicht veröffentlicht.',
    PROFILE_NOT_FOUND: 'Das Profil existiert nicht.',
    FALLBACK_EXCEEDS_PROFILE: 'Der Fallback geht über das hinaus, was das Profil erlaubt.',
    PROVIDER_MISMATCH: 'Das Fallback-Modell gehört zu einem anderen Anbieter.',
    PRIMARY_MODEL_NOT_FOUND: 'Das primäre Modell existiert nicht.',
  };
  return labels[base ?? ''] ?? 'Die Voraussetzungen sind nicht erfüllt.';
}

// ── Health (Amendment 03 §12.1) ──────────────────────────────────────────────────────────────────────────────────────

export interface HealthState {
  status: AiHealthStatusValue;
  consecutiveFailures: number;
  lastSuccessAt?: Date | null;
  lastFailureAt?: Date | null;
  lastErrorClass?: string | null;
  avgLatencyMs?: number | null;
}

export type LlmErrorClass = 'RATE_LIMITED' | 'AUTH' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_OUTPUT' | 'UNKNOWN';

/** Ordnet einen Adapterfehler ein, ohne den Rohtext weiterzugeben (kein Secret-/Inhaltsleck in Health, Usage oder Logs). */
export function classifyLlmError(error: unknown): LlmErrorClass {
  const text = (error instanceof Error ? `${error.name} ${error.message} ${(error as { details?: { cause?: unknown } }).details?.cause ?? ''}` : String(error)).toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|quota/.test(text)) return 'RATE_LIMITED';
  if (/\b401\b|\b403\b|unauthor|forbidden|invalid api key|authentication|incorrect api key/.test(text)) return 'AUTH';
  if (/timeout|timed out|etimedout|econnreset|aborted/.test(text)) return 'TIMEOUT';
  if (/malformed|invalid (output|json)|schema/.test(text)) return 'INVALID_OUTPUT';
  if (/\b5\d\d\b|overloaded|unavailable|econnrefused|enotfound|api request failed|externalsystem/.test(text)) return 'PROVIDER_ERROR';
  return 'UNKNOWN';
}

/** Schwelle, ab der aufeinanderfolgende Fehler einen Anbieter als DOWN führen (Circuit Breaker öffnet). */
export const HEALTH_DOWN_AFTER_FAILURES = 3;
/** Nach dieser Zeit ohne neuen Fehler darf wieder ein Aufruf probiert werden (half-open). */
export const HEALTH_COOLDOWN_MS = 60_000;

export function applyHealthOutcome(previous: HealthState | null, outcome: { ok: boolean; latencyMs?: number; errorClass?: LlmErrorClass | string }, now: Date): HealthState {
  const prev: HealthState = previous ?? { status: 'UNKNOWN', consecutiveFailures: 0 };
  if (outcome.ok) {
    const avg = outcome.latencyMs === undefined ? (prev.avgLatencyMs ?? null) : prev.avgLatencyMs ? Math.round(prev.avgLatencyMs * 0.8 + outcome.latencyMs * 0.2) : outcome.latencyMs;
    return { status: 'UP', consecutiveFailures: 0, lastSuccessAt: now, lastFailureAt: prev.lastFailureAt ?? null, lastErrorClass: null, avgLatencyMs: avg };
  }
  const failures = prev.consecutiveFailures + 1;
  const errorClass = outcome.errorClass ?? 'UNKNOWN';
  const status: AiHealthStatusValue = errorClass === 'RATE_LIMITED' ? 'RATE_LIMITED' : failures >= HEALTH_DOWN_AFTER_FAILURES ? 'DOWN' : 'DEGRADED';
  return { status, consecutiveFailures: failures, lastSuccessAt: prev.lastSuccessAt ?? null, lastFailureAt: now, lastErrorClass: errorClass, avgLatencyMs: prev.avgLatencyMs ?? null };
}

/** Status für Routing-Entscheidungen: ein DOWN-Anbieter wird nach der Abkühlzeit wieder probiert (half-open), bleibt aber bis dahin gesperrt. DISABLED bleibt bis zur Freigabe gesperrt. */
export function effectiveHealth(state: HealthState | null | undefined, now: Date, cooldownMs: number = HEALTH_COOLDOWN_MS): AiHealthStatusValue {
  if (!state) return 'UNKNOWN';
  if (state.status === 'DOWN' && state.lastFailureAt && now.getTime() - state.lastFailureAt.getTime() >= cooldownMs) return 'UNKNOWN';
  return state.status;
}

/** Geschätzte Kosten je Aufruf aus dem Kostenprofil des Modells. `null`, wenn Profil oder Verbrauch unbekannt sind – Kosten werden nie erfunden. */
export function estimateCost(usage: { inputTokens?: number | null; outputTokens?: number | null }, cost: { inputPerMtok?: number | null; outputPerMtok?: number | null }): number | null {
  if (usage.inputTokens == null || usage.outputTokens == null || cost.inputPerMtok == null || cost.outputPerMtok == null) return null;
  return (usage.inputTokens * cost.inputPerMtok + usage.outputTokens * cost.outputPerMtok) / 1_000_000;
}
