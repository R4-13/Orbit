import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { OrbitEnv } from '@orbit/config';
import { AiProviderUnavailableError, PLATFORM_ROLES, assessRuntime, type PlatformRole } from '@orbit/shared';
import type Redis from 'ioredis';
import request from 'supertest';
import { AiCostGuardrailService } from '../src/ai-governance/ai-cost-guardrail.service';
import { ORBIT_ENV } from '../src/config/env.token';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PlatformRuntimeMonitorService } from '../src/platform/runtime/platform-runtime-monitor.service';
import { PlatformRuntimeService } from '../src/platform/runtime/platform-runtime.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WORKFLOW_RUNS_QUEUE } from '../src/queue/queue.tokens';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Kosten-Leitplanken (Amendment 03 §12.3) gegen die echte Datenbank: Verwaltung (Version, Step-up, Audit), Bewertung auf den echten Messwerten des Monats,
 * Durchsetzung des Hard-Limits als ehrlicher Block (nur wenn ausdrücklich durchgesetzt, nie für BYOK) und Alarme (Audit + Webhook) bei Wechsel und bei
 * ungewöhnlicher Nutzung. Alle Aussagen betreffen nur die im Test angelegten Mandanten und Profile – die Entwicklungsdatenbank kann weitere Daten enthalten.
 */
describe('Platform AI cost guardrails (e2e)', () => {
  const LEADER_KEY = 'orbit:platform:runtime-monitor:leader';
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const profile = `E2E_COST_${suffix.toUpperCase()}`;
  const platformUsers: string[] = [];
  const tenants: string[] = [];
  const limitIds: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let guard: AiCostGuardrailService;
  let owner: string;
  let finops: string;
  let support: string;
  let tenantA: string;
  let tenantB: string;

  const call = (method: 'get' | 'put' | 'post', path: string, token: string) => request(app.getHttpServer())[method](`/api/v1/platform/ai${path}`).set({ Authorization: `Bearer ${token}` });
  const auth = () => app.get(PlatformAuthService);

  async function identity(role: PlatformRole, tag: string): Promise<string> {
    const email = `cg-${suffix}-${tag}@platform-test.example`;
    platformUsers.push((await app.get(PlatformIdentityService).create(null, { email, displayName: tag, password, roles: [role] })).id);
    return (await auth().login(email, password)).accessToken;
  }
  const stepUp = async (token: string) => void (await auth().stepUp(await auth().authenticate(token), password));

  async function bootstrapTenant(label: string): Promise<string> {
    const id = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `CG ${label} ${id.slice(0, 6)}`, slug: `e2e-cg-${label}-${id}`, adminEmail: `admin-${id}@e2e-cg.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'C', adminLastName: 'G' });
    tenants.push(tenant.id);
    return tenant.id;
  }

  /** Eine Nutzungszeile (wie sie die Messung schreibt); `cost: null` = Aufruf ohne Kostenprofil. */
  async function usage(tenantId: string, over: { cost: number | null; source?: string; currency?: string; at?: Date; profileKey?: string }): Promise<void> {
    await prisma.forTenantId(tenantId).aIUsageRecord.create({
      data: { tenantId, profileKey: over.profileKey ?? 'FAST_CLASSIFICATION', providerKey: 'e2e', environment: 'test', source: over.source ?? 'ORBIT_MANAGED', status: 'OK', estimatedCost: over.cost, costCurrency: over.cost === null ? null : (over.currency ?? 'USD'), createdAt: over.at ?? new Date() },
    });
  }

  const body = (over: Record<string, unknown> = {}) => ({ scope: 'TENANT', targetTenantId: tenantA, warnAmount: 5, softAmount: 10, hardAmount: 20, hardEnforced: false, reason: 'E2E: Limit setzen', ...over });
  const evaluate = async (id: string) => (await guard.list()).find((l) => l.id === id)!;
  const events = (extraWhere: Record<string, unknown> = {}) => prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_COST_ALERT', ...extraWhere }, orderBy: { createdAt: 'asc' } }));
  const extraOf = (row: { payload: unknown }) => (row.payload as { extra: Record<string, unknown> }).extra;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    guard = app.get(AiCostGuardrailService);
    owner = await identity(PLATFORM_ROLES.PLATFORM_OWNER, 'owner');
    finops = await identity(PLATFORM_ROLES.PLATFORM_FINOPS, 'finops');
    support = await identity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support');
    tenantA = await bootstrapTenant('a');
    tenantB = await bootstrapTenant('b');
    await stepUp(owner);
  });

  afterAll(async () => {
    await prisma.withPlatformScope((tx) => tx.aICostLimit.deleteMany({ where: { id: { in: limitIds } } }));
    await prisma.withPlatformScope((tx) => tx.platformUser.deleteMany({ where: { id: { in: platformUsers } } }));
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    await app.close();
  });

  describe('Verwaltung', () => {
    it('Anlegen, Ändern und Entfernen: Schwellen werden geprüft, Änderungen sind versioniert, begründet und mit Vorher/Nachher im Audit; FinOps liest, schreibt aber nicht; Support sieht nichts', async () => {
      await call('put', '/cost-limits', owner).send(body({ warnAmount: 10, softAmount: 10 })).expect(400); // nicht aufsteigend
      await call('put', '/cost-limits', owner).send(body({ hardEnforced: true, hardAmount: undefined })).expect(400); // Durchsetzung braucht ein Hard-Limit
      await call('put', '/cost-limits', owner).send(body({ scope: 'TENANT', targetTenantId: undefined })).expect(400); // Mandant fehlt
      await call('put', '/cost-limits', owner).send(body({ targetTenantId: randomUUID() })).expect(404); // unbekannter Mandant
      await call('put', '/cost-limits', owner).send(body({ reason: 'x' })).expect(400); // Begründung ist Pflicht

      const created = (await call('put', '/cost-limits', owner).send(body()).expect(200)).body as { id: string; version: number; warnAmount: number };
      limitIds.push(created.id);
      expect(created).toMatchObject({ version: 1, warnAmount: 5, softAmount: 10, hardAmount: 20, hardEnforced: false, scope: 'TENANT', targetTenantId: tenantA });

      // Ändern braucht die aktuelle Version (kein stilles Überschreiben).
      await call('put', '/cost-limits', owner).send(body({ softAmount: 12 })).expect(409);
      await call('put', '/cost-limits', owner).send(body({ softAmount: 12, expectedVersion: 7 })).expect(409);
      const updated = (await call('put', '/cost-limits', owner).send(body({ softAmount: 12, expectedVersion: 1, reason: 'E2E: Soft-Limit anheben' })).expect(200)).body as { version: number; softAmount: number };
      expect(updated).toMatchObject({ version: 2, softAmount: 12 });

      // Rechte: FinOps liest, schreibt nicht; Support hat keinen Kostenzugriff.
      const listed = (await call('get', '/cost-limits', finops).expect(200)).body as Array<{ id: string }>;
      expect(listed.some((l) => l.id === created.id)).toBe(true);
      await call('put', '/cost-limits', finops).send(body({ expectedVersion: 2 })).expect(403);
      await call('get', '/cost-limits', support).expect(403);
      await call('get', '/cost-anomalies', support).expect(403);

      // Schreiben verlangt Step-up: ohne ein frisches Fenster wird abgewiesen.
      const fresh = await identity(PLATFORM_ROLES.PLATFORM_OWNER, 'owner2');
      await call('put', '/cost-limits', fresh).send(body({ expectedVersion: 2 })).expect(403);

      const audit = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_AI_COST_LIMIT_CHANGED', entityId: created.id }, orderBy: { createdAt: 'asc' } }));
      expect(audit).toHaveLength(2);
      const change = audit[1]!.payload as { reason: string; before: { softAmount: number }; after: { softAmount: number } };
      expect(change).toMatchObject({ reason: 'E2E: Soft-Limit anheben', before: { softAmount: 10 }, after: { softAmount: 12 } });

      // Entfernen mit falscher Version scheitert; mit richtiger gelingt und ist auditiert.
      await call('post', `/cost-limits/${created.id}/remove`, owner).send({ expectedVersion: 1, reason: 'E2E: entfernen' }).expect(409);
      await call('post', `/cost-limits/${created.id}/remove`, owner).send({ expectedVersion: 2, reason: 'E2E: entfernen' }).expect(200);
      expect((await call('get', '/cost-limits', owner).expect(200)).body.some((l: { id: string }) => l.id === created.id)).toBe(false);
      expect(await prisma.withPlatformScope((tx) => tx.auditLog.count({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_AI_COST_LIMIT_CHANGED', entityId: created.id } }))).toBe(3);
    });

    it('höchstens ein Limit je Bereich: dasselbe Ziel ist ein Update, nie ein Duplikat', async () => {
      const first = (await call('put', '/cost-limits', owner).send(body({ scope: 'PROFILE', targetTenantId: undefined, profileKey: profile })).expect(200)).body as { id: string; version: number };
      limitIds.push(first.id);
      await call('put', '/cost-limits', owner).send(body({ scope: 'PROFILE', targetTenantId: undefined, profileKey: profile })).expect(409); // existiert: Version nötig
      const again = (await call('put', '/cost-limits', owner).send(body({ scope: 'PROFILE', targetTenantId: undefined, profileKey: profile, expectedVersion: first.version, softAmount: 11 })).expect(200)).body as { id: string };
      expect(again.id).toBe(first.id);
      expect(await prisma.withPlatformScope((tx) => tx.aICostLimit.count({ where: { scopeKey: `PROFILE:${profile}` } }))).toBe(1);
      await call('post', `/cost-limits/${first.id}/remove`, owner).send({ expectedVersion: 2, reason: 'E2E: aufräumen' }).expect(200);
    });
  });

  describe('Bewertung auf echten Messwerten', () => {
    it('zählt nur plattformfinanzierte Aufrufe des Monats in der Währung des Limits; Aufrufe ohne Kostenprofil werden getrennt ausgewiesen; andere Mandanten, BYOK, Vormonat und fremde Währung zählen nicht', async () => {
      const limit = (await call('put', '/cost-limits', owner).send(body({ expectedVersion: undefined })).expect(200)).body as { id: string };
      limitIds.push(limit.id);
      expect(await evaluate(limit.id)).toMatchObject({ spent: 0, state: 'OK', unmeasuredRequests: 0 });

      await usage(tenantA, { cost: 4 });
      expect((await evaluate(limit.id)).state).toBe('OK'); // 4 < 5
      await usage(tenantA, { cost: 1.5 });
      expect(await evaluate(limit.id)).toMatchObject({ spent: 5.5, state: 'WARNING' });
      await usage(tenantA, { cost: null }); // ohne Kostenprofil: unbekannter Betrag, nicht „0“
      await usage(tenantA, { cost: 99, source: 'BYOK' }); // der Mandant trägt es selbst
      await usage(tenantA, { cost: 99, currency: 'EUR' }); // andere Währung
      await usage(tenantB, { cost: 99 }); // anderer Mandant
      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      await usage(tenantA, { cost: 99, at: lastMonth }); // Vormonat
      const view = await evaluate(limit.id);
      expect(view).toMatchObject({ spent: 5.5, state: 'WARNING', unmeasuredRequests: 1, currency: 'USD' });

      await usage(tenantA, { cost: 5 });
      expect((await evaluate(limit.id)).state).toBe('SOFT_EXCEEDED'); // 10,5 ≥ 10
      await usage(tenantA, { cost: 10 });
      expect(await evaluate(limit.id)).toMatchObject({ spent: 20.5, state: 'HARD_EXCEEDED' });
    });
  });

  describe('Durchsetzung des Hard-Limits', () => {
    it('nur wenn ausdrücklich durchgesetzt: dann wird der Aufruf des betroffenen Mandanten ehrlich abgewiesen, andere Mandanten laufen weiter; ohne Durchsetzung wird nur gemeldet', async () => {
      const limit = (await guard.list()).find((l) => l.targetTenantId === tenantA && l.scope === 'TENANT')!;
      expect(limit.state).toBe('HARD_EXCEEDED');

      await expect(guard.assertWithinBudget(tenantA, 'FAST_CLASSIFICATION')).resolves.toBeUndefined(); // nicht durchgesetzt: kein Block
      await call('put', '/cost-limits', owner).send(body({ expectedVersion: limit.version, hardEnforced: true, reason: 'E2E: Hard-Limit durchsetzen' })).expect(200);

      const blocked = await guard.assertWithinBudget(tenantA, 'FAST_CLASSIFICATION').catch((e: unknown) => e);
      expect(blocked).toBeInstanceOf(AiProviderUnavailableError);
      expect((blocked as AiProviderUnavailableError).details).toMatchObject({ reasons: ['COST_LIMIT_HARD'], limitScope: 'TENANT' });
      await expect(guard.assertWithinBudget(tenantB, 'FAST_CLASSIFICATION')).resolves.toBeUndefined(); // anderer Mandant bleibt unberührt

      // Anheben des Limits hebt den Block auf (die Änderung wirkt sofort, nicht erst nach Ablauf des Zwischenspeichers).
      const current = (await guard.list()).find((l) => l.id === limit.id)!;
      await call('put', '/cost-limits', owner).send(body({ expectedVersion: current.version, hardEnforced: true, hardAmount: 500, softAmount: 100, warnAmount: 50, reason: 'E2E: Limit anheben' })).expect(200);
      await expect(guard.assertWithinBudget(tenantA, 'FAST_CLASSIFICATION')).resolves.toBeUndefined();
      const after = await evaluate(limit.id);
      expect(after.state).toBe('OK');
    });

    it('ein Profil-Limit gilt nur für dieses Profil', async () => {
      const created = (await call('put', '/cost-limits', owner).send(body({ scope: 'PROFILE', targetTenantId: undefined, profileKey: profile, warnAmount: 1, softAmount: 2, hardAmount: 3, hardEnforced: true })).expect(200)).body as { id: string };
      limitIds.push(created.id);
      await usage(tenantB, { cost: 3.5, profileKey: profile });
      expect((await evaluate(created.id)).state).toBe('HARD_EXCEEDED');
      await expect(guard.assertWithinBudget(tenantB, profile)).rejects.toBeInstanceOf(AiProviderUnavailableError);
      await expect(guard.assertWithinBudget(tenantB, 'FAST_CLASSIFICATION')).resolves.toBeUndefined();
    });
  });

  describe('Alarme', () => {
    let monitor: PlatformRuntimeMonitorService;
    let env: OrbitEnv;
    let redis: Redis;
    let server: Server;
    const received: Array<Record<string, unknown>> = [];

    beforeAll(async () => {
      monitor = app.get(PlatformRuntimeMonitorService);
      env = app.get<OrbitEnv>(ORBIT_ENV);
      redis = (await app.get<Queue>(getQueueToken(WORKFLOW_RUNS_QUEUE)).client) as unknown as Redis;
      server = createServer((req, res) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => {
          received.push(JSON.parse(data) as Record<string, unknown>);
          res.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      env.PLATFORM_ALERT_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
      // Die Laufzeitmessung ist hier nicht Thema: Queue in Ordnung vorgeben, damit nur Kostenmeldungen entstehen; dieser Test hält die Leader-Sperre.
      jest.spyOn(app.get(PlatformRuntimeService), 'health').mockImplementation(async () => assessRuntime([{ name: 'e2e-cost-queue', waiting: 0, active: 0, delayed: 0, failed: 0, workers: 1, oldestWaitingAgeSec: null }], new Date()));
      await redis.set(LEADER_KEY, monitor['instanceId'], 'EX', 120);
    });

    afterAll(async () => {
      env.PLATFORM_ALERT_WEBHOOK_URL = undefined;
      await redis.del(LEADER_KEY);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('Limit-Wechsel: der erste Stand oberhalb der Schwelle wird gemeldet, ein unveränderter nicht; Verschärfung und Rückkehr in den Rahmen werden gemeldet – mit Audit und Webhook ohne Nutzdaten', async () => {
      // Frisches Limit je Test, damit die Reihenfolge der Tests keine Rolle spielt.
      const alertTenant = await bootstrapTenant('alert');
      const created = (await call('put', '/cost-limits', owner).send(body({ targetTenantId: alertTenant, warnAmount: 5, softAmount: 10, hardAmount: 20 })).expect(200)).body as { id: string; version: number };
      limitIds.push(created.id);
      await usage(alertTenant, { cost: 6 }); // WARNING
      await monitor.tick();
      let rows = await events({ entityId: created.id });
      expect(rows).toHaveLength(1);
      expect(extraOf(rows[0]!)).toMatchObject({ kind: 'LIMIT_STATE', from: null, to: 'WARNING', spent: 6, currency: 'USD', scope: 'TENANT', webhook: 'DELIVERED' });
      const hook = received.find((r) => r.type === 'orbit.cost.limit_state_changed' && r.targetTenantId === alertTenant)!;
      expect(hook).toMatchObject({ scope: 'TENANT', from: null, to: 'WARNING', spent: 6, currency: 'USD', environment: env.ORBIT_ENVIRONMENT });
      expect(Object.keys(hook).sort()).toEqual(['at', 'currency', 'environment', 'from', 'hardEnforced', 'profileKey', 'scope', 'spent', 'targetTenantId', 'to', 'type']); // nur Zahlen, Bereich, Zustände

      await monitor.tick();
      expect(await events({ entityId: created.id })).toHaveLength(1); // unveränderter Zustand: keine zweite Meldung

      await usage(alertTenant, { cost: 15 }); // 21 ≥ 20: HARD
      await monitor.tick();
      rows = await events({ entityId: created.id });
      expect(rows.map((r) => extraOf(r).to)).toEqual(['WARNING', 'HARD_EXCEEDED']);
      expect(extraOf(rows[1]!)).toMatchObject({ from: 'WARNING', to: 'HARD_EXCEEDED', hardEnforced: false });

      await call('put', '/cost-limits', owner).send(body({ targetTenantId: alertTenant, warnAmount: 100, softAmount: 200, hardAmount: 300, expectedVersion: created.version, reason: 'E2E: Limits anheben' })).expect(200);
      await monitor.tick();
      rows = await events({ entityId: created.id });
      expect(extraOf(rows[rows.length - 1]!)).toMatchObject({ from: 'HARD_EXCEEDED', to: 'OK' }); // Rückkehr in den Rahmen
      expect(rows[rows.length - 1]!.targetTenantId).toBe(alertTenant);
      expect(rows[rows.length - 1]!.actorType).toBe('SYSTEM');
    });

    it('ungewöhnliche Nutzung: ein Mandant mit plötzlich vielfachem Tagesvolumen wird einmal pro Tag gemeldet; üblicher Betrieb und kleine Mengen nicht', async () => {
      const busy = await bootstrapTenant('busy');
      const calm = await bootstrapTenant('calm');
      const day = 24 * 3_600_000;
      // Üblich: 10 Aufrufe an jedem der sieben Tage davor.
      for (const tenant of [busy, calm]) for (let d = 1; d <= 7; d++) for (let i = 0; i < 10; i++) await usage(tenant, { cost: 0.01, at: new Date(Date.now() - (d + 0.5) * day) });
      // Plötzlich: 60 Aufrufe in den letzten 24 Stunden (×6) beim einen, übliche 10 beim anderen.
      for (let i = 0; i < 60; i++) await usage(busy, { cost: 0.02 });
      for (let i = 0; i < 10; i++) await usage(calm, { cost: 0.01 });

      await monitor.tick();
      const busyEvents = await events({ entityId: busy });
      expect(busyEvents).toHaveLength(1);
      expect(extraOf(busyEvents[0]!)).toMatchObject({ kind: 'ANOMALY', requestsLast24h: 60, factor: 6, webhook: 'DELIVERED' });
      expect(busyEvents[0]!.targetTenantId).toBe(busy);
      expect(await events({ entityId: calm })).toHaveLength(0);
      expect(received.some((r) => r.type === 'orbit.cost.anomaly' && r.targetTenantId === busy)).toBe(true);

      await monitor.tick();
      expect(await events({ entityId: busy })).toHaveLength(1); // nicht noch einmal am selben Tag
    });
  });
});
