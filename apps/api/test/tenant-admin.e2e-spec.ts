import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { ROLES } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/**
 * §52 (Datenschutz) — end-to-end against real Postgres, using a fresh,
 * throwaway tenant per test (never the seeded "Musterwerk GmbH" demo
 * tenant, see docs/DEMO_DATA.md) so that the deletion tests' irreversible
 * step never touches anything a manual QA session or another suite relies
 * on. Same rationale as the other workflow e2e suites (Phase 14): live
 * against the real stack, not a mocked Prisma.
 */
describe('Tenant admin / DSGVO workflow (e2e)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;
  let prisma: PrismaService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    tenantsService = app.get(TenantsService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Tests that exercise the deletion workflow itself clean up after
    // themselves; the others (export, deactivate, self-deactivate-reject)
    // never delete their throwaway tenant — do that here instead of
    // leaving it to accumulate across repeated local runs, the way
    // `pnpm prisma:seed` cleans up the shared "musterwerk" demo tenant.
    for (const tenantId of createdTenantIds) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await app.close();
  });

  /**
   * bootstrapTenant() only assigns the new admin the TENANT_ADMIN role,
   * which deliberately excludes TENANT_MANAGE (see permissions.ts) — grant
   * the tenant's own SYSTEM_ADMIN role too so the returned token can
   * exercise the TENANT_MANAGE-gated endpoints under test here.
   */
  async function bootstrapThrowawayTenant() {
    const suffix = randomUUID();
    const { tenant, adminUser } = await tenantsService.bootstrapTenant({
      name: `E2E DSGVO Test ${suffix}`,
      slug: `e2e-dsgvo-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-dsgvo.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });

    const scoped = prisma.forTenantId(tenant.id);
    const systemAdminRole = await scoped.role.findFirstOrThrow({
      where: { name: ROLES.SYSTEM_ADMIN },
    });
    await scoped.userRole.create({ data: { userId: adminUser.id, roleId: systemAdminRole.id } });
    createdTenantIds.push(tenant.id);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminUser.email, password: PASSWORD })
      .expect(200);

    return { tenant, adminUser, token: login.body.accessToken as string };
  }

  it('exports the tenant as a single JSON bundle', async () => {
    const { tenant, token } = await bootstrapThrowawayTenant();

    const response = await request(app.getHttpServer())
      .get('/api/v1/tenants/me/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.tenant.id).toBe(tenant.id);
    expect(response.body.users).toHaveLength(1);
    expect(response.body.users[0]).not.toHaveProperty('passwordHash');
    expect(response.body.exportedAt).toEqual(expect.any(String));
  });

  it('deactivates a second user and immediately revokes their refresh tokens', async () => {
    const { tenant, token } = await bootstrapThrowawayTenant();

    const passwordHash = await argon2.hash(PASSWORD);
    const secondUser = await prisma.forTenantId(tenant.id).user.create({
      data: {
        email: `second-${randomUUID()}@e2e-dsgvo.example`,
        passwordHash,
        firstName: 'Second',
        lastName: 'User',
        status: 'ACTIVE',
      },
    });

    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: secondUser.email, password: PASSWORD })
      .expect(200);
    const secondRefreshToken = secondLogin.body.refreshToken as string;

    const deactivated = await request(app.getHttpServer())
      .patch(`/api/v1/users/${secondUser.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(deactivated.body.status).toBe('DEACTIVATED');

    // The refresh token issued before deactivation must no longer work —
    // deactivation revokes existing sessions, not just future logins.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: secondRefreshToken })
      .expect(401);

    // Deactivated accounts can no longer log in at all.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: secondUser.email, password: PASSWORD })
      .expect(401);
  });

  it('rejects deactivating your own account', async () => {
    const { adminUser, token } = await bootstrapThrowawayTenant();

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${adminUser.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('requires a prior deletion request before confirming, supports cancelling, and actually removes the tenant on confirm', async () => {
    const { tenant, token } = await bootstrapThrowawayTenant();

    // Step 2 without step 1 is rejected.
    await request(app.getHttpServer())
      .post('/api/v1/tenants/me/deletion-confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    // Step 1: request.
    const requested = await request(app.getHttpServer())
      .post('/api/v1/tenants/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(requested.body.deletionRequestedAt).toEqual(expect.any(String));

    // The request can be cancelled — the tenant survives untouched.
    await request(app.getHttpServer())
      .delete('/api/v1/tenants/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(stillThere).not.toBeNull();

    // Request again, then actually confirm — this is the irreversible step.
    await request(app.getHttpServer())
      .post('/api/v1/tenants/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const confirmed = await request(app.getHttpServer())
      .post('/api/v1/tenants/me/deletion-confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(confirmed.body.tenantId).toBe(tenant.id);

    // The tenant row (and everything cascaded from it) is genuinely gone.
    const gone = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(gone).toBeNull();
    const usersGone = await prisma.forTenantId(tenant.id).user.findMany({});
    expect(usersGone).toHaveLength(0);
  });
});
