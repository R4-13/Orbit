import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SimulatedTriageScenario } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/** Amendment 02 §19.2/§19.3/§17.2 — the "Kein Geschäftsprozess ausgelöst" view, the audited override, permissions and tenant isolation. */
describe('Intake decisions API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  const tenants: string[] = [];
  const PASSWORD = 'Musterwerk#2026!';

  async function tenantWithAdmin() {
    const suffix = randomUUID();
    const adminEmail = `admin-${suffix}@e2e-decisions.example`;
    const { tenant } = await tenantsService.bootstrapTenant({
      name: `E2E Decisions ${suffix}`,
      slug: `e2e-decisions-${suffix}`,
      adminEmail,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenants.push(tenant.id);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password: PASSWORD }).expect(200);
    return { tenantId: tenant.id, token: login.body.accessToken as string };
  }

  async function simulate(token: string, scenario: SimulatedTriageScenario, subject: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fromAddress: `absender-${randomUUID()}@e2e.example`,
        toAddresses: ['info@e2e.example'],
        subject,
        bodyText: 'Inhalt.',
        simulatedTriageScenario: scenario,
      })
      .expect(201);
    return response.body.intakeEventId as string;
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    tenantsService = app.get(TenantsService);
  });

  afterAll(async () => {
    for (const tenantId of tenants) {
      await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    }
    await app.close();
  });

  it('lists deliberately excluded inputs separately — each with the reason, confidence, execution mode and the explicit action "Keine"', async () => {
    const { token } = await tenantWithAdmin();
    await simulate(token, 'NEWSLETTER', 'Newsletter Oktober');
    await simulate(token, 'REQUEST_FOR_QUOTE', 'Anfrage Angebot');
    await simulate(token, 'UNCERTAIN', 'Unklar');

    const excluded = await request(app.getHttpServer()).get('/api/v1/intake-decisions?view=EXCLUDED').set('Authorization', `Bearer ${token}`).expect(200);
    expect(excluded.body).toHaveLength(1);
    expect(excluded.body[0]).toMatchObject({
      subject: 'Newsletter Oktober',
      appliedRelevance: 'NON_ACTIONABLE',
      action: 'Keine',
      category: 'NEWSLETTER_OR_MARKETING',
      execution: { mode: 'SIMULATED', provider: 'mock' },
    });
    expect(excluded.body[0].conciseReason).toBeTruthy();

    const review = await request(app.getHttpServer()).get('/api/v1/intake-decisions?view=REVIEW').set('Authorization', `Bearer ${token}`).expect(200);
    expect(review.body.map((d: { subject: string }) => d.subject)).toEqual(['Unklar']); // uncertain inputs stay visible, in their own view
    expect(review.body[0].action).toBe('Prüfung erforderlich');

    const all = await request(app.getHttpServer()).get('/api/v1/intake-decisions?view=ALL').set('Authorization', `Bearer ${token}`).expect(200);
    expect(all.body).toHaveLength(3);
  });

  it('"Als geschäftsrelevant prüfen" is an audited, idempotent override: previous verdict kept, visible review task, nothing deleted, no process started', async () => {
    const { tenantId, token } = await tenantWithAdmin();
    const intakeEventId = await simulate(token, 'PRIVATE', 'Falsch aussortiert');
    const decisionId = (await prisma.forTenantId(tenantId).intakeDecision.findUniqueOrThrow({ where: { intakeEventId } })).id;

    const first = await request(app.getHttpServer())
      .post(`/api/v1/intake-decisions/${decisionId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Das ist ein Kunde.' })
      .expect(200);
    expect(first.body).toMatchObject({
      status: 'OVERRIDDEN',
      appliedRelevance: 'UNKNOWN_REQUIRES_REVIEW',
      action: 'Prüfung erforderlich',
      reviewed: { previousRelevance: 'PRIVATE_PERSONAL', note: 'Das ist ein Kunde.' },
    });

    const scoped = prisma.forTenantId(tenantId);
    expect((await scoped.intakeEvent.findUniqueOrThrow({ where: { id: intakeEventId } })).status).toBe('NEEDS_REVIEW');
    expect(await scoped.task.count({ where: { title: { contains: 'Falsch aussortiert' } } })).toBe(1);
    expect(await scoped.case.count()).toBe(0); // reviewing does not start a business process by itself
    const audit = await scoped.auditLog.findMany({ where: { eventType: 'INTAKE_DECISION_OVERRIDDEN' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload).toMatchObject({ previousRelevance: 'PRIVATE_PERSONAL', note: 'Das ist ein Kunde.' });
    expect(audit[0]?.actorUserId).toBeTruthy();

    await request(app.getHttpServer()).post(`/api/v1/intake-decisions/${decisionId}/review`).set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(await scoped.task.count({ where: { title: { contains: 'Falsch aussortiert' } } })).toBe(1); // second click: still one task
    expect(await scoped.auditLog.count({ where: { eventType: 'INTAKE_DECISION_OVERRIDDEN' } })).toBe(1);
  });

  it('refuses to "review" an input that was never excluded (a uncertain or business input has nothing to reopen)', async () => {
    const { tenantId, token } = await tenantWithAdmin();
    const intakeEventId = await simulate(token, 'UNCERTAIN', 'Schon in Prüfung');
    const decisionId = (await prisma.forTenantId(tenantId).intakeDecision.findUniqueOrThrow({ where: { intakeEventId } })).id;

    await request(app.getHttpServer()).post(`/api/v1/intake-decisions/${decisionId}/review`).set('Authorization', `Bearer ${token}`).send({}).expect(400);
  });

  it('enforces permissions server-side: a viewer may read decisions but not override them', async () => {
    const { tenantId, token } = await tenantWithAdmin();
    const intakeEventId = await simulate(token, 'NEWSLETTER', 'Nur lesen');
    const decisionId = (await prisma.forTenantId(tenantId).intakeDecision.findUniqueOrThrow({ where: { intakeEventId } })).id;

    // Demo viewer of the shared Musterwerk tenant: has case.read but not case.manage.
    const viewer = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@musterwerk.example', password: PASSWORD })
      .expect(200);
    const viewerToken = viewer.body.accessToken as string;
    await request(app.getHttpServer()).get('/api/v1/intake-decisions').set('Authorization', `Bearer ${viewerToken}`).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/intake-decisions/${decisionId}/review`).set('Authorization', `Bearer ${viewerToken}`).send({}).expect(403);
    await request(app.getHttpServer()).get('/api/v1/intake-decisions').expect(401);
  });

  it("tenant A cannot read or override tenant B's decisions", async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    const eventA = await simulate(a.token, 'NEWSLETTER', 'Geheim A');
    const decisionA = (await prisma.forTenantId(a.tenantId).intakeDecision.findUniqueOrThrow({ where: { intakeEventId: eventA } })).id;

    const listB = await request(app.getHttpServer()).get('/api/v1/intake-decisions?view=ALL').set('Authorization', `Bearer ${b.token}`).expect(200);
    expect(JSON.stringify(listB.body)).not.toContain('Geheim A');
    await request(app.getHttpServer()).get(`/api/v1/intake-decisions/${decisionA}`).set('Authorization', `Bearer ${b.token}`).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/intake-decisions/${decisionA}/review`).set('Authorization', `Bearer ${b.token}`).send({}).expect(404);
  });
});
