import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retention-Grundlage (docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md, Retention
 * item) — live proof against real Postgres: no policy means unlimited
 * retention (nothing eligible), preview never deletes, apply only removes
 * rows past the configured cutoff, and an in-flight AgentRun is never
 * deleted regardless of age.
 *
 * Fresh throwaway tenant (not the shared Musterwerk tenant) — same
 * rationale as workflow-retry.e2e-spec.ts.
 */
describe('Retention policies (e2e)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;
  let prisma: PrismaService;
  let adminToken: string;
  let tenantId: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    tenantsService = app.get(TenantsService);
    prisma = app.get(PrismaService);

    const suffix = randomUUID();
    const { tenant, adminUser } = await tenantsService.bootstrapTenant({
      name: `E2E Retention Test ${suffix}`,
      slug: `e2e-retention-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-retention.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenantId = tenant.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminUser.email, password: PASSWORD })
      .expect(200);
    adminToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    // Die in diesem Lauf angelegten Mandanten wieder entfernen (frühere Läufe haben sie in der gemeinsamen Datenbank hinterlassen).
    await app.get(PrismaService).withRlsBypass((tx) => tx.tenant.deleteMany({ where: { slug: { startsWith: 'e2e-retention-' } } }));
    await app.close();
  });

  async function seedAgentRun(startedAtDaysAgo: number, status: 'COMPLETED' | 'RUNNING') {
    return prisma.forTenantId(tenantId).agentRun.create({
      data: {
        agentType: 'FINANCE',
        triggerType: 'MANUAL',
        status,
        startedAt: new Date(Date.now() - startedAtDaysAgo * DAY_MS),
        completedAt: status === 'COMPLETED' ? new Date(Date.now() - startedAtDaysAgo * DAY_MS) : null,
      },
    });
  }

  it('GET /retention-policies returns an empty list when nothing has been configured yet', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/retention-policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('GET .../:category/preview 404s when no policy is configured for that category', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/retention-policies/AGENT_RUNS/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('PUT .../:category rejects a retentionDays below the minimum guardrail', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/retention-policies/AGENT_RUNS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ retentionDays: 1 })
      .expect(400);
  });

  it('configures a policy, previews without deleting, then applies and removes only eligible rows', async () => {
    const oldTerminalRun = await seedAgentRun(45, 'COMPLETED');
    const recentTerminalRun = await seedAgentRun(5, 'COMPLETED');
    const oldRunningRun = await seedAgentRun(45, 'RUNNING');

    await request(app.getHttpServer())
      .put('/api/v1/retention-policies/AGENT_RUNS')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ retentionDays: 30 })
      .expect(200)
      .expect((res) => {
        expect(res.body.retentionDays).toBe(30);
      });

    const preview = await request(app.getHttpServer())
      .get('/api/v1/retention-policies/AGENT_RUNS/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(preview.body.matchingCount).toBe(1);

    const stillThere = await prisma.forTenantId(tenantId).agentRun.findUnique({ where: { id: oldTerminalRun.id } });
    expect(stillThere).not.toBeNull();

    const applyResult = await request(app.getHttpServer())
      .post('/api/v1/retention-policies/AGENT_RUNS/apply')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(applyResult.body.deletedCount).toBe(1);

    const [deletedRun, keptRecentRun, keptRunningRun] = await Promise.all([
      prisma.forTenantId(tenantId).agentRun.findUnique({ where: { id: oldTerminalRun.id } }),
      prisma.forTenantId(tenantId).agentRun.findUnique({ where: { id: recentTerminalRun.id } }),
      prisma.forTenantId(tenantId).agentRun.findUnique({ where: { id: oldRunningRun.id } }),
    ]);
    expect(deletedRun).toBeNull();
    expect(keptRecentRun).not.toBeNull();
    expect(keptRunningRun).not.toBeNull();
  });

  it('Nachrichtentexte: nur von abgeschlossenen oder nicht zugeordneten Nachrichten, nur nach der Frist – die Zeile bleibt (BPF-03)', async () => {
    const scoped = prisma.forTenantId(tenantId);
    const old = new Date(Date.now() - 60 * DAY_MS);
    const mk = async (caseStatus: string | null, createdAt: Date) => {
      const c = caseStatus ? await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: `Fall ${randomUUID().slice(0, 4)}`, orchestrationStatus: caseStatus } as never }) : null;
      return scoped.emailMessage.create({ data: { tenantId, caseId: c?.id, direction: 'INBOUND', fromAddress: 'a@x.example', toAddresses: ['b@y.example'], subject: 'Betreff', bodyText: 'Persönlicher Text', bodyPreview: 'Persönlich', createdAt } });
    };
    const done = await mk('COMPLETED', old);
    const open = await mk('IN_PROGRESS', old);
    const loose = await mk(null, old);
    const recent = await mk('COMPLETED', new Date());

    await request(app.getHttpServer()).put('/api/v1/retention-policies/EMAIL_BODIES').set('Authorization', `Bearer ${adminToken}`).send({ retentionDays: 30 }).expect(200);
    const preview = await request(app.getHttpServer()).get('/api/v1/retention-policies/EMAIL_BODIES/preview').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(preview.body.matchingCount).toBe(2);
    const applied = await request(app.getHttpServer()).post('/api/v1/retention-policies/EMAIL_BODIES/apply').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(applied.body.deletedCount).toBe(2);

    const rows = new Map((await scoped.emailMessage.findMany({ where: { id: { in: [done.id, open.id, loose.id, recent.id] } } })).map((r) => [r.id, r]));
    expect(rows.get(done.id)).toMatchObject({ bodyText: null, bodyPreview: null, subject: 'Betreff', fromAddress: 'a@x.example' });
    expect(rows.get(loose.id)).toMatchObject({ bodyText: null, bodyPreview: null });
    expect(rows.get(open.id)?.bodyText).toBe('Persönlicher Text'); // offener Vorgang
    expect(rows.get(recent.id)?.bodyText).toBe('Persönlicher Text'); // innerhalb der Frist
  });

  it('überholte Fakten: nur Altfassungen abgeschlossener Vorgänge; die aktuellen Fakten bleiben (BPF-03)', async () => {
    const scoped = prisma.forTenantId(tenantId);
    const old = new Date(Date.now() - 60 * DAY_MS);
    const done = await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: 'Fakten abgeschlossen', orchestrationStatus: 'COMPLETED' } as never });
    const open = await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: 'Fakten offen', orchestrationStatus: 'IN_PROGRESS' } as never });
    const fact = (caseId: string, isCurrent: boolean) => scoped.caseFact.create({ data: { tenantId, caseId, key: 'request.quantity', value: 5, sourceType: 'EMAIL', status: 'CANDIDATE', isCurrent, createdAt: old } as never });
    const oldDone = await fact(done.id, false);
    const currentDone = await fact(done.id, true);
    const oldOpen = await fact(open.id, false);

    await request(app.getHttpServer()).put('/api/v1/retention-policies/SUPERSEDED_FACTS').set('Authorization', `Bearer ${adminToken}`).send({ retentionDays: 30 }).expect(200);
    const applied = await request(app.getHttpServer()).post('/api/v1/retention-policies/SUPERSEDED_FACTS/apply').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(applied.body.deletedCount).toBe(1);
    expect(await scoped.caseFact.findUnique({ where: { id: oldDone.id } })).toBeNull();
    expect(await scoped.caseFact.findUnique({ where: { id: currentDone.id } })).not.toBeNull();
    expect(await scoped.caseFact.findUnique({ where: { id: oldOpen.id } })).not.toBeNull();
  });
});
