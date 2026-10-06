import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider, type LLMCompletionRequest } from '@orbit/agent-core';
import { AiProviderUnavailableError, PLATFORM_ROLES, type PlatformRole } from '@orbit/shared';
import request from 'supertest';
import { AiAdapterRegistry } from '../src/ai-governance/ai-adapter-registry.service';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Phase OPS-2 — AI Platform Governance gegen die echte Datenbank (RLS): Register, Profile (unveränderlich), Routen (Aktivierungsvorbedingungen,
 * Vorschau, Konkurrenz), Plattformverbindungen (Secrets nie ausgegeben), Auflösung durch den echten Resolver (OAI-01…10, OPS-35), Nutzung.
 */
describe('Platform AI governance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const platformUsers: string[] = [];
  const tenants: string[] = [];
  const secretEnv = `ORBIT_E2E_SECRET_${suffix.toUpperCase()}`;
  let owner: { id: string; token: string };
  let finops: { id: string; token: string };
  let support: { id: string; token: string };
  const keys = { alpha: `e2e-alpha-${suffix}`, beta: `e2e-beta-${suffix}` };
  const profileKey = `E2E_PROFILE_${suffix.toUpperCase()}`;
  const environment = 'development';
  const REQUEST: LLMCompletionRequest = { messages: [{ role: 'user', content: 'hallo' }], tools: [] };

  const call = (method: 'get' | 'post', path: string, token: string) => request(app.getHttpServer())[method](`/api/v1/platform/ai${path}`).set({ Authorization: `Bearer ${token}` });

  async function identity(role: PlatformRole, tag: string) {
    const email = `ops2-${suffix}-${tag}@platform-test.example`;
    const created = await app.get(PlatformIdentityService).create(null, { email, displayName: tag, password, roles: [role] });
    platformUsers.push(created.id);
    const login = await app.get(PlatformAuthService).login(email, password);
    return { id: created.id, token: login.accessToken };
  }

  async function stepUp(token: string): Promise<void> {
    await request(app.getHttpServer()).post('/api/v1/platform/auth/step-up').set({ Authorization: `Bearer ${token}` }).send({ password }).expect(200);
  }

  async function bootstrapTenant(label: string): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    const email = `admin-${id}@e2e-${label}.example`;
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `AI ${label} ${id.slice(0, 6)}`, slug: `e2e-ai-${label}-${id}`, adminEmail: email, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'B' } as never);
    tenants.push(tenant.id);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Musterwerk#2026!' });
    return { id: tenant.id, token: login.body.accessToken as string };
  }

  const adapter = (name: string, model: string, fail = false) => ({
    providerName: name,
    modelName: model,
    async complete() {
      if (fail) throw new Error('OpenAI API request failed. 503 overloaded');
      return { text: `${name}:${model}`, toolCalls: [], stopReason: 'end_turn' as const, usage: { inputTokens: 12, outputTokens: 7 } };
    },
  });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    process.env[secretEnv] = 'sk-test-env-secret-value';
    owner = await identity(PLATFORM_ROLES.PLATFORM_OWNER, 'owner');
    finops = await identity(PLATFORM_ROLES.PLATFORM_FINOPS, 'finops');
    support = await identity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support');
    const adapters = app.get(AiAdapterRegistry);
    adapters.register(`adapter-${keys.alpha}`, ({ providerModelId }) => adapter('alpha', providerModelId));
    adapters.register(`adapter-${keys.beta}`, ({ providerModelId }) => adapter('beta', providerModelId));
    await stepUp(owner.token);
  });

  afterAll(async () => {
    await prisma.withPlatformScope(async (tx) => {
      await tx.aIProviderRoute.deleteMany({ where: { modelProfileKey: profileKey } });
      await tx.platformAIConnection.deleteMany({ where: { providerKey: { in: Object.values(keys) } } });
      await tx.aIModelDefinition.deleteMany({ where: { providerKey: { in: Object.values(keys) } } });
      await tx.aIProviderDefinition.deleteMany({ where: { providerKey: { in: Object.values(keys) } } });
      await tx.aIProviderHealth.deleteMany({ where: { providerKey: { in: Object.values(keys) } } });
      await tx.platformUser.deleteMany({ where: { id: { in: platformUsers } } });
    });
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    delete process.env[secretEnv];
    await app.close();
  });

  const ids: Record<string, string> = {};

  describe('Rollen und Zugriff', () => {
    it('Mandantennutzer erreichen /platform/ai nie; FinOps liest Nutzung, aber schreibt nichts; Support liest nur', async () => {
      const tenant = await bootstrapTenant('role');
      expect([401, 403]).toContain((await call('get', '/overview', tenant.token)).status);
      await call('get', '/usage', finops.token).expect(200);
      await call('get', '/usage', support.token).expect(403);
      await call('get', '/overview', support.token).expect(200);
      await call('post', '/providers', finops.token).send({ providerKey: keys.alpha, displayName: 'x', adapterKey: `adapter-${keys.alpha}` }).expect(403);
      await call('post', '/providers', support.token).send({ providerKey: keys.alpha, displayName: 'x', adapterKey: `adapter-${keys.alpha}` }).expect(403);
    });
  });

  describe('Register und Profile', () => {
    it('Anbieter nur mit im Code vorhandenem Adapter; zwei Anbieter + je ein Modell werden angelegt und freigegeben (Evaluation vor Freigabe)', async () => {
      await call('post', '/providers', owner.token).send({ providerKey: keys.alpha, displayName: 'Alpha', adapterKey: 'does-not-exist' }).expect(400);
      for (const key of [keys.alpha, keys.beta]) {
        const res = await call('post', '/providers', owner.token).send({ providerKey: key, displayName: key, adapterKey: `adapter-${key}`, supportedRegions: ['EU'] }).expect(201);
        ids[`provider-${key}`] = String(res.body.version);
        await call('post', `/providers/${key}/transition`, owner.token).send({ to: 'ACTIVE', expectedVersion: res.body.version, reason: 'Test-Freigabe' }).expect(200);
        const model = await call('post', '/models', owner.token).send({ providerKey: key, providerModelId: `${key}-m1`, displayName: 'M1', toolUseSupported: true, structuredOutputSupported: true, capabilityTags: ['chat'], regionAvailability: ['EU'], costInputPerMtok: 2, costOutputPerMtok: 8 }).expect(201);
        ids[key] = model.body.id;
        expect(typeof model.body.costInputPerMtok).toBe('number');
        // OAI-03: Freigabe ohne bestandene Evaluation wird verweigert
        await call('post', `/models/${model.body.id}/transition`, owner.token).send({ to: 'APPROVED', expectedVersion: model.body.version, reason: 'zu früh' }).expect(400);
        const evaluated = await call('post', `/models/${model.body.id}/evaluation`, owner.token).send({ result: 'PASSED', expectedVersion: model.body.version, note: 'Evaluationskatalog bestanden (Test)' }).expect(200);
        const approved = await call('post', `/models/${model.body.id}/transition`, owner.token).send({ to: 'APPROVED', expectedVersion: evaluated.body.version, reason: 'Freigabe nach Evaluation' }).expect(200);
        expect(approved.body.lifecycle).toBe('APPROVED');
      }
    });

    it('Konkurrenz (OPS-28): eine veraltete Version überschreibt nichts – 409', async () => {
      const stale = await call('post', `/models/${ids[keys.alpha]}/evaluation`, owner.token).send({ result: 'PASSED', expectedVersion: 1, note: 'veraltete Ansicht' });
      expect(stale.status).toBe(409);
    });

    it('Profile: veröffentlichte Version ist unveränderlich (auch per SQL), eine Änderung ist eine neue Version', async () => {
      const draft = await call('post', '/model-profiles', owner.token).send({ profileKey, purpose: 'E2E-Testprofil für Routing', requiredCapabilities: ['chat', 'tool_use'], fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK' }).expect(201);
      expect(draft.body.version).toBe(1);
      await call('post', `/model-profiles/${profileKey}/versions/1/publish`, owner.token).send({ reason: 'Veröffentlichung (Test)' }).expect(200);
      await call('post', `/model-profiles/${profileKey}/versions/1/publish`, owner.token).send({ reason: 'zweites Mal' }).expect(409);
      await expect(prisma.withPlatformScope((tx) => tx.aIModelProfile.updateMany({ where: { profileKey, version: 1 }, data: { purpose: 'manipuliert' } }))).rejects.toThrow(/immutable/i);
      await expect(prisma.withPlatformScope((tx) => tx.aIModelProfile.deleteMany({ where: { profileKey, version: 1 } }))).rejects.toThrow(/cannot be deleted|immutable/i);
      const v2 = await call('post', '/model-profiles', owner.token).send({ profileKey, purpose: 'E2E-Testprofil v2', requiredCapabilities: ['chat', 'tool_use'] }).expect(201);
      expect(v2.body.version).toBe(2);
    });
  });

  describe('Verbindungen und Secrets (OAI-09)', () => {
    it('ein gespeichertes Secret wird nie ausgegeben – weder in der Antwort, noch in Listen, noch im Audit', async () => {
      const secret = 'sk-live-this-must-never-come-back-1234567890';
      const created = await call('post', '/connections', owner.token).send({ providerKey: keys.alpha, environment, secretValue: secret, allowedProfileKeys: [] }).expect(201);
      ids.connectionAlpha = created.body.id;
      expect(JSON.stringify(created.body)).not.toContain(secret);
      expect(created.body.secretRef).toBe('vault:••••••••');
      const list = await call('get', '/connections', owner.token).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(secret);
      const row = list.body.find((c: { id: string }) => c.id === ids.connectionAlpha);
      expect(row.secret).toMatchObject({ kind: 'vault', configured: true, version: 1 });

      const audit = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', entityId: ids.connectionAlpha } }));
      expect(audit.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit.map((a) => a.payload))).not.toContain(secret);
      // in der Datenbank liegt nur Chiffrat
      const stored = await prisma.withPlatformScope((tx) => tx.platformSecret.findMany());
      expect(stored.every((s) => !Buffer.from(s.encryptedValue).toString('utf8').includes(secret))).toBe(true);
    });

    it('Rotation: neues Secret, Version +1, Referenz bleibt; Verbindung muss neu validiert werden; veraltete Version → 409', async () => {
      const current = (await call('get', '/connections', owner.token)).body.find((c: { id: string }) => c.id === ids.connectionAlpha);
      const rotated = await call('post', `/connections/${ids.connectionAlpha}/rotate-secret`, owner.token).send({ secretValue: 'sk-live-rotated-value-abcdef123456', expectedVersion: current.version, reason: 'Rotation (Test)' }).expect(200);
      expect(rotated.body.lifecycle).toBe('CONFIGURING');
      const after = (await call('get', '/connections', owner.token)).body.find((c: { id: string }) => c.id === ids.connectionAlpha);
      expect(after.secret.version).toBe(2);
      expect(JSON.stringify(after)).not.toContain('sk-live-rotated');
      await call('post', `/connections/${ids.connectionAlpha}/rotate-secret`, owner.token).send({ secretValue: 'sk-live-stale-attempt-xxxxxxxx', expectedVersion: current.version, reason: 'veraltet' }).expect(409);
    });

    it('nur env:NAME-Referenzen sind als Referenz zulässig; Secret und Referenz zugleich ist ein Fehler; Secrets setzen verlangt den Secret-Scope', async () => {
      await call('post', '/connections', owner.token).send({ providerKey: keys.beta, environment, secretRef: 'vault:abc' }).expect(400);
      await call('post', '/connections', owner.token).send({ providerKey: keys.beta, environment, secretRef: `env:${secretEnv}`, secretValue: 'sk-both-12345678' }).expect(400);
      await call('post', '/connections', finops.token).send({ providerKey: keys.beta, environment, secretRef: `env:${secretEnv}` }).expect(403);
      const ok = await call('post', '/connections', owner.token).send({ providerKey: keys.beta, environment, secretRef: `env:${secretEnv}` }).expect(201);
      ids.connectionBeta = ok.body.id;
      // Konfiguration doppelt anlegen → 409
      await call('post', '/connections', owner.token).send({ providerKey: keys.beta, environment, secretRef: `env:${secretEnv}` }).expect(409);
    });

    it('Validierung: ein Adapter ohne eigene Prüfung gilt als erreichbar, die Verbindung wird ACTIVE (die echte Anbieterprüfung ist mit Provider-Zugangsdaten nur live nachweisbar)', async () => {
      for (const id of [ids.connectionAlpha, ids.connectionBeta]) {
        const res = await call('post', `/connections/${id}/validate`, owner.token).expect(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.connection.lifecycle).toBe('ACTIVE');
      }
    });
  });

  describe('Routen: Vorbedingungen, Vorschau, Aktivierung, Auflösung (OAI-01/02/03/05/06, OPS-35)', () => {
    let alphaRoute: { id: string; version: number };
    let betaRoute: { id: string; version: number };

    it('Route anlegen → Vorschau nennt Vorbedingungen und betroffene Mandanten; eine nicht freigegebene Route lässt sich nicht aktivieren', async () => {
      const created = await call('post', '/routes', owner.token).send({ modelProfileKey: profileKey, environment, primaryModelId: ids[keys.alpha], fallbackMode: 'NO_FALLBACK' }).expect(201);
      alphaRoute = created.body;
      const preview = await call('get', `/routes/${alphaRoute.id}/activation-preview`, owner.token).expect(200);
      expect(preview.body.activatable).toBe(true);
      expect(preview.body.affectedTenants).toBeGreaterThan(0);

      // Primärmodell ohne Freigabe → verweigert (OAI-03)
      const unapproved = await call('post', '/models', owner.token).send({ providerKey: keys.alpha, providerModelId: `${keys.alpha}-unapproved`, displayName: 'U', toolUseSupported: true, regionAvailability: ['EU'] }).expect(201);
      const bad = await call('post', '/routes', owner.token).send({ modelProfileKey: profileKey, environment, primaryModelId: unapproved.body.id }).expect(201);
      const refused = await call('post', `/routes/${bad.body.id}/activate`, owner.token).send({ expectedVersion: bad.body.version, reason: 'sollte scheitern' }).expect(400);
      const codes = (refused.body.details.issues as Array<{ code: string }>).map((i) => i.code);
      expect(codes).toEqual(expect.arrayContaining(['PRIMARY:MODEL_NOT_APPROVED', 'PRIMARY:EVALUATION_NOT_PASSED']));
      expect(refused.body.details.issues[0].message.length).toBeGreaterThan(5);
    });

    it('OAI-01: aktive Route → der echte Resolver bedient das Profil über Adapter und Plattformverbindung; Nutzung wird gemessen', async () => {
      await call('post', `/routes/${alphaRoute.id}/activate`, owner.token).send({ expectedVersion: alphaRoute.version, reason: 'Aktivierung Alpha (Test)' }).expect(200);
      const tenant = await bootstrapTenant('route');
      const resolver = app.get(AiProviderResolverService);
      const resolved = await resolver.resolveProfile(tenant.id, profileKey as never);
      expect(resolved).toMatchObject({ source: 'ORBIT_MANAGED', providerKey: keys.alpha, degraded: false });
      expect((await resolved.provider.complete(REQUEST)).text).toBe(`alpha:${keys.alpha}-m1`);

      const usage = await prisma.forTenantId(tenant.id).aIUsageRecord.findMany();
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ profileKey, providerKey: keys.alpha, source: 'ORBIT_MANAGED', status: 'OK', inputTokens: 12, outputTokens: 7 });
      expect(Number(usage[0].estimatedCost)).toBeCloseTo((12 * 2 + 7 * 8) / 1_000_000, 8);
      ids.usageTenant = tenant.id;

      // Mandant B sieht die Nutzung von Mandant A nie
      const other = await bootstrapTenant('route-other');
      expect(await prisma.forTenantId(other.id).aIUsageRecord.findMany()).toEqual([]);
    });

    it('OAI-02/OPS-35: Providerwechsel über die Route (Plattformbetrieb) – dieselbe Aufrufstelle bedient danach Beta, Businesscode unverändert; die abgelöste Route ist inaktiv', async () => {
      const created = await call('post', '/routes', owner.token).send({ modelProfileKey: profileKey, environment, primaryModelId: ids[keys.beta], fallbackMode: 'NO_FALLBACK' }).expect(201);
      betaRoute = created.body;
      const preview = await call('get', `/routes/${betaRoute.id}/activation-preview`, owner.token).expect(200);
      expect(preview.body.replaces).toMatchObject({ routeId: alphaRoute.id });
      const activated = await call('post', `/routes/${betaRoute.id}/activate`, owner.token).send({ expectedVersion: betaRoute.version, reason: 'Providerwechsel Alpha → Beta (Test)' }).expect(200);
      expect(activated.body.route.active).toBe(true);

      const businessCall = async (tenantId: string) => (await (await app.get(AiProviderResolverService).resolveForTenant(tenantId, profileKey as never)).complete(REQUEST)).text;
      expect(await businessCall(ids.usageTenant)).toBe(`beta:${keys.beta}-m1`);
      const alpha = await prisma.withPlatformScope((tx) => tx.aIProviderRoute.findUniqueOrThrow({ where: { id: alphaRoute.id } }));
      expect(alpha.active).toBe(false);

      // Audit mit Vorher/Nachher (OAS-01)
      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_AI_ROUTE_CHANGED', entityId: betaRoute.id } }));
      const payload = rows.find((r) => JSON.stringify(r.payload).includes('Providerwechsel'))?.payload as { before: { active: boolean }; after: { active: boolean }; beforeHash: string; afterHash: string };
      expect(payload.before.active).toBe(false);
      expect(payload.after.active).toBe(true);
      expect(payload.beforeHash).not.toBe(payload.afterHash);
    });

    it('zwei Platform-Admins ändern dieselbe Route gleichzeitig: genau einer gewinnt, der andere bekommt 409', async () => {
      const route = (await call('post', '/routes', owner.token).send({ modelProfileKey: profileKey, environment, tenantScope: ids.usageTenant, primaryModelId: ids[keys.alpha] }).expect(201)).body;
      const results = await Promise.all([
        call('post', `/routes/${route.id}/activate`, owner.token).send({ expectedVersion: route.version, reason: 'Admin 1 aktiviert' }),
        call('post', `/routes/${route.id}/activate`, owner.token).send({ expectedVersion: route.version, reason: 'Admin 2 aktiviert' }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses[0]).toBe(200);
      expect([409, 500]).toContain(statuses[1]);
      expect(statuses[1]).not.toBe(200);
      // Mandanten-Override gilt für diesen Mandanten, nicht für andere
      const resolver = app.get(AiProviderResolverService);
      expect((await resolver.resolveProfile(ids.usageTenant, profileKey as never)).providerKey).toBe(keys.alpha);
      const other = await bootstrapTenant('override-other');
      expect((await resolver.resolveProfile(other.id, profileKey as never)).providerKey).toBe(keys.beta);
      await call('post', `/routes/${route.id}/deactivate`, owner.token).send({ expectedVersion: 2, reason: 'Override beendet' }).expect(200);
    });

    it('OAI-05/06 mit echter Datenbank: Notbremse ohne Fallback → ehrlicher Fehler; mit freigegebenem Fallback → nur der erlaubte Anbieter', async () => {
      const resolver = app.get(AiProviderResolverService);
      // aktive Route ist Beta ohne Fallback
      await call('post', `/providers/${keys.beta}/disable`, owner.token).send({ disabled: true, reason: 'Störung beim Anbieter (Test)' }).expect(200);
      const error = await resolver.resolveProfile(ids.usageTenant, profileKey as never).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiProviderUnavailableError);
      expect(JSON.stringify((error as AiProviderUnavailableError).details)).toContain('HEALTH_DISABLED');

      // Eine Route mit deaktiviertem Primärmodell lässt sich nicht aktivieren (Vorbedingung Gesundheit) – erst nach Aufhebung.
      const withFallback = (await call('post', '/routes', owner.token).send({ modelProfileKey: profileKey, environment, primaryModelId: ids[keys.beta], fallbackModelIds: [ids[keys.alpha]], fallbackMode: 'APPROVED_CROSS_PROVIDER_FALLBACK' }).expect(201)).body;
      const refused = await call('post', `/routes/${withFallback.id}/activate`, owner.token).send({ expectedVersion: withFallback.version, reason: 'sollte an der Gesundheit scheitern' }).expect(400);
      expect(JSON.stringify(refused.body.details.issues)).toContain('HEALTH_DISABLED');

      await call('post', `/providers/${keys.beta}/disable`, owner.token).send({ disabled: false, reason: 'Störung behoben (Test)' }).expect(200);
      await call('post', `/routes/${withFallback.id}/activate`, owner.token).send({ expectedVersion: withFallback.version, reason: 'Fallback-Route (Test)' }).expect(200);
      expect((await resolver.resolveProfile(ids.usageTenant, profileKey as never)).providerKey).toBe(keys.beta);

      // Primär fällt erneut aus → der freigegebene Fallback (Alpha) übernimmt, gekennzeichnet als eingeschränkt
      await call('post', `/providers/${keys.beta}/disable`, owner.token).send({ disabled: true, reason: 'erneute Störung (Test)' }).expect(200);
      const resolved = await resolver.resolveProfile(ids.usageTenant, profileKey as never);
      expect(resolved).toMatchObject({ providerKey: keys.alpha, degraded: true });
      expect((await resolved.provider.complete(REQUEST)).text).toBe(`alpha:${keys.alpha}-m1`);
      await call('post', `/providers/${keys.beta}/disable`, owner.token).send({ disabled: false, reason: 'Störung behoben (Test)' }).expect(200);
    });

    it('OAI-10: ein veralteter (deprecated) Anbieter bedient keine neuen Aufrufe, auch nicht über eine bestehende Route', async () => {
      const provider = (await call('get', '/providers', owner.token)).body.find((p: { providerKey: string }) => p.providerKey === keys.beta);
      await call('post', `/providers/${keys.beta}/transition`, owner.token).send({ to: 'DEPRECATED', expectedVersion: provider.version, reason: 'Anbieter wird abgelöst (Test)' }).expect(200);
      const resolved = await app.get(AiProviderResolverService).resolveProfile(ids.usageTenant, profileKey as never);
      expect(resolved.providerKey).toBe(keys.alpha); // Fallback der aktiven Route, Beta wird nicht mehr bedient
      expect(resolved.degraded).toBe(true);
    });
  });

  describe('Nutzung und Isolation', () => {
    it('FinOps sieht aggregierte Nutzung je Profil/Anbieter – ohne Prompt-/Antwortinhalt', async () => {
      const byProfile = await call('get', '/usage?groupBy=profileKey', finops.token).expect(200);
      const row = byProfile.body.find((r: { key: string }) => r.key === profileKey);
      expect(row.requests).toBeGreaterThan(0);
      expect(row.inputTokens).toBeGreaterThan(0);
      expect(JSON.stringify(byProfile.body)).not.toContain('hallo');
      const byProvider = await call('get', '/usage?groupBy=providerKey', finops.token).expect(200);
      expect(byProvider.body.some((r: { key: string }) => r.key === keys.alpha)).toBe(true);
    });

    it('Plattformregister sind für Mandantencode unsichtbar (RLS)', async () => {
      expect(await prisma.aIProviderDefinition.findMany()).toEqual([]);
      expect(await prisma.platformAIConnection.findMany()).toEqual([]);
      expect(await prisma.withRlsBypass((tx) => tx.aIModelProfile.findMany())).toEqual([]);
      expect(await prisma.platformSecret.findMany()).toEqual([]);
    });
  });

  describe('Mandanten-BYOK: kein stiller Fallback (OAI-07/OPS-10)', () => {
    it('ein BYOK-Mandant, dessen Schlüssel ausfällt, bekommt einen Fehler statt der Plattform; nach ausdrücklichem Trennen läuft er wieder über ORBIT Managed', async () => {
      const tenant = await bootstrapTenant('byok');
      const encrypted = new Uint8Array(Buffer.from('cipher'));
      await prisma.forTenantId(tenant.id).aIProviderConnection.create({ data: { tenantId: tenant.id, providerKey: 'OPENAI', status: 'ERROR', encryptedCredentials: encrypted, model: 'gpt-x', byokActiveSince: new Date() } });
      const resolver = app.get(AiProviderResolverService);
      await expect(resolver.resolveProfile(tenant.id, 'AGENT_TOOL_USE')).rejects.toBeInstanceOf(AiProviderUnavailableError);

      const status = await request(app.getHttpServer()).get('/api/v1/ai-providers/status').set({ Authorization: `Bearer ${tenant.token}` });
      expect(status.status).toBe(200);
      expect(status.body.mode).toBe('TENANT_MANAGED');
      expect(status.body.runtime.health.state).toBe('ERROR');

      await request(app.getHttpServer()).delete('/api/v1/ai-providers').set({ Authorization: `Bearer ${tenant.token}` });
      const after = await resolver.resolveProfile(tenant.id, 'AGENT_TOOL_USE');
      expect(after.source).toBe('ENV_BOOTSTRAP');
      expect(after.provider).toBeInstanceOf(MockLLMProvider);
    });
  });
});
