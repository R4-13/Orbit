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
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');

/**
 * Phase OPS-5 — Support-Sessions (OPR-04…OPR-08, OPS-21…23, OPS-32/33): zeitlich begrenzt, scopebasiert, Vier-Augen für Fachinhalte, bei jedem Aufruf neu geprüft, auditiert.
 */
describe('Platform support sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const platformUsers: string[] = [];
  const tenants: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let tenantA: { id: string; token: string };
  let tenantB: { id: string; token: string };
  let caseId: string;
  let foreignCaseId: string;

  const api = (method: 'get' | 'post', path: string, token: string) => request(app.getHttpServer())[method](`/api/v1/platform${path}`).set({ Authorization: `Bearer ${token}` });

  async function identity(role: PlatformRole, tag: string): Promise<string> {
    const email = `ops5-${suffix}-${tag}@platform-test.example`;
    const created = await app.get(PlatformIdentityService).create(null, { email, displayName: tag, password, roles: [role] });
    platformUsers.push(created.id);
    ids[tag] = created.id;
    const token = (await app.get(PlatformAuthService).login(email, password)).accessToken;
    const auth = app.get(PlatformAuthService);
    await auth.stepUp(await auth.authenticate(token), password);
    return token;
  }

  async function bootstrapTenant(label: string): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    const email = `admin-${id}@e2e-${label}.example`;
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Sup ${label} ${id.slice(0, 6)}`, slug: `e2e-sup-${label}-${id}`, adminEmail: email, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'B' } as never);
    tenants.push(tenant.id);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Musterwerk#2026!' });
    return { id: tenant.id, token: login.body.accessToken as string };
  }

  const requestSession = (token: string, overrides: Record<string, unknown> = {}) =>
    api('post', '/support-sessions', token).send({ tenantId: tenantA.id, mode: 'READ_DIAGNOSTICS', scopes: ['diagnostics.read'], minutes: 30, reasonCode: 'INCIDENT', freeTextReason: 'Vorgang bleibt in der Bearbeitung stehen (Test)', ticketRef: 'SUP-1', ...overrides });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    tokens.support = await identity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support');
    tokens.support2 = await identity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support2');
    tokens.operator = await identity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'operator');
    tokens.security = await identity(PLATFORM_ROLES.PLATFORM_SECURITY, 'security');
    tokens.owner = await identity(PLATFORM_ROLES.PLATFORM_OWNER, 'owner');
    tokens.auditor = await identity(PLATFORM_ROLES.PLATFORM_AUDITOR, 'auditor');
    tenantA = await bootstrapTenant('a');
    tenantB = await bootstrapTenant('b');

    // Ein echter Fall mit Entwurfstext in Mandant A
    const llm = app.get<MockLLMProvider>(LLM_PROVIDER);
    await prisma.forTenantId(tenantA.id).integration.create({ data: { tenantId: tenantA.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    await app.get(ReferenceProcessService).loadFixture(tenantA.id, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenantA.id, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantA.id, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenantA.id, 'u1', blueprint.key, blueprint.version);
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_extracted_facts', input: { facts: [{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster', confidence: 0.9 }] } }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    const event: NormalizedIntakeEvent = { tenantId: tenantA.id, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: 'anna.sup@kunde.example' }, recipients: [{ address: 'info@musterwerk.example' }], subject: 'Anfrage Fenster', content: 'Wir hätten gern ein Angebot für Fenster.', threadId: 'thr-sup', rfcMessageId: '<sup1@kunde.example>', direction: 'INBOUND' };
    caseId = (await app.get(IntakeService).handleIntakeEvent(tenantA.id, undefined, event)).case!.id;

    const foreign = await prisma.forTenantId(tenantB.id).case.create({ data: { tenantId: tenantB.id, type: 'GENERAL', title: 'Fremder Fall' } as never });
    foreignCaseId = foreign.id;
  });

  afterAll(async () => {
    await prisma.withPlatformScope(async (tx) => {
      await tx.platformSupportSession.deleteMany({ where: { operatorUserId: { in: platformUsers } } });
      await tx.platformUser.deleteMany({ where: { id: { in: platformUsers } } });
    });
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    await app.close();
  });

  describe('Anforderung und Plattformrichtlinie', () => {
    it('Mandanten-Nutzer und Rollen ohne Anforderungsrecht (Auditor) können keine Session anfordern', async () => {
      expect([401, 403]).toContain((await requestSession(tenantA.token)).status);
      await requestSession(tokens.auditor).expect(403);
    });

    it('kein stilles Impersonation: unterstützte Aktionen, der Aktions-Scope und Fachinhalt im Diagnose-Modus werden abgelehnt – mit verständlichen Gründen', async () => {
      const action = await requestSession(tokens.support, { mode: 'ASSISTED_ACTION', scopes: ['tenant.action.execute'] }).expect(400);
      expect(JSON.stringify(action.body.details.issues)).toContain('nicht verfügbar');
      const payloadInDiagnosticsMode = await requestSession(tokens.support, { scopes: ['diagnostics.read', 'case.payload.read'] }).expect(400);
      expect(payloadInDiagnosticsMode.body.details.issues[0].code).toBe('SCOPE_NOT_IN_MODE:case.payload.read');
    });

    it('die Höchstdauer ist Plattformrichtlinie (Standard 120 Minuten), unbekannte Mandanten und Modi scheitern', async () => {
      const tooLong = await requestSession(tokens.support, { minutes: 121 }).expect(400);
      expect(tooLong.body.details.issues[0].message).toContain('120');
      await requestSession(tokens.support, { tenantId: randomUUID() }).expect(404);
      await requestSession(tokens.support, { mode: 'GOD_MODE' }).expect(400);
      await requestSession(tokens.support, { minutes: 2 }).expect(400);
    });
  });

  describe('OPR-04/05 – ohne Session und mit Diagnose-Session kein Fachinhalt', () => {
    it('OPR-04: ohne Session gibt es keinen Pfad zum Fachinhalt (Support-Rolle allein reicht nicht)', async () => {
      await api('get', `/support-sessions/${randomUUID()}/cases/${caseId}/payload`, tokens.support).expect(403);
      // auch das Mandantenregister und die Diagnose liefern keine Inhalte
      const tenant = (await api('get', `/tenants/${tenantA.id}`, tokens.support).expect(200)).body;
      expect(JSON.stringify(tenant)).not.toContain('Fenster');
      const diag = (await api('get', `/diagnostics/cases/${caseId}?tenantId=${tenantA.id}&reason=Analyse+ohne+Session`, tokens.support).expect(200)).body;
      expect(JSON.stringify(diag)).not.toContain('Welche Menge benötigen Sie?');
    });

    it('OPR-05: eine Diagnose-Session ist sofort aktiv, liefert Metadaten – aber keinen Payload; der abgewiesene Versuch ist auditiert', async () => {
      const created = (await requestSession(tokens.support).expect(201)).body;
      ids.diag = created.id;
      expect(created).toMatchObject({ status: 'ACTIVE', requiresApproval: false, scopes: ['diagnostics.read'], targetTenantId: tenantA.id });
      expect(new Date(created.expiresAt).getTime() - new Date(created.activatedAt).getTime()).toBe(30 * 60_000);

      const diag = await api('get', `/support-sessions/${created.id}/cases/${caseId}/diagnostics`, tokens.support).expect(200);
      expect(diag.body.caseId).toBe(caseId);
      await api('get', `/support-sessions/${created.id}/cases/${caseId}/payload`, tokens.support).expect(403);
      await api('get', `/support-sessions/${created.id}/cases`, tokens.support).expect(403); // case.metadata.read nicht erteilt
      await api('get', `/support-sessions/${created.id}/tenant`, tokens.support).expect(403);

      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', supportSessionId: created.id }, orderBy: { createdAt: 'asc' } }));
      const types = rows.map((r) => r.eventType);
      expect(types).toEqual(expect.arrayContaining(['PLATFORM_SUPPORT_SESSION_REQUESTED', 'PLATFORM_SUPPORT_SESSION_ACTIVATED', 'PLATFORM_SUPPORT_ACCESS', 'PLATFORM_ACCESS_DENIED']));
      expect(rows.every((r) => r.tenantId === null && r.targetTenantId === tenantA.id)).toBe(true);
    });

    it('eine fremde Session kann nicht benutzt werden (nur der Anfordernde), und Support sieht nur die eigenen Sessions', async () => {
      await api('get', `/support-sessions/${ids.diag}/cases/${caseId}/diagnostics`, tokens.support2).expect(403);
      await api('get', `/support-sessions/${ids.diag}`, tokens.support2).expect(404);
      expect(((await api('get', '/support-sessions', tokens.support2).expect(200)).body as unknown[]).length).toBe(0);
      expect(((await api('get', '/support-sessions', tokens.security).expect(200)).body as Array<{ id: string }>).some((s) => s.id === ids.diag)).toBe(true);
    });
  });

  describe('OPR-06 – Fachinhalt nur mit Freigabe durch eine zweite Person', () => {
    it('eine Session mit Payload-Scope wartet auf Freigabe; vorher kein Zugriff; die anfordernde Person kann nicht selbst freigeben', async () => {
      const created = (await requestSession(tokens.support, { mode: 'READ_TENANT_CONTEXT', scopes: ['diagnostics.read', 'case.metadata.read', 'case.payload.read', 'tenant.config.read'], minutes: 45 }).expect(201)).body;
      ids.payload = created.id;
      expect(created).toMatchObject({ status: 'REQUESTED', requiresApproval: true, expiresAt: null });
      await api('get', `/support-sessions/${created.id}/cases/${caseId}/payload`, tokens.support).expect(403);

      await api('post', `/support-sessions/${created.id}/approve`, tokens.support).send({ expectedVersion: created.version, reason: 'Selbstfreigabe' }).expect(403);
      // Auch ein Owner (hat beide Rechte) kann die eigene Anforderung nicht freigeben
      const own = (await requestSession(tokens.owner, { mode: 'READ_TENANT_CONTEXT', scopes: ['case.payload.read'] }).expect(201)).body;
      const selfApproval = await api('post', `/support-sessions/${own.id}/approve`, tokens.owner).send({ expectedVersion: own.version, reason: 'Selbstfreigabe durch den Owner' });
      expect(selfApproval.status).toBe(403);
      expect(JSON.stringify(selfApproval.body)).toContain('Vier-Augen');
    });

    it('Security gibt frei (Step-up, Begründung, Version) → ACTIVE mit Ablauf ab Freigabe; der Zugriff liefert Fachinhalt und wird mit Objekten auditiert', async () => {
      const before = (await api('get', `/support-sessions/${ids.payload}`, tokens.security).expect(200)).body;
      await api('post', `/support-sessions/${ids.payload}/approve`, tokens.security).send({ expectedVersion: before.version + 7, reason: 'veraltete Version' }).expect(409);
      const approved = (await api('post', `/support-sessions/${ids.payload}/approve`, tokens.security).send({ expectedVersion: before.version, reason: 'Kundenfreigabe liegt vor (Test)' }).expect(200)).body;
      expect(approved).toMatchObject({ status: 'ACTIVE', approvedByUserId: ids.security });
      expect(new Date(approved.expiresAt).getTime() - new Date(approved.activatedAt).getTime()).toBe(45 * 60_000);

      const payload = (await api('get', `/support-sessions/${ids.payload}/cases/${caseId}/payload`, tokens.support).expect(200)).body;
      expect(JSON.stringify(payload)).toContain('Welche Menge benötigen Sie?');
      expect(payload.drafts.length).toBeGreaterThan(0);

      const context = (await api('get', `/support-sessions/${ids.payload}/tenant`, tokens.support).expect(200)).body;
      expect(context.tenantId).toBe(tenantA.id);
      expect(context.policies.length).toBeGreaterThan(5);
      const cases = (await api('get', `/support-sessions/${ids.payload}/cases`, tokens.support).expect(200)).body as Array<Record<string, unknown>>;
      expect(cases.some((c) => c.id === caseId)).toBe(true);
      expect(Object.keys(cases[0] as object)).not.toContain('title'); // Metadaten ohne Titel/Inhalte

      const access = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', supportSessionId: ids.payload, eventType: 'PLATFORM_SUPPORT_ACCESS' } }));
      const payloadAccess = access.find((a) => a.entityType === 'case.payload');
      expect(payloadAccess).toBeDefined();
      expect(payloadAccess?.entityId).toBe(caseId);
      expect(JSON.stringify(payloadAccess?.payload)).toContain('drafts');
      // der Auditeintrag trägt keinen Fachinhalt
      expect(JSON.stringify(access.map((a) => a.payload))).not.toContain('Welche Menge');
    });

    it('OPS-32: eine Session für Mandant A liest nie Fälle von Mandant B – weder per ID noch in der Metadatenliste', async () => {
      await api('get', `/support-sessions/${ids.payload}/cases/${foreignCaseId}/payload`, tokens.support).expect(404);
      await api('get', `/support-sessions/${ids.payload}/cases/${foreignCaseId}/diagnostics`, tokens.support).expect(404);
      const cases = (await api('get', `/support-sessions/${ids.payload}/cases`, tokens.support).expect(200)).body as Array<{ id: string }>;
      expect(cases.some((c) => c.id === foreignCaseId)).toBe(false);
    });
  });

  describe('OPR-07 – Ablauf, Widerruf, kein stilles Erneuern', () => {
    it('OPR-07: eine abgelaufene Session wird sofort verweigert (auch bei gültigem Plattform-Token) und gilt als EXPIRED; es gibt keinen Verlängerungsweg', async () => {
      await api('get', `/support-sessions/${ids.payload}/cases/${caseId}/payload`, tokens.support).expect(200);
      await prisma.withPlatformScope((tx) => tx.platformSupportSession.update({ where: { id: ids.payload }, data: { expiresAt: new Date(Date.now() - 1000) } }));
      const denied = await api('get', `/support-sessions/${ids.payload}/cases/${caseId}/payload`, tokens.support).expect(403);
      expect(JSON.stringify(denied.body)).toContain('EXPIRED');
      expect((await api('get', `/support-sessions/${ids.payload}`, tokens.support).expect(200)).body.status).toBe('EXPIRED');
      await api('post', `/support-sessions/${ids.payload}/extend`, tokens.support).send({ minutes: 60 }).expect(404);
      await api('post', `/support-sessions/${ids.payload}/close`, tokens.support).send({ reason: 'bereits abgelaufen' }).expect(409);
    });

    it('Widerruf durch Security wirkt sofort auf eine laufende Session; Schließen durch die anfordernde Person beendet den Zugriff; beides ist auditiert', async () => {
      const revocable = (await requestSession(tokens.support).expect(201)).body;
      await api('get', `/support-sessions/${revocable.id}/cases/${caseId}/diagnostics`, tokens.support).expect(200);
      await api('post', `/support-sessions/${revocable.id}/revoke`, tokens.support).send({ reason: 'darf der Support nicht' }).expect(403);
      await api('post', `/support-sessions/${revocable.id}/revoke`, tokens.security).send({ reason: 'Verdacht auf Missbrauch (Test)' }).expect(200);
      await api('get', `/support-sessions/${revocable.id}/cases/${caseId}/diagnostics`, tokens.support).expect(403);

      const closable = (await requestSession(tokens.support).expect(201)).body;
      await api('post', `/support-sessions/${closable.id}/close`, tokens.support2).send({ reason: 'fremde Person' }).expect(403);
      await api('post', `/support-sessions/${closable.id}/close`, tokens.support).send({ reason: 'Analyse abgeschlossen (Test)' }).expect(200);
      await api('get', `/support-sessions/${closable.id}/cases/${caseId}/diagnostics`, tokens.support).expect(403);

      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_SUPPORT_SESSION_CLOSED', supportSessionId: { in: [revocable.id, closable.id] } } }));
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows.map((r) => r.payload))).toContain('Verdacht auf Missbrauch');
    });

    it('OPR-08: eine Session lässt sich nicht auf einen anderen Mandanten umlenken – die Mandanten-ID ist unveränderlich Teil der Session', async () => {
      const created = (await requestSession(tokens.support).expect(201)).body;
      const tenantQuery = await api('get', `/support-sessions/${created.id}/cases/${foreignCaseId}/diagnostics?tenantId=${tenantB.id}`, tokens.support);
      expect(tenantQuery.status).toBe(404);
    });
  });

  describe('Isolation', () => {
    it('Support-Sessions sind für Mandantencode unsichtbar (RLS)', async () => {
      expect(await prisma.platformSupportSession.findMany()).toEqual([]);
      expect(await prisma.withRlsBypass((tx) => tx.platformSupportSession.findMany())).toEqual([]);
    });

    it('der DB-Check erzwingt Vier-Augen auch ohne Anwendungslogik', async () => {
      await expect(
        prisma.withPlatformScope((tx) => tx.platformSupportSession.create({ data: { targetTenantId: tenantA.id, operatorUserId: ids.support, approvedByUserId: ids.support, reasonCode: 'INCIDENT', freeTextReason: 'Selbstfreigabe per SQL', mode: 'READ_TENANT_CONTEXT', scopes: ['case.payload.read'], requestedMinutes: 30 } })),
      ).rejects.toThrow(/four_eyes|check constraint/i);
    });
  });
});
