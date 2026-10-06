import { describe, expect, it } from 'vitest';
import {
  AI_PROFILE_KEYS,
  DEFAULT_PROFILE_DEFINITIONS,
  checkRouteActivation,
  describeAiReason,
  evaluateCandidate,
  fallbackWithin,
  planFallbackChain,
  routeInWindow,
  stableBucket,
  type CandidateInput,
  type RouteActivationInput,
} from './ai-governance';

const profile = { key: 'COMPLEX_REASONING', requiredCapabilities: ['chat', 'tool_use'], requiredDataPolicyRefs: [] as string[] };
const provider = { providerKey: 'openai', lifecycle: 'ACTIVE', supportedRegions: ['EU', 'US'] };
const model = { id: 'm1', lifecycle: 'APPROVED', capabilityTags: ['chat'], toolUseSupported: true, structuredOutputSupported: true, regionAvailability: ['EU'], dataPolicyRefs: ['dpa-eu'] };
const connection = { lifecycle: 'ACTIVE', allowedProfileKeys: [] as string[] };

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return { profile, provider, model, connection, health: { status: 'UP' }, tenantRegion: 'EU', ...overrides };
}

describe('Standardprofile', () => {
  it('es gibt genau die sechs spezifizierten Profile und jedes hat Zweck und Fähigkeiten', () => {
    expect(DEFAULT_PROFILE_DEFINITIONS.map((p) => p.key).sort()).toEqual([...AI_PROFILE_KEYS].sort());
    for (const p of DEFAULT_PROFILE_DEFINITIONS) {
      expect(p.purpose.length).toBeGreaterThan(10);
      expect(p.requiredCapabilities).toContain('chat');
    }
  });
});

describe('evaluateCandidate (OAI-03, OAI-04, OAI-10)', () => {
  it('ein gesunder, freigegebener Pfad ist nutzbar', () => {
    expect(evaluateCandidate(candidate())).toEqual({ usable: true, degraded: false, reasons: [] });
  });

  it('OAI-03: ein nicht freigegebenes Modell ist nie nutzbar – auch nicht, wenn der Anbieter gesund ist', () => {
    for (const lifecycle of ['VALIDATING', 'DEPRECATED', 'BLOCKED', 'RETIRED']) {
      const verdict = evaluateCandidate(candidate({ model: { ...model, lifecycle } }));
      expect(verdict.usable).toBe(false);
      expect(verdict.reasons).toContain('MODEL_NOT_APPROVED');
    }
  });

  it('OAI-04: ein gesunder Anbieter wird nicht gewählt, wenn Region oder Datenrichtlinie nicht passen', () => {
    expect(evaluateCandidate(candidate({ tenantRegion: 'US' })).reasons).toContain('REGION_NOT_ALLOWED');
    expect(evaluateCandidate(candidate({ profile: { ...profile, requiredDataPolicyRefs: ['no-training'] } })).reasons).toContain('DATA_POLICY_MISSING:no-training');
    expect(evaluateCandidate(candidate({ provider: { ...provider, supportedRegions: ['US'] } })).reasons).toContain('REGION_NOT_ALLOWED');
  });

  it('fehlende Fähigkeiten, Verbindung und Profilfreigabe der Verbindung werden benannt', () => {
    expect(evaluateCandidate(candidate({ model: { ...model, toolUseSupported: false } })).reasons).toContain('CAPABILITY_MISSING:tool_use');
    expect(evaluateCandidate(candidate({ connection: null })).reasons).toContain('CONNECTION_MISSING');
    expect(evaluateCandidate(candidate({ connection: { lifecycle: 'SUSPENDED', allowedProfileKeys: [] } })).reasons).toContain('CONNECTION_NOT_ACTIVE');
    expect(evaluateCandidate(candidate({ connection: { lifecycle: 'ACTIVE', allowedProfileKeys: ['FAST_CLASSIFICATION'] } })).reasons).toContain('PROFILE_NOT_ALLOWED_ON_CONNECTION');
  });

  it('Health: DOWN/DISABLED sperren, DEGRADED/RATE_LIMITED sind nutzbar aber markiert, UNKNOWN sperrt nicht', () => {
    expect(evaluateCandidate(candidate({ health: { status: 'DOWN' } })).usable).toBe(false);
    expect(evaluateCandidate(candidate({ health: { status: 'DISABLED' } })).usable).toBe(false);
    expect(evaluateCandidate(candidate({ health: { status: 'DEGRADED' } }))).toMatchObject({ usable: true, degraded: true });
    expect(evaluateCandidate(candidate({ health: { status: 'RATE_LIMITED' } }))).toMatchObject({ usable: true, degraded: true });
    expect(evaluateCandidate(candidate({ health: { status: 'UNKNOWN' } })).usable).toBe(true);
  });

  it('OAI-10: ein veralteter (deprecated) Anbieter oder ein pausierter Anbieter bedient keine neuen Aufrufe', () => {
    for (const lifecycle of ['DRAFT', 'VALIDATING', 'DEPRECATED', 'SUSPENDED', 'RETIRED']) expect(evaluateCandidate(candidate({ provider: { ...provider, lifecycle } })).usable).toBe(false);
  });
});

describe('planFallbackChain (OAI-05/06/08)', () => {
  const providerOf = (id: string) => ({ a1: 'openai', a2: 'openai', b1: 'anthropic' })[id];

  it('NO_FALLBACK: ausschließlich das primäre Modell', () => {
    expect(planFallbackChain({ primaryModelId: 'a1', fallbackModelIds: ['a2', 'b1'], fallbackMode: 'NO_FALLBACK' }, providerOf)).toEqual(['a1']);
  });

  it('SAME_PROVIDER_FALLBACK: nur Modelle desselben Anbieters', () => {
    expect(planFallbackChain({ primaryModelId: 'a1', fallbackModelIds: ['b1', 'a2'], fallbackMode: 'SAME_PROVIDER_FALLBACK' }, providerOf)).toEqual(['a1', 'a2']);
  });

  it('APPROVED_CROSS_PROVIDER_FALLBACK: auch andere Anbieter, in der freigegebenen Reihenfolge, ohne Duplikate und Unbekannte', () => {
    expect(planFallbackChain({ primaryModelId: 'a1', fallbackModelIds: ['b1', 'a1', 'x', 'a2'], fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK' }, providerOf)).toEqual(['a1', 'b1', 'a2']);
  });
});

describe('Route: Zeitfenster, Traffic, Fallback-Obergrenze', () => {
  it('routeInWindow beachtet activeFrom und activeUntil', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    expect(routeInWindow({}, now)).toBe(true);
    expect(routeInWindow({ activeFrom: new Date('2026-10-07T00:00:00Z') }, now)).toBe(false);
    expect(routeInWindow({ activeUntil: new Date('2026-10-06T12:00:00Z') }, now)).toBe(false);
    expect(routeInWindow({ activeFrom: new Date('2026-10-01T00:00:00Z'), activeUntil: new Date('2026-10-30T00:00:00Z') }, now)).toBe(true);
  });

  it('stableBucket ist stabil, im Bereich 0–99 und verteilt über Mandanten', () => {
    expect(stableBucket('tenant-1', 'route-1')).toBe(stableBucket('tenant-1', 'route-1'));
    const buckets = Array.from({ length: 400 }, (_, i) => stableBucket(`tenant-${i}`, 'route-1'));
    expect(Math.min(...buckets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...buckets)).toBeLessThanOrEqual(99);
    const below50 = buckets.filter((b) => b < 50).length;
    expect(below50).toBeGreaterThan(150);
    expect(below50).toBeLessThan(250);
    expect(stableBucket('tenant-1', 'route-1')).not.toBe(stableBucket('tenant-1', 'route-2') + 1000);
  });

  it('fallbackWithin ordnet NO < SAME < CROSS', () => {
    expect(fallbackWithin('NO_FALLBACK', 'NO_FALLBACK')).toBe(true);
    expect(fallbackWithin('SAME_PROVIDER_FALLBACK', 'NO_FALLBACK')).toBe(false);
    expect(fallbackWithin('SAME_PROVIDER_FALLBACK', 'APPROVED_CROSS_PROVIDER_FALLBACK')).toBe(true);
    expect(fallbackWithin('APPROVED_CROSS_PROVIDER_FALLBACK', 'SAME_PROVIDER_FALLBACK')).toBe(false);
  });
});

describe('checkRouteActivation (Amendment 03 §8.5)', () => {
  const published = { ...profile, lifecycle: 'PUBLISHED', fallbackMode: 'SAME_PROVIDER_FALLBACK' as const };
  const ok = { model: { ...model, evaluationStatus: 'PASSED' }, provider, connection, health: { status: 'UP' as const } };
  function input(overrides: Partial<RouteActivationInput> = {}): RouteActivationInput {
    return {
      profile: published,
      route: { fallbackMode: 'NO_FALLBACK', primaryModelId: 'm1', fallbackModelIds: [], environment: 'production', trafficPercent: 100 },
      primary: ok,
      fallbacks: [],
      tenantRegion: 'EU',
      ...overrides,
    };
  }

  it('eine vollständig vorbereitete Route ist aktivierbar', () => {
    expect(checkRouteActivation(input())).toEqual([]);
  });

  it('OAI-03: nicht freigegebenes Modell, nicht bestandene Evaluation, fehlende Verbindung → verweigert', () => {
    expect(checkRouteActivation(input({ primary: { ...ok, model: { ...ok.model, lifecycle: 'VALIDATING' } } }))).toContain('PRIMARY:MODEL_NOT_APPROVED');
    expect(checkRouteActivation(input({ primary: { ...ok, model: { ...ok.model, evaluationStatus: 'NONE' } } }))).toContain('PRIMARY:EVALUATION_NOT_PASSED');
    expect(checkRouteActivation(input({ primary: { ...ok, connection: null } }))).toContain('PRIMARY:CONNECTION_MISSING');
  });

  it('ein nicht veröffentlichtes Profil und ein Fallback über der Profilgrenze verhindern die Aktivierung', () => {
    expect(checkRouteActivation(input({ profile: { ...published, lifecycle: 'DRAFT' } }))).toContain('PROFILE_NOT_PUBLISHED');
    expect(checkRouteActivation(input({ route: { fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK', primaryModelId: 'm1', fallbackModelIds: [], environment: 'production', trafficPercent: 100 } }))).toContain('FALLBACK_EXCEEDS_PROFILE');
    expect(checkRouteActivation(input({ profile: null }))).toEqual(['PROFILE_NOT_FOUND']);
  });

  it('Fallback-Modelle werden mit denselben Regeln geprüft; SAME_PROVIDER verlangt denselben Anbieter', () => {
    const other = { ...ok, provider: { ...provider, providerKey: 'anthropic' } };
    const issues = checkRouteActivation(input({ route: { fallbackMode: 'SAME_PROVIDER_FALLBACK', primaryModelId: 'm1', fallbackModelIds: ['m2'], environment: 'production', trafficPercent: 100 }, fallbacks: [other] }));
    expect(issues).toContain('FALLBACK_1:PROVIDER_MISMATCH');
    const withoutMode = checkRouteActivation(input({ route: { fallbackMode: 'NO_FALLBACK', primaryModelId: 'm1', fallbackModelIds: ['m2'], environment: 'production', trafficPercent: 100 } }));
    expect(withoutMode).toContain('FALLBACK_MODELS_WITHOUT_FALLBACK_MODE');
  });

  it('describeAiReason liefert verständliche Texte, auch für präfixierte und parametrisierte Codes', () => {
    expect(describeAiReason('PRIMARY:MODEL_NOT_APPROVED')).toBe('Das Modell ist nicht freigegeben.');
    expect(describeAiReason('FALLBACK_2:CAPABILITY_MISSING:tool_use')).toContain('tool_use');
    expect(describeAiReason('UNBEKANNT')).toBe('Die Voraussetzungen sind nicht erfüllt.');
  });
});

import { HEALTH_COOLDOWN_MS, applyHealthOutcome, classifyLlmError, effectiveHealth, estimateCost } from './ai-governance';

describe('Health (Amendment 03 §12.1)', () => {
  const t0 = new Date('2026-10-06T10:00:00Z');

  it('Fehler zählen hoch: erst DEGRADED, ab drei in Folge DOWN; Erfolg setzt zurück auf UP', () => {
    let state = applyHealthOutcome(null, { ok: false, errorClass: 'PROVIDER_ERROR' }, t0);
    expect(state).toMatchObject({ status: 'DEGRADED', consecutiveFailures: 1 });
    state = applyHealthOutcome(state, { ok: false, errorClass: 'PROVIDER_ERROR' }, t0);
    state = applyHealthOutcome(state, { ok: false, errorClass: 'PROVIDER_ERROR' }, t0);
    expect(state).toMatchObject({ status: 'DOWN', consecutiveFailures: 3 });
    state = applyHealthOutcome(state, { ok: true, latencyMs: 400 }, t0);
    expect(state).toMatchObject({ status: 'UP', consecutiveFailures: 0, avgLatencyMs: 400 });
  });

  it('Rate-Limit-Fehler führen zu RATE_LIMITED, nicht zu DOWN', () => {
    let state = applyHealthOutcome(null, { ok: false, errorClass: 'RATE_LIMITED' }, t0);
    for (let i = 0; i < 5; i++) state = applyHealthOutcome(state, { ok: false, errorClass: 'RATE_LIMITED' }, t0);
    expect(state.status).toBe('RATE_LIMITED');
  });

  it('Circuit Breaker: DOWN sperrt, wird nach der Abkühlzeit wieder probiert (half-open)', () => {
    const down = { status: 'DOWN' as const, consecutiveFailures: 3, lastFailureAt: t0 };
    expect(effectiveHealth(down, new Date(t0.getTime() + 1_000))).toBe('DOWN');
    expect(effectiveHealth(down, new Date(t0.getTime() + HEALTH_COOLDOWN_MS))).toBe('UNKNOWN');
    expect(effectiveHealth({ status: 'DISABLED', consecutiveFailures: 0 }, new Date(t0.getTime() + 10 * HEALTH_COOLDOWN_MS))).toBe('DISABLED');
    expect(effectiveHealth(null, t0)).toBe('UNKNOWN');
  });

  it('classifyLlmError ordnet ein und gibt nie den Rohtext zurück', () => {
    expect(classifyLlmError(new Error('429 Too Many Requests'))).toBe('RATE_LIMITED');
    expect(classifyLlmError(new Error('401 Incorrect API key provided: sk-abc'))).toBe('AUTH');
    expect(classifyLlmError(new Error('request timed out'))).toBe('TIMEOUT');
    expect(classifyLlmError(new Error('OpenAI API request failed.'))).toBe('PROVIDER_ERROR');
    expect(classifyLlmError(new Error('OpenAI returned malformed tool arguments.'))).toBe('INVALID_OUTPUT');
    expect(classifyLlmError('boom')).toBe('UNKNOWN');
  });

  it('estimateCost rechnet nur mit bekannten Werten und liefert sonst null', () => {
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, { inputPerMtok: 2, outputPerMtok: 8 })).toBeCloseTo(6);
    expect(estimateCost({ inputTokens: 10, outputTokens: undefined }, { inputPerMtok: 2, outputPerMtok: 8 })).toBeNull();
    expect(estimateCost({ inputTokens: 10, outputTokens: 10 }, { inputPerMtok: null, outputPerMtok: 8 })).toBeNull();
  });
});
