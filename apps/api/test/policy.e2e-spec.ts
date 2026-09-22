import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { POLICY_ACTIONS } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * §17/§39 — live against real Postgres. Uses the seeded "Musterwerk GmbH"
 * admin for auth; restores every row it mutates in afterEach so it never
 * leaves the shared demo tenant's policy configuration altered for other
 * suites/manual QA (docs/DEMO_DATA.md).
 */
describe('Policy admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let tenantId: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    adminToken = login.body.accessToken as string;
    tenantId = login.body.user.tenantId as string;
  });

  afterEach(async () => {
    // Restore both actions touched below to their DEFAULT_POLICY_CONFIG values.
    const scoped = prisma.forTenantId(tenantId);
    await scoped.policyConfig.update({
      where: { tenantId_action: { tenantId, action: POLICY_ACTIONS.LEAD_CREATE } },
      data: { mode: 'AUTONOMOUS', updatedByUserId: null },
    });
    await scoped.policyConfig.update({
      where: { tenantId_action: { tenantId, action: POLICY_ACTIONS.SUPPLIER_CREATE } },
      data: { mode: 'REQUIRE_APPROVAL', updatedByUserId: null },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists all 16 configured policy actions for the tenant', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.length).toBeGreaterThanOrEqual(16);
    const leadCreate = response.body.find((row: { action: string }) => row.action === POLICY_ACTIONS.LEAD_CREATE);
    expect(leadCreate.mode).toBe('AUTONOMOUS');
  });

  it('updates an unlocked action and persists the change', async () => {
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/policies/${POLICY_ACTIONS.LEAD_CREATE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'REQUIRE_APPROVAL' })
      .expect(200);
    expect(updated.body.mode).toBe('REQUIRE_APPROVAL');

    const list = await request(app.getHttpServer())
      .get('/api/v1/policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const row = list.body.find((r: { action: string }) => r.action === POLICY_ACTIONS.LEAD_CREATE);
    expect(row.mode).toBe('REQUIRE_APPROVAL');
  });

  it('allows tightening a locked action but rejects relaxing it beyond its default ceiling', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/policies/${POLICY_ACTIONS.SUPPLIER_CREATE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'DISABLED' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/policies/${POLICY_ACTIONS.SUPPLIER_CREATE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'AUTONOMOUS' })
      .expect(403);
  });

  it('always rejects any change to PAYMENT_EXECUTE (hard-locked at DISABLED, §60 non-goal)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/policies/${POLICY_ACTIONS.PAYMENT_EXECUTE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'AUTONOMOUS' })
      .expect(403);
  });

  it('rejects an unknown action with 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/policies/not_a_real_action')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'AUTONOMOUS' })
      .expect(400);
  });

  it('rejects an invalid mode with 400', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/policies/${POLICY_ACTIONS.LEAD_CREATE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'NOT_A_REAL_MODE' })
      .expect(400);
  });

  it('rejects a role without POLICY_MANAGE', async () => {
    const financeLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'finance@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/policies')
      .set('Authorization', `Bearer ${financeLogin.body.accessToken}`)
      .expect(403);
  });
});
