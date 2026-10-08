import { MockLLMProvider, type LLMCompletionRequest, type LLMProvider } from '@orbit/agent-core';
import { AiProviderUnavailableError, type HealthState } from '@orbit/shared';
import type { AiAdapterRegistry } from '../ai-governance/ai-adapter-registry.service';
import { AiAdapterRegistry as AdapterRegistry } from '../ai-governance/ai-adapter-registry.service';
import type { AiCostGuardrailService } from '../ai-governance/ai-cost-guardrail.service';
import type { AiMeterService } from '../ai-governance/ai-meter.service';
import type { AiRegistryService, ModelWithProvider, RoutingSnapshot } from '../ai-governance/ai-registry.service';
import type { PlatformControlService } from '../platform-control/platform-control.service';
import type { PlatformSecretVaultService } from '../ai-governance/platform-secret-vault.service';
import type { CredentialEncryptionService } from '../security/credential-encryption.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AiProviderResolverService } from './ai-provider-resolver.service';

/**
 * Entscheidungslogik der Laufzeit-Auflösung (Amendment 03 §8–§12), ohne Datenbank: Register, Verbindungen und Gesundheit werden als Momentaufnahme
 * vorgegeben, Adapter sind Stubs. Abgedeckt: OAI-01…OAI-10 und OPS-35 (Providerwechsel ohne Businesscode-Änderung).
 */

const REQUEST: LLMCompletionRequest = { messages: [{ role: 'user', content: 'hallo' }], tools: [] };
const ENV = { ORBIT_ENVIRONMENT: 'test', ORBIT_DEFAULT_DATA_REGION: 'EU' } as never;

function stubAdapter(name: string, model: string, behaviour: 'ok' | 'fail-503' | 'fail-429' | 'fail-invalid' = 'ok') {
  const calls: string[] = [];
  const adapter: LLMProvider = {
    providerName: name,
    modelName: model,
    async complete() {
      calls.push(`${name}/${model}`);
      if (behaviour === 'fail-503') throw new Error('OpenAI API request failed. 503 overloaded');
      if (behaviour === 'fail-429') throw new Error('429 Too Many Requests');
      if (behaviour === 'fail-invalid') throw new Error('OpenAI returned malformed tool arguments.');
      return { text: `${name}:${model}`, toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return { adapter, calls };
}

function model(id: string, providerKey: string, overrides: Partial<ModelWithProvider> = {}): ModelWithProvider {
  return {
    id,
    providerKey,
    providerModelId: `${providerKey}-model-${id}`,
    displayName: id,
    lifecycle: 'APPROVED',
    capabilityTags: ['chat'],
    contextLimit: null,
    toolUseSupported: true,
    structuredOutputSupported: true,
    regionAvailability: ['EU'],
    dataPolicyRefs: [],
    costInputPerMtok: null,
    costOutputPerMtok: null,
    costCurrency: 'EUR',
    evaluationStatus: 'PASSED',
    approvedAt: null,
    deprecatedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    provider: { providerKey, displayName: providerKey, adapterKey: `adapter-${providerKey}`, lifecycle: 'ACTIVE', supportedCredentialTypes: [], supportedRegions: ['EU'], supportedCapabilities: [], dataPolicyRefs: [], version: 1, createdAt: new Date(), updatedAt: new Date() },
    ...overrides,
  } as ModelWithProvider;
}

interface Setup {
  killSwitch?: boolean;
  /** Das durchgesetzte Hard-Limit der Kosten-Leitplanken ist erreicht (gilt für plattformfinanzierte Aufrufe). */
  budgetExceeded?: boolean;
  snapshot?: Partial<RoutingSnapshot> & { route?: RoutingSnapshot['route'] };
  tenantConnection?: Record<string, unknown> | null;
  byok?: { providerKnown: boolean; providerActive: boolean; modelsKnown: boolean; modelApproved: boolean };
}

function build(setup: Setup) {
  const platformDefault = new MockLLMProvider();
  const recorded: Array<{ ctx: Record<string, unknown>; ok: boolean }> = [];
  const meter = { record: jest.fn(async (ctx: Record<string, unknown>, outcome: { ok: boolean }) => void recorded.push({ ctx, ok: outcome.ok })) } as unknown as AiMeterService;
  const registry = {
    tenantRegion: () => 'EU',
    routingSnapshot: jest.fn(async () => ({ environment: 'test', profile: null, route: null, models: new Map(), connections: new Map(), health: new Map(), ...setup.snapshot })),
    byokState: jest.fn(async () => setup.byok ?? { providerKnown: false, providerActive: false, modelsKnown: false, modelApproved: false }),
  } as unknown as AiRegistryService;
  const adapters = new AdapterRegistry(ENV) as AiAdapterRegistry;
  const vault = { read: jest.fn(async () => ({ apiKey: 'sk-platform-secret' })) } as unknown as PlatformSecretVaultService;
  const prisma = { forTenantId: () => ({ aIProviderConnection: { findUnique: async () => setup.tenantConnection ?? null } }) } as unknown as PrismaService;
  const encryption = { decrypt: () => 'sk-tenant-key' } as unknown as CredentialEncryptionService;
  const control = { killSwitchEngaged: jest.fn(async () => setup.killSwitch === true) } as unknown as PlatformControlService;
  const costGuard = {
    assertWithinBudget: jest.fn(async () => {
      if (setup.budgetExceeded) throw new AiProviderUnavailableError('Kostenlimit erreicht.', { mode: 'COST_LIMIT', reasons: ['COST_LIMIT_HARD'] });
    }),
  } as unknown as AiCostGuardrailService;
  const service = new AiProviderResolverService(prisma, encryption, registry, adapters, vault, meter, costGuard, control, platformDefault, ENV);
  return { service, adapters, platformDefault, meter, recorded, registry, vault, costGuard };
}

const profile = { id: 'p1', profileKey: 'COMPLEX_REASONING', version: 1, purpose: 'x', requiredCapabilities: ['chat', 'tool_use'], fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK', maxLatencyMs: null, requiredDataPolicyRefs: [], lifecycle: 'PUBLISHED', publishedAt: new Date(), createdByUserId: null, createdAt: new Date() } as unknown as RoutingSnapshot['profile'];
const connection = (providerKey: string, lifecycle = 'ACTIVE') => ({ id: `c-${providerKey}`, providerKey, environment: 'test', regionKey: null, credentialType: 'API_KEY', secretRef: 'env:X_KEY', lifecycle, lastValidatedAt: null, lastHealthStatus: null, allowedProfileKeys: [], version: 1, createdByUserId: null, updatedByUserId: null, createdAt: new Date(), updatedAt: new Date() }) as never;
const route = (overrides: Record<string, unknown> = {}) => ({ id: 'r1', modelProfileKey: 'COMPLEX_REASONING', environment: 'test', tenantScope: null, primaryModelId: 'mA', fallbackModelIds: [], fallbackMode: 'NO_FALLBACK', trafficPercent: 100, active: true, activeFrom: null, activeUntil: null, policyVersion: '1', version: 1, createdByUserId: null, createdAt: new Date(), updatedAt: new Date(), ...overrides }) as never;

function managed(opts: { primary?: ModelWithProvider; fallbacks?: ModelWithProvider[]; routeOverrides?: Record<string, unknown>; health?: Record<string, HealthState>; connections?: Array<ReturnType<typeof connection>> }) {
  const primary = opts.primary ?? model('mA', 'alpha');
  const models = new Map<string, ModelWithProvider>([[primary.id, primary], ...(opts.fallbacks ?? []).map((m) => [m.id, m] as [string, ModelWithProvider])]);
  const conns = opts.connections ?? [...new Set([primary, ...(opts.fallbacks ?? [])].map((m) => m.providerKey))].map((k) => connection(k));
  return {
    snapshot: {
      profile,
      route: route({ primaryModelId: primary.id, fallbackModelIds: (opts.fallbacks ?? []).map((m) => m.id), ...opts.routeOverrides }),
      models,
      connections: new Map(conns.map((c) => [(c as { providerKey: string }).providerKey, c])),
      health: new Map(Object.entries(opts.health ?? {})),
    },
  } as Setup;
}

describe('AiProviderResolverService', () => {
  it('Bootstrap: ohne konfigurierte Route bedient der Umgebungs-Standard (sichtbar als ENV_BOOTSTRAP), der Mock bleibt unverpackt', async () => {
    const { service, platformDefault } = build({});
    const resolved = await service.resolveProfile('t1', 'COMPLEX_REASONING');
    expect(resolved.source).toBe('ENV_BOOTSTRAP');
    expect(resolved.provider).toBe(platformDefault);
    expect(await service.resolveForTenant('t1')).toBe(platformDefault);
  });

  describe('OAI-01/02/OPS-35 – Routen und Providerwechsel ohne Businesscode-Änderung', () => {
    it('OAI-01: eine aktive Route löst das Profil über Adapter, Plattformverbindung und Secret auf', async () => {
      const setup = build(managed({}));
      const a = stubAdapter('alpha', 'm-a');
      setup.adapters.register('adapter-alpha', () => a.adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      expect(resolved).toMatchObject({ source: 'ORBIT_MANAGED', providerKey: 'alpha', routeId: 'r1', degraded: false });
      expect((await resolved.provider.complete(REQUEST)).text).toBe('alpha:m-a');
      expect(setup.vault.read).toHaveBeenCalledWith('env:X_KEY');
    });

    it('OAI-02/OPS-35: dieselbe Aufrufstelle bedient nach Umstellung der Route einen anderen Anbieter – ohne eine Zeile Businesscode', async () => {
      const businessCall = async (service: AiProviderResolverService) => (await (await service.resolveForTenant('t1', 'COMPLEX_REASONING')).complete(REQUEST)).text;
      const before = build(managed({ primary: model('mA', 'alpha') }));
      before.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a').adapter);
      expect(await businessCall(before.service)).toBe('alpha:m-a');

      const after = build(managed({ primary: model('mB', 'beta') }));
      after.adapters.register('adapter-beta', () => stubAdapter('beta', 'm-b').adapter);
      expect(await businessCall(after.service)).toBe('beta:m-b');
    });

    it('Traffic: außerhalb des Anteils/Fensters zählt die Route nicht – Auswahl liegt beim Register (Snapshot), hier: keine Route → Bootstrap', async () => {
      const { service } = build({});
      expect((await service.resolveProfile('t1', 'COMPLEX_REASONING')).source).toBe('ENV_BOOTSTRAP');
    });
  });

  describe('OAI-03/04/10 – nicht freigegeben, Datenrichtlinie, veraltet', () => {
    it('OAI-03: ein nicht freigegebenes Modell wird nicht bedient – Fehler mit Grund, kein stiller Ausweg', async () => {
      const { service } = build(managed({ primary: model('mA', 'alpha', { lifecycle: 'VALIDATING' }) }));
      const error = await service.resolveProfile('t1', 'COMPLEX_REASONING').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiProviderUnavailableError);
      expect((error as AiProviderUnavailableError).details?.reasons).toContain('alpha/alpha-model-mA:MODEL_NOT_APPROVED');
    });

    it('OAI-04: ein gesunder Anbieter, dessen Region/Datenrichtlinie nicht passt, wird nicht gewählt', async () => {
      const { service } = build(managed({ primary: model('mA', 'alpha', { regionAvailability: ['US'] }), health: { 'alpha|*': { status: 'UP', consecutiveFailures: 0 } } }));
      const error = await service.resolveProfile('t1', 'COMPLEX_REASONING').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiProviderUnavailableError);
      expect(JSON.stringify((error as AiProviderUnavailableError).details)).toContain('REGION_NOT_ALLOWED');
    });

    it('OAI-10: ein veralteter Anbieter oder ein pausierter Anbieter bedient keine neuen Aufrufe', async () => {
      const deprecated = model('mA', 'alpha');
      (deprecated.provider as { lifecycle: string }).lifecycle = 'DEPRECATED';
      await expect(build(managed({ primary: deprecated })).service.resolveProfile('t1', 'COMPLEX_REASONING')).rejects.toBeInstanceOf(AiProviderUnavailableError);
    });

    it('eine gesperrte Plattformverbindung (SUSPENDED) und ein nicht veröffentlichtes Profil blockieren ehrlich', async () => {
      await expect(build(managed({ connections: [connection('alpha', 'SUSPENDED')] })).service.resolveProfile('t1', 'COMPLEX_REASONING')).rejects.toBeInstanceOf(AiProviderUnavailableError);
      const noProfile = managed({});
      (noProfile.snapshot as { profile: unknown }).profile = null;
      await expect(build(noProfile).service.resolveProfile('t1', 'COMPLEX_REASONING')).rejects.toMatchObject({ details: { reasons: ['PROFILE_NOT_PUBLISHED'] } });
    });
  });

  describe('OAI-05/06 – Ausfall und Fallback', () => {
    it('OAI-05: Primär ausgefallen, NO_FALLBACK → ehrlicher Fehler, kein anderer Anbieter wird versucht', async () => {
      const setup = build(managed({ fallbacks: [model('mB', 'beta')], routeOverrides: { fallbackMode: 'NO_FALLBACK' } }));
      const a = stubAdapter('alpha', 'm-a', 'fail-503');
      const b = stubAdapter('beta', 'm-b');
      setup.adapters.register('adapter-alpha', () => a.adapter);
      setup.adapters.register('adapter-beta', () => b.adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      await expect(resolved.provider.complete(REQUEST)).rejects.toThrow(/503/);
      expect(b.calls).toEqual([]);
    });

    it('OAI-06: Primär fällt zur Laufzeit aus, zulässiger Fallback übernimmt – und nur der erlaubte', async () => {
      const setup = build(managed({ fallbacks: [model('mB', 'beta')], routeOverrides: { fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK' } }));
      const a = stubAdapter('alpha', 'm-a', 'fail-503');
      const b = stubAdapter('beta', 'm-b');
      setup.adapters.register('adapter-alpha', () => a.adapter);
      setup.adapters.register('adapter-beta', () => b.adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      expect((await resolved.provider.complete(REQUEST)).text).toBe('beta:m-b');
      expect(a.calls).toEqual(['alpha/m-a']);
    });

    it('SAME_PROVIDER_FALLBACK springt nicht zu einem anderen Anbieter', async () => {
      const setup = build(managed({ fallbacks: [model('mB', 'beta')], routeOverrides: { fallbackMode: 'SAME_PROVIDER_FALLBACK' } }));
      const a = stubAdapter('alpha', 'm-a', 'fail-503');
      const b = stubAdapter('beta', 'm-b');
      setup.adapters.register('adapter-alpha', () => a.adapter);
      setup.adapters.register('adapter-beta', () => b.adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      await expect(resolved.provider.complete(REQUEST)).rejects.toThrow();
      expect(b.calls).toEqual([]);
    });

    it('ein fachlicher Fehler (ungültige Ausgabe) löst keinen Anbieterwechsel aus', async () => {
      const setup = build(managed({ fallbacks: [model('mB', 'beta')], routeOverrides: { fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK' } }));
      const a = stubAdapter('alpha', 'm-a', 'fail-invalid');
      const b = stubAdapter('beta', 'm-b');
      setup.adapters.register('adapter-alpha', () => a.adapter);
      setup.adapters.register('adapter-beta', () => b.adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      await expect(resolved.provider.complete(REQUEST)).rejects.toThrow(/malformed/);
      expect(b.calls).toEqual([]);
    });

    it('Health beeinflusst das Routing: DOWN überspringt den Primären schon bei der Auswahl (Circuit Breaker), Fallback wird bedient', async () => {
      const down: HealthState = { status: 'DOWN', consecutiveFailures: 3, lastFailureAt: new Date() };
      const setup = build(managed({ fallbacks: [model('mB', 'beta')], routeOverrides: { fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK' }, health: { 'alpha|*': down } }));
      setup.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a').adapter);
      setup.adapters.register('adapter-beta', () => stubAdapter('beta', 'm-b').adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      expect(resolved).toMatchObject({ providerKey: 'beta', degraded: true });
      const noFallback = build(managed({ health: { 'alpha|*': down } }));
      noFallback.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a').adapter);
      await expect(noFallback.service.resolveProfile('t1', 'COMPLEX_REASONING')).rejects.toBeInstanceOf(AiProviderUnavailableError);
    });
  });

  describe('Kosten-Leitplanken: durchgesetztes Hard-Limit (Amendment 03 §12.3)', () => {
    it('ORBIT Managed: ist das Hard-Limit erreicht, wird der Aufruf ehrlich abgewiesen – der Anbieter wird gar nicht erst angefragt und es wird nichts gemessen', async () => {
      const setup = build({ ...managed({}), budgetExceeded: true });
      const a = stubAdapter('alpha', 'm-a');
      const completeSpy = jest.spyOn(a.adapter, 'complete');
      setup.adapters.register('adapter-alpha', () => a.adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING'); // die Auflösung selbst gelingt …
      const error = await resolved.provider.complete(REQUEST).catch((e: unknown) => e); // … der Aufruf nicht
      expect(error).toBeInstanceOf(AiProviderUnavailableError);
      expect((error as AiProviderUnavailableError).details).toMatchObject({ reasons: ['COST_LIMIT_HARD'] });
      expect(completeSpy).not.toHaveBeenCalled();
      expect(setup.recorded).toHaveLength(0);
    });

    it('Umgebungs-Bootstrap (plattformfinanziert) wird ebenso geprüft; der Mock bleibt unverpackt und unbegrenzt', async () => {
      const bootstrap = build({ budgetExceeded: true });
      expect((await bootstrap.service.resolveProfile('t1', 'COMPLEX_REASONING')).source).toBe('ENV_BOOTSTRAP'); // Mock: keine Wirkung, keine Kosten
      expect(bootstrap.costGuard.assertWithinBudget).not.toHaveBeenCalled();
    });

    it('ist kein Hard-Limit erreicht, läuft der Aufruf ganz normal und gemessen; der Mandant und das Profil werden geprüft', async () => {
      const setup = build(managed({}));
      setup.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a').adapter);
      const resolved = await setup.service.resolveProfile('t7', 'COMPLEX_REASONING');
      expect((await resolved.provider.complete(REQUEST)).text).toBe('alpha:m-a');
      expect(setup.costGuard.assertWithinBudget).toHaveBeenCalledWith('t7', 'COMPLEX_REASONING');
      expect(setup.recorded).toHaveLength(1);
    });

    it('BYOK ist ausgenommen: der Mandant trägt seine Kosten selbst, ein Plattform-Limit darf ihn nicht blockieren', async () => {
      const connected = { providerKey: 'OPENAI', status: 'CONNECTED', encryptedCredentials: Buffer.from('x'), model: 'gpt-x', byokActiveSince: new Date() };
      const setup = build({ tenantConnection: connected, budgetExceeded: true, ...managed({}) });
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      expect(resolved.source).toBe('BYOK');
      expect(setup.costGuard.assertWithinBudget).not.toHaveBeenCalled();
    });
  });

  describe('OAI-07/08 – BYOK ohne stillen Fallback', () => {
    const connected = { providerKey: 'OPENAI', status: 'CONNECTED', encryptedCredentials: Buffer.from('x'), model: 'gpt-x', byokActiveSince: new Date() };

    it('OAI-07: BYOK-Mandant ohne funktionierende Verbindung bekommt einen Fehler – nie den Plattform-Zugang', async () => {
      for (const row of [{ ...connected, status: 'ERROR' }, { ...connected, status: 'DISCONNECTED', encryptedCredentials: null }, { ...connected, encryptedCredentials: null }]) {
        const setup = build({ tenantConnection: row, ...managed({}) });
        setup.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a').adapter);
        const error = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AiProviderUnavailableError);
        expect((error as AiProviderUnavailableError).details).toMatchObject({ mode: 'BYOK', reasons: ['BYOK_CONNECTION_UNAVAILABLE'] });
        expect(setup.registry.routingSnapshot).not.toHaveBeenCalled(); // der Plattformpfad wird gar nicht erst betreten
      }
    });

    it('OAI-08: BYOK bedient ausschließlich den Mandantenschlüssel, nie eine Plattformroute oder einen anderen Anbieter', async () => {
      const setup = build({ tenantConnection: connected, ...managed({}) });
      setup.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a').adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      expect(resolved).toMatchObject({ source: 'BYOK', providerKey: 'openai', modelId: 'gpt-x' });
      expect(setup.registry.routingSnapshot).not.toHaveBeenCalled();
    });

    it('BYOK nur für freigegebene Anbieter/Modelle, sobald das Register gepflegt ist; ohne Register (Bootstrap) gilt keine Einschränkung', async () => {
      const notApproved = build({ tenantConnection: connected, byok: { providerKnown: true, providerActive: true, modelsKnown: true, modelApproved: false } });
      await expect(notApproved.service.resolveProfile('t1', 'AGENT_TOOL_USE')).rejects.toMatchObject({ details: { reasons: ['MODEL_NOT_APPROVED'] } });
      const suspended = build({ tenantConnection: connected, byok: { providerKnown: true, providerActive: false, modelsKnown: true, modelApproved: true } });
      await expect(suspended.service.resolveProfile('t1', 'AGENT_TOOL_USE')).rejects.toMatchObject({ details: { reasons: ['PROVIDER_NOT_ACTIVE'] } });
    });

    it('ein Mandant, der nie erfolgreich BYOK genutzt hat (oder ausdrücklich getrennt hat), läuft über ORBIT Managed/Bootstrap', async () => {
      const never = build({ tenantConnection: { ...connected, byokActiveSince: null, status: 'ERROR' } });
      expect((await never.service.resolveProfile('t1', 'AGENT_TOOL_USE')).source).toBe('ENV_BOOTSTRAP');
    });
  });

  describe('Kill Switch ai.executions (OCF-05)', () => {
    it('stoppt NEUE Aufrufe aller Pfade (Managed, BYOK, Bootstrap) mit ehrlichem Grund – bevor irgendein Adapter gebaut wird', async () => {
      const connected = { providerKey: 'OPENAI', status: 'CONNECTED', encryptedCredentials: Buffer.from('x'), model: 'gpt-x', byokActiveSince: new Date() };
      for (const setup of [{ ...managed({}), killSwitch: true }, { tenantConnection: connected, killSwitch: true }, { killSwitch: true }] as Setup[]) {
        const built = build(setup);
        const error = await built.service.resolveProfile('t1', 'COMPLEX_REASONING').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AiProviderUnavailableError);
        expect((error as AiProviderUnavailableError).details?.reasons).toEqual(['KILL_SWITCH:ai.executions']);
        expect(built.registry.routingSnapshot).not.toHaveBeenCalled();
      }
    });
  });

  describe('Messung', () => {
    it('jeder Aufruf erzeugt einen Nutzungseintrag mit Profil, Anbieter, Modell, Route und Quelle – ohne Inhalt', async () => {
      const setup = build(managed({}));
      setup.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a').adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      await resolved.provider.complete(REQUEST);
      expect(setup.recorded).toHaveLength(1);
      expect(setup.recorded[0]).toMatchObject({ ok: true, ctx: { tenantId: 't1', profileKey: 'COMPLEX_REASONING', providerKey: 'alpha', routeId: 'r1', source: 'ORBIT_MANAGED', trackHealth: true } });
      expect(JSON.stringify(setup.recorded)).not.toContain('hallo');
    });

    it('ein Fehler wird gemessen und unverändert weitergereicht', async () => {
      const setup = build(managed({}));
      setup.adapters.register('adapter-alpha', () => stubAdapter('alpha', 'm-a', 'fail-429').adapter);
      const resolved = await setup.service.resolveProfile('t1', 'COMPLEX_REASONING');
      await expect(resolved.provider.complete(REQUEST)).rejects.toThrow(/429/);
      expect(setup.recorded[0]).toMatchObject({ ok: false });
    });
  });
});
