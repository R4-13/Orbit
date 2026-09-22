import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * §39/§52 — live against real Postgres. Uses the seeded "Musterwerk GmbH"
 * admin only for auth; every row this suite writes is cleaned up in
 * afterEach so it never leaves connector credentials behind for the
 * shared demo tenant other suites/manual QA rely on (docs/DEMO_DATA.md).
 */
describe('Integrations / credential storage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let tenantId: string;
  let scoped: ReturnType<PrismaService['forTenantId']>;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    adminToken = login.body.accessToken as string;
    tenantId = login.body.user.tenantId as string;
    scoped = prisma.forTenantId(tenantId);
  });

  afterEach(async () => {
    await scoped.integration.deleteMany({ where: { connectorType: { in: ['DATEV', 'HUBSPOT'] } } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores credentials encrypted at rest and never returns them over the API', async () => {
    const created = await request(app.getHttpServer())
      .put('/api/v1/integrations/DATEV/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { clientId: 'e2e-client', clientSecret: 'e2e-super-secret' }, config: { environment: 'sandbox' } })
      .expect(200);

    expect(created.body.status).toBe('CONNECTED');
    expect(created.body.hasCredentials).toBe(true);
    expect(created.body).not.toHaveProperty('encryptedCredentials');
    expect(JSON.stringify(created.body)).not.toContain('e2e-super-secret');

    // The raw stored bytes are genuinely ciphertext, not the plaintext JSON.
    const row = await scoped.integration.findUniqueOrThrow({
      where: { tenantId_connectorType: { tenantId, connectorType: 'DATEV' } },
    });
    expect(row.encryptedCredentials).not.toBeNull();
    expect(Buffer.from(row.encryptedCredentials!).toString('utf8')).not.toContain('e2e-super-secret');

    const list = await request(app.getHttpServer())
      .get('/api/v1/integrations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('e2e-super-secret');
  });

  it('overwrites previously stored credentials on a second PUT (upsert)', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/integrations/HUBSPOT/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { apiKey: 'first-key' } })
      .expect(200);
    const firstRow = await scoped.integration.findFirstOrThrow({ where: { connectorType: 'HUBSPOT' } });

    await request(app.getHttpServer())
      .put('/api/v1/integrations/HUBSPOT/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { apiKey: 'rotated-key' } })
      .expect(200);
    const secondRow = await scoped.integration.findFirstOrThrow({ where: { connectorType: 'HUBSPOT' } });

    expect(secondRow.id).toBe(firstRow.id); // same row updated, not a duplicate
    expect(Buffer.from(secondRow.encryptedCredentials!).equals(Buffer.from(firstRow.encryptedCredentials!))).toBe(false);
  });

  it('disconnect clears stored credentials and rejects disconnecting a never-configured connector', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/integrations/DATEV/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { clientId: 'to-be-removed' } })
      .expect(200);

    const disconnected = await request(app.getHttpServer())
      .delete('/api/v1/integrations/DATEV')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(disconnected.body.status).toBe('DISCONNECTED');
    expect(disconnected.body.hasCredentials).toBe(false);

    await request(app.getHttpServer())
      .delete('/api/v1/integrations/HUBSPOT')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('rejects an unknown connectorType with 400', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/integrations/NOT_A_REAL_CONNECTOR')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('rejects a role without INTEGRATION_CONFIGURE', async () => {
    const financeLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'finance@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/integrations')
      .set('Authorization', `Bearer ${financeLogin.body.accessToken}`)
      .expect(403);
  });
});
