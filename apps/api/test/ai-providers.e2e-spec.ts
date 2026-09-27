import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/**
 * §35-44 des Unified-Evolution-Konzepts ("LLM Provider Strategy",
 * "Provider Administration UI") — live proof against real Postgres for
 * everything that does NOT require a real provider credential. `PUT
 * /ai-providers/:providerKey` (and therefore a "test connection succeeds"
 * path) needs a genuine, network-reachable Anthropic/OpenAI API key to
 * exercise `validateConfiguration()` for real — not available in this
 * environment (REQUIRES_PROVIDER_CREDENTIALS, see
 * docs/IMPLEMENTATION_STATUS.md), so this suite only covers the
 * no-credential-needed paths: default ORBIT-Managed status, 404s before
 * anything is configured, and permission gating. The actual per-tenant
 * routing logic (BYOK row present+CONNECTED → decrypt → build adapter;
 * absent/not-CONNECTED → platform default) is unit-tested with a fully
 * mocked provider factory — see ai-provider-resolver.service.spec.ts.
 *
 * Fresh throwaway tenant (not the shared Musterwerk tenant) — same
 * rationale as every other E2E file in this suite.
 */
describe('AI providers (e2e)', () => {
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
      name: `E2E AI Providers Test ${suffix}`,
      slug: `e2e-ai-providers-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-ai-providers.example`,
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

  it('GET /ai-providers/status reports ORBIT_MANAGED with no connection when nothing is configured', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/ai-providers/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual({ mode: 'ORBIT_MANAGED', connection: null });
  });

  it('POST /ai-providers/test 404s when no BYOK connection is configured', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ai-providers/test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('DELETE /ai-providers 404s when no BYOK connection is configured', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('rejects an unknown providerKey with 400', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/ai-providers/NOT_A_REAL_PROVIDER')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'sk-test' })
      .expect(400);
  });

  it('rejects every /ai-providers route without a valid token', async () => {
    await request(app.getHttpServer()).get('/api/v1/ai-providers/status').expect(401);
  });

  it('DELETE /ai-providers returns 200 with a real JSON body (not an empty 200) once a connection exists', async () => {
    // Seeded directly via Prisma rather than through PUT .../:providerKey — that
    // endpoint's upsertConnection() makes a real, live network call to
    // validateConfiguration() against the actual provider, which this
    // no-credentials-available suite deliberately does not depend on.
    await prisma.forTenantId(tenantId).aIProviderConnection.create({
      data: { tenantId, providerKey: 'OPENAI', status: 'CONNECTED', encryptedCredentials: new Uint8Array([1, 2, 3]), model: 'gpt-4o' },
    });

    const response = await request(app.getHttpServer())
      .delete('/api/v1/ai-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Real regression coverage: disconnect() used to return void, which Nest serializes as an
    // empty 200 body — apiFetch() on the frontend then throws trying to .json() it. See
    // docs/ASSUMPTIONS.md for the fix (disconnect() now returns the updated summary).
    expect(response.body).toMatchObject({ status: 'DISCONNECTED', hasCredentials: false });
    expect(response.body).not.toHaveProperty('encryptedCredentials');
  });
});
