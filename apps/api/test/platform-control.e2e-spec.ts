import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { PLATFORM_ROLES, triageFixtureForScenario, type PlatformRole } from '@orbit/shared';
import request from 'supertest';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PolicyEnforcementService } from '../src/policy/policy-enforcement.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CapabilityRegistryService } from '../src/process/capability-registry.service';
import { CaseOrchestrationService } from '../src/process/case-orchestration.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');

/**
 * Phase OPS-3 — Plattformsteuerung gegen die echte Datenbank: Connector-Lifecycle (OCF-01/02), Feature Flags (OCF-03/04), Kill Switches (OCF-05/06),
 * Mandantenlebenszyklus mit feingranularen Sperren und bestätigter Wirkung, Konfigurationspräzedenz (OPS-17/24/25), Audit.
 */
describe('Platform control: connectors, features, kill switches, tenant lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const platformUsers: string[] = [];
  const tenants: string[] = [];
  const tokens: Record<string, string> = {};
  let tenantA: { id: string; token: string };
  let tenantB: { id: string; token: string };
  const flagKey = `feature.e2e_${suffix}`;

  const platform = (method: 'get' | 'post' | 'patch', path: string, token: string) => request(app.getHttpServer())[method](`/api/v1/platform${path}`).set({ Authorization: `Bearer ${token}` });
  const tenantGet = (path: string, token: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set({ Authorization: `Bearer ${token}` });

  async function identity(role: PlatformRole, tag: string): Promise<string> {
    const email = `ops3-${suffix}-${tag}@platform-test.example`;
    const created = await app.get(PlatformIdentityService).create(null, { email, displayName: tag, password, roles: [role] });
    platformUsers.push(created.id);
    const token = (await app.get(PlatformAuthService).login(email, password)).accessToken;
    // Step-up über den Dienst (gleiche Wirkung in der Sitzung); der HTTP-Endpunkt ist bewusst gedrosselt und wird in platform-security-boundary geprüft.
    const auth = app.get(PlatformAuthService);
    await auth.stepUp(await auth.authenticate(token), password);
    return token;
  }

  async function bootstrapTenant(label: string): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    const email = `admin-${id}@e2e-${label}.example`;
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Ctl ${label} ${id.slice(0, 6)}`, slug: `e2e-ctl-${label}-${id}`, adminEmail: email, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'B' } as never);
    tenants.push(tenant.id);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Musterwerk#2026!' });
    return { id: tenant.id, token: login.body.accessToken as string };
  }

  async function lifecycle(token: string, tenantId: string, change: { status?: string; suspensionScopes?: string[]; featureCohorts?: string[] }, reason = 'Test (OPS-3)') {
    const query = new URLSearchParams();
    if (change.status) query.set('status', change.status);
    if (change.suspensionScopes) query.set('suspensionScopes', change.suspensionScopes.join(','));
    if (change.featureCohorts) query.set('featureCohorts', change.featureCohorts.join(','));
    const preview = await platform('get', `/tenants/${tenantId}/lifecycle-preview?${query.toString()}`, token).expect(200);
    return platform('patch', `/tenants/${tenantId}/lifecycle`, token).send({ ...change, reason, confirmationToken: preview.body.confirmationToken });
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    tokens.owner = await identity(PLATFORM_ROLES.PLATFORM_OWNER, 'owner');
    tokens.security = await identity(PLATFORM_ROLES.PLATFORM_SECURITY, 'security');
    tokens.release = await identity(PLATFORM_ROLES.PLATFORM_RELEASE_MANAGER, 'release');
    tokens.operator = await identity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'operator');
    tokens.support = await identity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support');
    tenantA = await bootstrapTenant('a');
    tenantB = await bootstrapTenant('b');
  });

  afterAll(async () => {
    await prisma.withPlatformScope(async (tx) => {
      await tx.platformFeatureFlag.deleteMany({ where: { key: flagKey } });
      // Globale Plattformzustände werden nur zurückgesetzt, nie gelöscht (die Datenbank kann echte Einstellungen enthalten).
      await tx.platformKillSwitch.updateMany({ data: { engaged: false } });
      await tx.platformConnectorDefinition.updateMany({ where: { connectorKey: 'GMAIL' }, data: { lifecycle: 'ACTIVE' } });
      await tx.platformUser.deleteMany({ where: { id: { in: platformUsers } } });
    });
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    await app.close();
  });

  describe('OCF-01/02 – Connector-Lifecycle auf dem einen Katalog', () => {
    it('OCF-02: ein Mandanten-Admin kann Connector, Kill Switch, Flag oder Mandantenstatus nicht ändern', async () => {
      for (const [method, path] of [['post', '/connectors/GMAIL/lifecycle'], ['post', '/kill-switches/ai.executions/engage'], ['post', '/features'], ['patch', `/tenants/${tenantA.id}/lifecycle`]] as const) {
        const response = await platform(method, path, tenantA.token).send({ reason: 'Versuch eines Mandanten', to: 'SUSPENDED', expectedVersion: 0 });
        expect([401, 403]).toContain(response.status);
      }
    });

    it('Katalog + Plattformzustand: ohne Eintrag ACTIVE; die Plattform sieht aktive Verbindungen und betroffene Mandanten (Vorschau)', async () => {
      await prisma.forTenantId(tenantA.id).integration.create({ data: { tenantId: tenantA.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'a@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
      const list = (await platform('get', '/connectors', tokens.operator).expect(200)).body as Array<{ connectorKey: string; lifecycle: string; activeConnections: number; tenantsAffected: number }>;
      const gmail = list.find((c) => c.connectorKey === 'GMAIL')!;
      expect(gmail.lifecycle).toBe('ACTIVE');
      expect(gmail.activeConnections).toBeGreaterThanOrEqual(1);
      const impact = (await platform('get', '/connectors/GMAIL/impact', tokens.operator).expect(200)).body;
      expect(impact.tenantsAffected).toBeGreaterThanOrEqual(1);
      expect(impact.effect).toContain('Keine neuen Verbindungen');
    });

    it('Zustand der Verbindungen je Connector über alle Mandanten: nur Zähler; verbundene und problematische (Anmeldung nötig, Fehler, eingeschränkt) werden getrennt gezählt', async () => {
      type Health = { total: number; connected: number; problems: number };
      const healthOf = async () => Object.fromEntries(((await platform('get', '/connectors', tokens.operator).expect(200)).body as Array<{ connectorKey: string; connectionHealth: Health }>).map((c) => [c.connectorKey, c.connectionHealth]));
      const before = await healthOf();
      // Je Mandant und Connector gibt es höchstens eine Verbindung: ein Zustand je Connector.
      const cases = [
        { connectorType: 'HUBSPOT', status: 'AUTH_REQUIRED' },
        { connectorType: 'TWILIO', status: 'ERROR' },
        { connectorType: 'DATEV', status: 'DEGRADED' },
        { connectorType: 'LEXWARE', status: 'DISCONNECTED' },
        { connectorType: 'GOOGLE_CALENDAR', status: 'CONNECTED' },
      ] as const;
      for (const c of cases) await prisma.forTenantId(tenantA.id).integration.create({ data: { tenantId: tenantA.id, connectorType: c.connectorType, status: c.status, externalAccountDisplayName: `${c.connectorType.toLowerCase()}@e2e.example`, grantedCapabilities: [] } });
      const after = await healthOf();
      const delta = (key: string) => ({ total: after[key]!.total - before[key]!.total, connected: after[key]!.connected - before[key]!.connected, problems: after[key]!.problems - before[key]!.problems });
      expect(delta('HUBSPOT')).toEqual({ total: 1, connected: 0, problems: 1 }); // Anmeldung nötig = Problem
      expect(delta('TWILIO')).toEqual({ total: 1, connected: 0, problems: 1 });
      expect(delta('DATEV')).toEqual({ total: 1, connected: 0, problems: 1 });
      expect(delta('LEXWARE')).toEqual({ total: 1, connected: 0, problems: 0 }); // getrennt ist kein Problem
      expect(delta('GOOGLE_CALENDAR')).toEqual({ total: 1, connected: 1, problems: 0 });
      expect(JSON.stringify(after)).not.toContain('@e2e.example'); // keine Konten- oder Mandantendaten
      const overview = (await platform('get', '/overview', tokens.operator).expect(200)).body as { notYetAvailable: string[] };
      expect(overview.notYetAvailable.join(' ')).not.toContain('Connector-Gesundheit');
    });

    it('OCF-01: Security sperrt GMAIL global – keine neuen Verbindungen, Capability nicht ausführbar mit verständlichem Grund, Katalog zeigt den Status; Aufheben nur mit connectors.write', async () => {
      const v0 = ((await platform('get', '/connectors', tokens.operator).expect(200)).body as Array<{ connectorKey: string; version: number }>).find((c) => c.connectorKey === 'GMAIL')!.version;
      const suspended = await platform('post', '/connectors/GMAIL/lifecycle', tokens.security).send({ to: 'SUSPENDED', expectedVersion: v0, reason: 'Sicherheitsvorfall beim Anbieter (Test)' }).expect(200);
      expect(suspended.body).toMatchObject({ lifecycle: 'SUSPENDED', version: v0 + 1 });

      const connectors = (await tenantGet('/integrations/connectors', tenantA.token).expect(200)).body as Array<{ id: string; platformStatus: string }>;
      expect(connectors.find((c) => c.id === 'GMAIL')?.platformStatus).toBe('SUSPENDED');
      const refused = await request(app.getHttpServer()).post('/api/v1/integrations/GMAIL/connect').set({ Authorization: `Bearer ${tenantA.token}` }).expect(503);
      expect(refused.body.message).toContain('plattformweit gesperrt');

      const executability = (await app.get(CapabilityRegistryService).executabilityFor(tenantA.id)).get('email.send')!;
      expect(executability.executable).toBe(false);
      expect(executability.reasons.join(' ')).toContain('plattformweit vorübergehend gesperrt');
      expect(executability.reasons.join(' ')).toContain('Sicherheitsvorfall');

      // Security darf sperren, aber nicht wieder freigeben; Support darf gar nichts
      await platform('post', '/connectors/GMAIL/lifecycle', tokens.security).send({ to: 'ACTIVE', expectedVersion: v0 + 1, reason: 'Freigabe durch Security (nicht erlaubt)' }).expect(403);
      await platform('post', '/connectors/GMAIL/lifecycle', tokens.support).send({ to: 'SUSPENDED', expectedVersion: v0 + 1, reason: 'Support darf nicht' }).expect(403);
      await platform('post', '/connectors/GMAIL/lifecycle', tokens.operator).send({ to: 'ACTIVE', expectedVersion: v0, reason: 'veraltete Version' }).expect(409);
      await platform('post', '/connectors/GMAIL/lifecycle', tokens.operator).send({ to: 'ACTIVE', expectedVersion: v0 + 1, reason: 'Anbieter hat behoben (Test)' }).expect(200);

      const after = (await app.get(CapabilityRegistryService).executabilityFor(tenantA.id)).get('email.send')!;
      expect(after.reasons.join(' ')).not.toContain('plattformweit');
      const audit = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_CONNECTOR_CHANGED', entityId: 'GMAIL' } }));
      // Das Plattform-Audit ist unveränderlich und überdauert Testläufe – geprüft wird, dass BEIDE Änderungen dieses Laufs vorhanden sind.
      const text = JSON.stringify(audit.map((a) => a.payload));
      expect(text).toContain('Sicherheitsvorfall beim Anbieter (Test)');
      expect(text).toContain('Anbieter hat behoben (Test)');
    });

    it('unbekannte Connector-Schlüssel sind kein Weg, einen Connector zu erfinden (404)', async () => {
      await platform('post', '/connectors/NOT_A_CONNECTOR/lifecycle', tokens.operator).send({ to: 'SUSPENDED', expectedVersion: 0, reason: 'Erfundener Connector' }).expect(404);
    });
  });

  describe('OCF-03/04 – Feature Flags und Rollouts', () => {
    it('reservierte Sicherheitsschlüssel sind als Flag nicht anlegbar; Support darf nichts ändern', async () => {
      await platform('post', '/features', tokens.release).send({ key: 'security.tenant_isolation', description: 'darf nicht', owner: 'team', defaultValue: false }).expect(400);
      await platform('post', '/features', tokens.support).send({ key: flagKey, description: 'Support darf nicht', owner: 'team', defaultValue: false }).expect(403);
    });

    it('OCF-03: Pilot-Kohorte – nur Zielmandanten sind aktiv; nur freigegebene Flags sehen Mandanten, und nur den eigenen Wert', async () => {
      const created = await platform('post', '/features', tokens.release).send({ key: flagKey, description: 'E2E-Rollout für Pilotmandanten', owner: 'release-team', lifecycle: 'ACTIVE', defaultValue: false, cohortOverrides: [{ cohort: 'pilot', value: true }], exposeToTenant: true }).expect(201);
      expect(created.body).toMatchObject({ key: flagKey, version: 1, defaultValue: false });
      await lifecycle(tokens.operator, tenantA.id, { featureCohorts: ['pilot'] }, 'Pilotkohorte (Test)').then((r) => expect(r.status).toBe(200));

      const a = (await tenantGet('/features', tenantA.token).expect(200)).body.flags as Record<string, unknown>;
      const b = (await tenantGet('/features', tenantB.token).expect(200)).body.flags as Record<string, unknown>;
      expect(a[flagKey]).toBe(true);
      expect(b[flagKey]).toBe(false);
      // Mandanten sehen weder Kohorten noch Overrides noch andere Flags
      expect(JSON.stringify(a)).not.toContain('pilot');
      expect(Object.keys(a)).toEqual(expect.arrayContaining([flagKey]));
    });

    it('OCF-04: Mandantenwechsel – ein Tenant-Override gilt nur für diesen Mandanten; Vorschau zeigt die Verteilung; veraltete Version → 409', async () => {
      const flag = (await platform('get', '/features', tokens.release).expect(200)).body.find((f: { key: string }) => f.key === flagKey);
      const updated = await platform('patch', `/features/${flagKey}`, tokens.release).send({ expectedVersion: flag.version, reason: 'Override für Mandant B (Test)', tenantOverrides: [{ tenantId: tenantB.id, value: true }] }).expect(200);
      expect(updated.body.version).toBe(flag.version + 1);
      const b = (await tenantGet('/features', tenantB.token).expect(200)).body.flags as Record<string, unknown>;
      expect(b[flagKey]).toBe(true);
      await platform('patch', `/features/${flagKey}`, tokens.release).send({ expectedVersion: flag.version, reason: 'veraltet', defaultValue: true }).expect(409);

      const preview = (await platform('get', `/features/${flagKey}/preview`, tokens.release).expect(200)).body;
      const forTenant = (id: string) => preview.evaluations.find((e: { tenantId: string }) => e.tenantId === id);
      expect(forTenant(tenantA.id)).toMatchObject({ value: true, source: 'COHORT' });
      expect(forTenant(tenantB.id)).toMatchObject({ value: true, source: 'TENANT' });
      expect(preview.tenants).toBeGreaterThan(1);
    });

    it('ein abgelaufenes Flag wirkt nicht weiter', async () => {
      const flag = (await platform('get', '/features', tokens.release).expect(200)).body.find((f: { key: string }) => f.key === flagKey);
      await platform('patch', `/features/${flagKey}`, tokens.release).send({ expectedVersion: flag.version, reason: 'Rollout beendet (Test)', lifecycle: 'EXPIRED' }).expect(200);
      expect(((await tenantGet('/features', tenantA.token).expect(200)).body.flags as Record<string, unknown>)[flagKey]).toBe(false);
    });
  });

  describe('OCF-05/06 – Kill Switches und Konfigurationspräzedenz', () => {
    it('OCF-05: Der Schalter nimmt autonomen externen Versand zurück, ohne die Mandantenpolicy zu verändern; nur Rollen mit killswitch.write dürfen', async () => {
      await prisma.forTenantId(tenantA.id).policyConfig.update({ where: { tenantId_action: { tenantId: tenantA.id, action: 'email.send.clarification' } }, data: { mode: 'AUTONOMOUS' } });
      const policy = app.get(PolicyEnforcementService);
      expect(await policy.resolveMode(tenantA.id, 'email.send.clarification')).toBe('AUTONOMOUS');

      await platform('post', '/kill-switches/external.autonomous_send/engage', tokens.operator).send({ reason: 'darf der Operator nicht' }).expect(403);
      await platform('post', '/kill-switches/unknown.switch/engage', tokens.security).send({ reason: 'unbekannter Schalter' }).expect(404);
      const engaged = await platform('post', '/kill-switches/external.autonomous_send/engage', tokens.security).send({ reason: 'Verdacht auf Fehlversand (Test)' }).expect(200);
      expect(engaged.body).toMatchObject({ engaged: true, key: 'external.autonomous_send' });
      expect(engaged.body.effect).toContain('nach Freigabe');

      // OPS-17/25: Mandantenpolicy bleibt AUTONOMOUS in der Datenbank, wirkt aber nicht mehr lockernd
      expect(await policy.resolveMode(tenantA.id, 'email.send.clarification')).toBe('REQUIRE_APPROVAL');
      expect(await policy.resolveMode(tenantB.id, 'email.send.quote_delivery')).toBe('REQUIRE_APPROVAL');
      const stored = await prisma.forTenantId(tenantA.id).policyConfig.findUniqueOrThrow({ where: { tenantId_action: { tenantId: tenantA.id, action: 'email.send.clarification' } } });
      expect(stored.mode).toBe('AUTONOMOUS');
      // andere autonome Aktionen sind unberührt
      expect(await policy.resolveMode(tenantA.id, 'email.classify')).toBe('AUTONOMOUS');

      const list = (await platform('get', '/kill-switches', tokens.release).expect(200)).body as Array<{ key: string; engaged: boolean }>;
      expect(list.find((s) => s.key === 'external.autonomous_send')?.engaged).toBe(true);
      expect(list.map((s) => s.key)).toEqual(expect.arrayContaining(['ai.executions', 'planner.adaptive']));
    });

    it('OCF-06: Ein laufender Fall nach dem Kill Switch landet in einem sicheren, definierten Zustand – wartet auf Freigabe, nichts wird versendet, kein falscher Erfolg', async () => {
      const llm = app.get<MockLLMProvider>(LLM_PROVIDER);
      const outbound = app.get<OutboundMailPort>(OUTBOUND_MAIL);
      const send = jest.spyOn(outbound, 'send').mockResolvedValue({ providerMessageId: 'gm-ctl-1', threadId: 'thr-ctl', rfcMessageId: '<sent-ctl@mail.example>', from: 'firma@e2e.example', executionMode: 'SIMULATED' } as never);
      const tenant = await bootstrapTenant('runtime');
      await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
      await app.get(ReferenceProcessService).loadFixture(tenant.id, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
      const blueprints = app.get(BlueprintRegistryService);
      const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
      await blueprints.importDraft(tenant.id, 'u1', blueprint);
      for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'u1', blueprint.key, blueprint.version, to);
      await blueprints.activate(tenant.id, 'u1', blueprint.key, blueprint.version);
      await prisma.forTenantId(tenant.id).policyConfig.update({ where: { tenantId_action: { tenantId: tenant.id, action: 'email.send.clarification' } }, data: { mode: 'AUTONOMOUS' } });

      const runCase = async (thread: string): Promise<string> => {
        llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown> }], stopReason: 'tool_use' });
        llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
        llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_extracted_facts', input: { facts: [{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster', confidence: 0.9 }] } }], stopReason: 'tool_use' });
        llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
        const event: NormalizedIntakeEvent = { tenantId: tenant.id, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: `kunde.${thread}@kunde.example` }, recipients: [{ address: 'info@musterwerk.example' }], subject: 'Anfrage Fenster', content: 'Wir hätten gern ein Angebot für Fenster.', threadId: thread, rfcMessageId: `<${thread}@kunde.example>`, direction: 'INBOUND' };
        return (await app.get(IntakeService).handleIntakeEvent(tenant.id, undefined, event)).case!.id;
      };
      const viewer = { tenantId: tenant.id, permissions: [] as never[] };
      const nodeState = async (caseId: string, node: string) => (await app.get(CaseOrchestrationService).projection(viewer, caseId)).nodes.find((n) => n.id === node)?.state;

      // 1) Kill Switch gezogen (aus dem vorigen Test): die autonome Rückfrage wartet auf Freigabe
      const held = await runCase('thr-held');
      expect(await nodeState(held, 'ask')).toBe('AWAITING_APPROVAL');
      expect(send).not.toHaveBeenCalled();
      const heldCase = await prisma.forTenantId(tenant.id).case.findUniqueOrThrow({ where: { id: held } });
      expect(heldCase.orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
      expect(heldCase.completedAt).toBeNull();

      // 2) Schalter gelöst: dieselbe Mandantenpolicy wirkt wieder, die Rückfrage geht autonom raus
      await platform('post', '/kill-switches/external.autonomous_send/release', tokens.security).send({ reason: 'Fehlalarm geklärt (Test)' }).expect(200);
      const free = await runCase('thr-free');
      expect(await nodeState(free, 'ask')).toBe('SUCCEEDED');
      expect(send).toHaveBeenCalledTimes(1);
      send.mockRestore();
    });

    it('ai.executions: neue KI-Aufrufe aller Pfade werden ehrlich abgewiesen; Triage meldet „später“ statt eines falschen Urteils', async () => {
      const llm = app.get<MockLLMProvider>(LLM_PROVIDER);
      await platform('post', '/kill-switches/ai.executions/engage', tokens.owner).send({ reason: 'Modellfehler erkannt (Test)' }).expect(200);
      try {
        const event: NormalizedIntakeEvent = { tenantId: tenantB.id, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: 'kunde.stop@kunde.example' }, recipients: [{ address: 'info@musterwerk.example' }], subject: 'Anfrage', content: 'Bitte um ein Angebot.', threadId: 'thr-stop', rfcMessageId: '<stop@kunde.example>', direction: 'INBOUND' };
        llm.seedResponse({ text: 'sollte nie abgeholt werden', toolCalls: [], stopReason: 'end_turn' });
        const result = await app.get(IntakeService).handleIntakeEvent(tenantB.id, undefined, event);
        expect(result.intakeStatus).toBe('PENDING_TRIAGE');
        expect(result.case).toBeUndefined();
        const detail = await prisma.forTenantId(tenantB.id).intakeDecision.findFirst({ where: { intakeEventId: result.intakeEventId } });
        expect(JSON.stringify(detail)).toContain('plattformweit');
        const stopped = await tenantGet('/ai-providers/status', tenantB.token).expect(200);
        expect(stopped.body.mode).toBe('ORBIT_MANAGED');
      } finally {
        await platform('post', '/kill-switches/ai.executions/release', tokens.owner).send({ reason: 'Modell wieder freigegeben (Test)' }).expect(200);
      }
    });

    it('jede Schalteränderung ist auditiert – mit Akteur, Begründung und Wirkungsbeschreibung', async () => {
      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_KILL_SWITCH_CHANGED' }, orderBy: { createdAt: 'asc' } }));
      expect(rows.length).toBeGreaterThanOrEqual(4);
      const text = JSON.stringify(rows.map((r) => r.payload));
      expect(text).toContain('Verdacht auf Fehlversand');
      expect(text).toContain('nach Freigabe');
    });
  });

  describe('Mandantenlebenszyklus mit feingranularen Sperren (Amendment 03 §6)', () => {
    it('die Änderung braucht die zur Vorschau gehörende Bestätigung – ein falsches Token oder ein anderer Zielzustand wird abgelehnt', async () => {
      const preview = await platform('get', `/tenants/${tenantB.id}/lifecycle-preview?suspensionScopes=LOGIN`, tokens.operator).expect(200);
      expect(preview.body.effects.join(' ')).toContain('können sich nicht mehr anmelden');
      expect(preview.body.confirmationToken).toHaveLength(24);
      await platform('patch', `/tenants/${tenantB.id}/lifecycle`, tokens.operator).send({ suspensionScopes: ['LOGIN'], reason: 'falsches Token', confirmationToken: 'x'.repeat(24) }).expect(400);
      await platform('patch', `/tenants/${tenantB.id}/lifecycle`, tokens.operator).send({ suspensionScopes: ['CONNECTORS'], reason: 'anderer Zielzustand', confirmationToken: preview.body.confirmationToken }).expect(400);
      await platform('patch', `/tenants/${tenantB.id}/lifecycle`, tokens.support).send({ suspensionScopes: ['LOGIN'], reason: 'Support darf nicht', confirmationToken: preview.body.confirmationToken }).expect(403);
      await platform('get', `/tenants/${tenantB.id}/lifecycle-preview?suspensionScopes=NONSENSE`, tokens.operator).expect(400);
      await platform('get', `/tenants/${tenantB.id}/lifecycle-preview?status=GONE`, tokens.operator).expect(400);
    });

    it('LOGIN-Sperre: auch bereits ausgestellte Tokens enden, die Anmeldung scheitert; Aufheben stellt alles wieder her – ohne Datenverlust', async () => {
      await tenantGet('/auth/me', tenantB.token).expect(200);
      const applied = await lifecycle(tokens.operator, tenantB.id, { suspensionScopes: ['LOGIN'] }, 'Zahlungsverzug – Anmeldung gesperrt (Test)');
      expect(applied.status).toBe(200);
      await tenantGet('/auth/me', tenantB.token).expect(401);
      const adminEmail = (await prisma.withRlsBypass((tx) => tx.user.findFirstOrThrow({ where: { tenantId: tenantB.id } }))).email;
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Musterwerk#2026!' }).expect(401);
      expect(await prisma.withRlsBypass((tx) => tx.user.count({ where: { tenantId: tenantB.id } }))).toBeGreaterThan(0);

      await lifecycle(tokens.operator, tenantB.id, { suspensionScopes: [] }, 'Zahlung eingegangen (Test)').then((r) => expect(r.status).toBe(200));
      const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Musterwerk#2026!' }).expect(200);
      tenantB.token = login.body.accessToken as string;
      await tenantGet('/auth/me', tenantB.token).expect(200);
    });

    it('AUTOMATION-Sperre nimmt Autonomie zurück (außer reines Lesen/Einordnen); CONNECTORS-Sperre macht Verbindungsaktionen nicht ausführbar', async () => {
      const policy = app.get(PolicyEnforcementService);
      await lifecycle(tokens.operator, tenantA.id, { suspensionScopes: ['AUTOMATION'] }, 'Automatisierung pausiert (Test)').then((r) => expect(r.status).toBe(200));
      expect(await policy.resolveMode(tenantA.id, 'lead.create')).toBe('REQUIRE_APPROVAL');
      expect(await policy.resolveMode(tenantA.id, 'copilot.read')).toBe('AUTONOMOUS');
      expect(await policy.resolveMode(tenantA.id, 'email.triage')).toBe('AUTONOMOUS');
      await tenantGet('/auth/me', tenantA.token).expect(200); // Anmeldung bleibt möglich

      await lifecycle(tokens.operator, tenantA.id, { suspensionScopes: ['CONNECTORS'] }, 'Verbindungen pausiert (Test)').then((r) => expect(r.status).toBe(200));
      expect(await policy.resolveMode(tenantA.id, 'lead.create')).toBe('AUTONOMOUS');
      const executability = (await app.get(CapabilityRegistryService).executabilityFor(tenantA.id)).get('email.send')!;
      expect(executability.executable).toBe(false);
      expect(executability.reasons.join(' ')).toContain('Verbindungsaktivität dieses Unternehmens ist vorübergehend gesperrt');

      await lifecycle(tokens.operator, tenantA.id, { suspensionScopes: [], status: 'ACTIVE' }, 'Alles wieder frei (Test)').then((r) => expect(r.status).toBe(200));
      expect(await policy.resolveMode(tenantA.id, 'lead.create')).toBe('AUTONOMOUS');
    });

    it('nicht aktiver Lebenszyklus (SUSPENDED) sperrt alles; die Änderung ist mit Vorher/Nachher und Wirkung auditiert, der Mandant ist im Register mit Sperrarten sichtbar', async () => {
      await lifecycle(tokens.owner, tenantB.id, { status: 'SUSPENDED' }, 'Mandant ausgesetzt (Test)').then((r) => expect(r.status).toBe(200));
      await tenantGet('/auth/me', tenantB.token).expect(401);
      const registry = (await platform('get', `/tenants/${tenantB.id}`, tokens.support).expect(200)).body;
      expect(registry).toMatchObject({ lifecycleStatus: 'SUSPENDED', suspensionScopes: [] });
      await lifecycle(tokens.owner, tenantB.id, { status: 'ACTIVE' }, 'Mandant wieder aktiv (Test)').then((r) => expect(r.status).toBe(200));

      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_TENANT_LIFECYCLE_CHANGED', targetTenantId: tenantB.id }, orderBy: { createdAt: 'asc' } }));
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const payloads = rows.map((r) => r.payload as { before: { status: string }; after: { status: string }; extra: { effects: string[] } });
      expect(payloads.some((p) => p.before.status === 'ACTIVE' && p.after.status === 'SUSPENDED')).toBe(true);
      expect(JSON.stringify(payloads)).toContain('können sich nicht mehr anmelden');
      expect(rows.every((r) => r.tenantId === null)).toBe(true);
    });
  });

  describe('Isolation', () => {
    it('Plattformsteuerungs-Tabellen sind für Mandantencode unsichtbar (RLS)', async () => {
      expect(await prisma.platformFeatureFlag.findMany()).toEqual([]);
      expect(await prisma.platformKillSwitch.findMany()).toEqual([]);
      expect(await prisma.platformConnectorDefinition.findMany()).toEqual([]);
      expect(await prisma.withRlsBypass((tx) => tx.platformKillSwitch.findMany())).toEqual([]);
    });
  });
});
