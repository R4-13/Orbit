import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PLATFORM_ROLES, type DiagnosticSearchHit, type PlatformRole, type WorkBacklog } from '@orbit/shared';
import request from 'supertest';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Arbeitsstand und Referenzsuche (Amendment 03 §16.1/§16.2) mit echten Zeilen. Der Arbeitsstand wird als **Differenz** vor/nach dem Anlegen geprüft, weil
 * die Entwicklungsdatenbank weitere Vorgänge enthalten darf; die Testdaten liegen in einem eigenen Mandanten, der am Ende (kaskadierend) entfernt wird.
 */
describe('Platform work backlog and reference search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const users: string[] = [];
  let tenantId: string;
  const ids = { staleCase: '', reviewCase: '', plan: '', intent: '', run: '', session: '' };

  async function token(role: PlatformRole, tag: string): Promise<string> {
    const email = `wb-${suffix}-${tag}@platform-test.example`;
    const created = await app.get(PlatformIdentityService).create(null, { email, displayName: tag, password, roles: [role] });
    users.push(created.id);
    return (await app.get(PlatformAuthService).login(email, password)).accessToken;
  }
  const get = (path: string, bearer: string) => request(app.getHttpServer()).get(`/api/v1/platform${path}`).set({ Authorization: `Bearer ${bearer}` });
  const search = (bearer: string, reference: string, reason = 'Kundenanfrage Ticket 4720') => get(`/diagnostics/search?reference=${encodeURIComponent(reference)}&reason=${encodeURIComponent(reason)}`, bearer);

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.withRlsBypass(async (tx) => {
      if (tenantId) await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
    await prisma.withPlatformScope(async (tx) => {
      await tx.platformSupportSession.deleteMany({ where: { id: ids.session } });
      await tx.platformUser.deleteMany({ where: { id: { in: users } } });
    });
    await app.close();
  });

  it('Arbeitsstand: echte Zähler als Differenz – Erwartungen, Wiederholungen, hängende Vorgänge, Prüfung, ungewisse Aktionen, fehlgeschlagene Schritte', async () => {
    const owner = await token(PLATFORM_ROLES.PLATFORM_OWNER, 'owner');
    const before = (await get('/runtime/work', owner).expect(200)).body as WorkBacklog;
    expect(Date.now() - new Date(before.checkedAt).getTime()).toBeLessThan(60_000);

    const now = Date.now();
    await prisma.withRlsBypass(async (tx) => {
      tenantId = (await tx.tenant.create({ data: { name: `Backlog ${suffix}`, slug: `backlog-${suffix}` } })).id;
      const hourAgo = new Date(now - 3_600_000);
      const stale = await tx.case.create({ data: { tenantId, type: 'GENERAL', title: 'Hängender Vorgang', orchestrationStatus: 'IN_PROGRESS' } });
      await tx.case.updateMany({ where: { id: stale.id }, data: { updatedAt: hourAgo } });
      const review = await tx.case.create({ data: { tenantId, type: 'GENERAL', title: 'In Prüfung', orchestrationStatus: 'MANUAL_REVIEW' } });
      const plan = await tx.processPlan.create({
        data: { tenantId, caseId: stale.id, revision: 1, status: 'ACTIVE', source: 'HUMAN', basedOnCaseRevision: 1, explanation: 'Testplan', planHash: 'a'.repeat(64), validation: {} },
      });
      const node = (nodeKey: string, extra: Record<string, unknown>) => ({ tenantId, planId: plan.id, nodeKey, type: 'TOOL', title: nodeKey, definition: {}, ...extra });
      await tx.processPlanNode.createMany({
        data: [
          node('retry-later', { state: 'PLANNED', retryAt: new Date(now + 3_600_000) }),
          node('retry-due', { state: 'PLANNED', retryAt: new Date(now - 60_000) }),
          node('failed', { state: 'FAILED', completedAt: new Date(now - 60_000) }),
        ],
      });
      await tx.waitSubscription.createMany({
        data: [
          { tenantId, caseId: stale.id, eventType: 'EMAIL_REPLY', correlation: {}, deadlineAt: new Date(now - 60_000) },
          { tenantId, caseId: stale.id, eventType: 'EMAIL_REPLY', correlation: {}, deadlineAt: new Date(now + 3_600_000) },
        ],
      });
      const intent = await tx.actionIntent.create({
        data: { tenantId, caseId: stale.id, planId: plan.id, planRevision: 1, caseRevision: 1, nodeKey: 'failed', capabilityKey: 'email.send', payload: {}, payloadHash: 'b'.repeat(64), idempotencyKey: `idem-${suffix}`, status: 'OUTCOME_UNKNOWN' },
      });
      const run = await tx.agentRun.create({ data: { tenantId, caseId: stale.id, agentType: 'ORCHESTRATOR', triggerType: 'MANUAL' } });
      Object.assign(ids, { staleCase: stale.id, reviewCase: review.id, plan: plan.id, intent: intent.id, run: run.id });
    });

    const after = (await get('/runtime/work', owner).expect(200)).body as WorkBacklog;
    const delta = (key: keyof WorkBacklog) => (after[key] as number) - (before[key] as number);
    expect(delta('openWaits')).toBe(2);
    expect(delta('overdueWaits')).toBe(1);
    expect(delta('scheduledRetries')).toBe(1);
    expect(delta('dueRetries')).toBe(1);
    expect(delta('stuckCases')).toBe(1);
    expect(delta('casesInReview')).toBe(1);
    expect(delta('unknownOutcomes')).toBe(1);
    expect(delta('failedSteps24h')).toBe(1);

    // Nur Zähler: weder Titel noch Kennungen noch Mandantennamen.
    const text = JSON.stringify(after);
    expect(text).not.toContain('Hängender Vorgang');
    expect(text).not.toContain(tenantId);
    expect(Object.keys(after).sort()).toEqual(['casesInReview', 'checkedAt', 'dueRetries', 'failedSteps24h', 'openWaits', 'overdueWaits', 'scheduledRetries', 'stuckCases', 'unknownOutcomes']);

    // Mit gültiger Sperre gilt der Vorgang als in Arbeit, nicht als hängend.
    await prisma.withRlsBypass((tx) => tx.case.updateMany({ where: { id: ids.staleCase }, data: { leaseOwner: 'worker-x', leaseExpiresAt: new Date(now + 600_000) } }));
    const leased = (await get('/runtime/work', owner).expect(200)).body as WorkBacklog;
    expect(leased.stuckCases - before.stuckCases).toBe(0);
  });

  it('Referenzsuche: findet Vorgang, Plan, Aktion, Lauf und Support-Sitzung – mit Mandant und Vorgang, ohne Inhalte; jede Suche wird auditiert', async () => {
    const support = await token(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support');
    const hitOf = async (reference: string) => (await search(support, reference).expect(200)).body as DiagnosticSearchHit[];

    expect(await hitOf(ids.staleCase)).toEqual([expect.objectContaining({ kind: 'CASE', tenantId, tenantName: `Backlog ${suffix}`, caseId: ids.staleCase, status: 'IN_PROGRESS' })]);
    expect(await hitOf(ids.plan)).toEqual([expect.objectContaining({ kind: 'PLAN', tenantId, caseId: ids.staleCase, status: 'ACTIVE' })]);
    expect(await hitOf(ids.intent)).toEqual([expect.objectContaining({ kind: 'ACTION', tenantId, caseId: ids.staleCase, status: 'OUTCOME_UNKNOWN' })]);
    expect(await hitOf(ids.run)).toEqual([expect.objectContaining({ kind: 'AGENT_RUN', tenantId, caseId: ids.staleCase })]);

    ids.session = randomUUID();
    const requester = (await prisma.withPlatformScope((tx) => tx.platformUser.findFirst({ where: { id: { in: users } } })))!.id;
    await prisma.withPlatformScope((tx) =>
      tx.platformSupportSession.create({ data: { id: ids.session, targetTenantId: tenantId, operatorUserId: requester, reasonCode: 'CUSTOMER_REQUEST', freeTextReason: 'Test', mode: 'READ_DIAGNOSTICS', requestedMinutes: 30 } }),
    );
    expect(await hitOf(ids.session)).toEqual([expect.objectContaining({ kind: 'SUPPORT_SESSION', tenantId, status: 'REQUESTED' })]);

    // Treffer enthalten nie Fachinhalte (Titel, Nutzlast).
    expect(JSON.stringify(await hitOf(ids.staleCase))).not.toContain('Hängender Vorgang');

    // Unbekannt oder kein Kennungsformat: leere Trefferliste – keine Fehlermeldung, die etwas verrät.
    expect(await hitOf(randomUUID())).toEqual([]);
    expect(await hitOf("1'; DROP TABLE cases;--")).toEqual([]);

    const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_DIAGNOSTICS_READ', entityId: ids.staleCase } }));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows[0]!.payload)).toContain('Ticket 4720');
    expect(JSON.stringify(rows[0]!.payload)).toContain('REFERENCE_SEARCH');
  });

  it('die Suche verlangt eine Begründung; wer nicht lesen darf (FinOps, Mandantennutzer, anonym), bekommt weder Zähler noch Treffer', async () => {
    const support = await token(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support2');
    await get(`/diagnostics/search?reference=${ids.staleCase}`, support).expect(400);
    await get(`/diagnostics/search?reference=${ids.staleCase}&reason=zu`, support).expect(400);

    const finops = await token(PLATFORM_ROLES.PLATFORM_FINOPS, 'finops');
    await get('/runtime/work', finops).expect(403);
    await search(finops, ids.staleCase).expect(403);
    await request(app.getHttpServer()).get('/api/v1/platform/runtime/work').expect(401);

    const tenantLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' });
    await get('/runtime/work', tenantLogin.body.accessToken as string).expect(401);
    await search(tenantLogin.body.accessToken as string, ids.staleCase).expect(401);
  });
});
