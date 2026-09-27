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
});
