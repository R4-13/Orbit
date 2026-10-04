import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
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
  let tenantsService: TenantsService;
  let adminToken: string;
  let tenantId: string;
  let scoped: ReturnType<PrismaService['forTenantId']>;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    tenantsService = app.get(TenantsService);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    adminToken = login.body.accessToken as string;
    tenantId = login.body.user.tenantId as string;
    scoped = prisma.forTenantId(tenantId);
  });

  afterEach(async () => {
    // Credential rows now live in a separate vault table (CredentialVaultService,
    // ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_01 §6) — delete them before the
    // Integration rows that reference them, so no orphaned secret rows accumulate
    // in the shared demo tenant across repeated local/CI runs.
    const leftover = await scoped.integration.findMany({
      where: { connectorType: { in: ['DATEV', 'HUBSPOT'] }, credentialReference: { not: null } },
      select: { credentialReference: true },
    });
    const referenceIds = leftover.map((row) => row.credentialReference).filter((id): id is string => id !== null);
    if (referenceIds.length > 0) {
      await scoped.integrationCredentialSecret.deleteMany({ where: { id: { in: referenceIds } } });
    }
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
    expect(created.body).not.toHaveProperty('credentialReference');
    expect(JSON.stringify(created.body)).not.toContain('e2e-super-secret');

    // The Integration row itself holds only an opaque reference — the
    // genuinely-ciphertext bytes live in the separate vault table.
    const row = await scoped.integration.findUniqueOrThrow({
      where: { tenantId_connectorType: { tenantId, connectorType: 'DATEV' } },
    });
    expect(row.credentialReference).not.toBeNull();
    const secretRow = await scoped.integrationCredentialSecret.findUniqueOrThrow({ where: { id: row.credentialReference! } });
    expect(Buffer.from(secretRow.encryptedValue).toString('utf8')).not.toContain('e2e-super-secret');

    const list = await request(app.getHttpServer())
      .get('/api/v1/integrations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('e2e-super-secret');
  });

  it('operational-status reflects real evidence, never just the OAuth/credentials status (docs/CHANNEL_EVENT_RUNTIME_PLAN.md §8)', async () => {
    const unconfigured = await request(app.getHttpServer())
      .get('/api/v1/integrations/DATEV/operational-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(unconfigured.body.highestLevelReached).toBeNull();
    expect(unconfigured.body.currentlyConnected).toBe(false);

    await request(app.getHttpServer())
      .put('/api/v1/integrations/DATEV/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { clientId: 'e2e-status-client' } })
      .expect(200);

    const connected = await request(app.getHttpServer())
      .get('/api/v1/integrations/DATEV/operational-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // Credentials stored successfully -> AUTHENTICATION_CONNECTED, but never
    // further — no ConnectorSync/IntakeEvent exists for this connection, so
    // claiming INPUT_TRIGGER_ACTIVE or beyond would misrepresent reality.
    expect(connected.body.highestLevelReached).toBe('AUTHENTICATION_CONNECTED');
    expect(connected.body.currentlyConnected).toBe(true);
    expect(connected.body.levels.INPUT_TRIGGER_ACTIVE.reached).toBe(false);
  });

  it('overwrites previously stored credentials on a second PUT (upsert)', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/integrations/HUBSPOT/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { apiKey: 'first-key' } })
      .expect(200);
    const firstRow = await scoped.integration.findFirstOrThrow({ where: { connectorType: 'HUBSPOT' } });
    const firstSecret = await scoped.integrationCredentialSecret.findUniqueOrThrow({ where: { id: firstRow.credentialReference! } });

    await request(app.getHttpServer())
      .put('/api/v1/integrations/HUBSPOT/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { apiKey: 'rotated-key' } })
      .expect(200);
    const secondRow = await scoped.integration.findFirstOrThrow({ where: { connectorType: 'HUBSPOT' } });
    const secondSecret = await scoped.integrationCredentialSecret.findUniqueOrThrow({ where: { id: secondRow.credentialReference! } });

    expect(secondRow.id).toBe(firstRow.id); // same Integration row updated, not a duplicate
    expect(secondRow.credentialReference).toBe(firstRow.credentialReference); // same vault secret updated in place, not a new one
    expect(secondSecret.version).toBe(firstSecret.version + 1);
    expect(Buffer.from(secondSecret.encryptedValue).equals(Buffer.from(firstSecret.encryptedValue))).toBe(false);
  });

  it('disconnect clears stored credentials and rejects disconnecting a never-configured connector', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/integrations/DATEV/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { clientId: 'to-be-removed' } })
      .expect(200);
    const connectedRow = await scoped.integration.findFirstOrThrow({ where: { connectorType: 'DATEV' } });
    const secretReference = connectedRow.credentialReference!;

    const disconnected = await request(app.getHttpServer())
      .delete('/api/v1/integrations/DATEV')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(disconnected.body.status).toBe('DISCONNECTED');
    expect(disconnected.body.hasCredentials).toBe(false);

    // The vault secret itself is actually deleted, not just unreferenced —
    // disconnecting is meant to revoke the credential, not leak it indefinitely.
    await expect(scoped.integrationCredentialSecret.findUnique({ where: { id: secretReference } })).resolves.toBeNull();

    await request(app.getHttpServer())
      .delete('/api/v1/integrations/HUBSPOT')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('GET /integrations/connectors lists the static connector catalog (all 7 known connector types)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/integrations/connectors')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toHaveLength(7);
    expect(response.body.map((c: { id: string }) => c.id).sort()).toEqual(
      ['DATEV', 'GMAIL', 'GOOGLE_CALENDAR', 'HUBSPOT', 'LEXWARE', 'MICROSOFT', 'TWILIO'].sort(),
    );
    const gmail = response.body.find((c: { id: string }) => c.id === 'GMAIL');
    expect(gmail).toMatchObject({ provider: 'Google', authentication: { type: 'oauth2' } });
  });

  it('GET /integrations/connectors/:id returns a single connector, 404 for an unknown one', async () => {
    const gmail = await request(app.getHttpServer())
      .get('/api/v1/integrations/connectors/GMAIL')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(gmail.body).toMatchObject({ id: 'GMAIL', category: 'mail' });

    await request(app.getHttpServer())
      .get('/api/v1/integrations/connectors/NOT_A_REAL_CONNECTOR')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400); // ParseEnumPipe rejects it before the registry lookup ever runs
  });

  it('POST /integrations/GMAIL/connect returns a real authorization URL when GOOGLE_CLIENT_ID/SECRET are configured, or an honest 503 (REQUIRES_PROVIDER_CREDENTIALS, §23 des Amendments) when they are not — never a silent fake success either way', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/integrations/GMAIL/connect')
      .set('Authorization', `Bearer ${adminToken}`);

    if (process.env.GOOGLE_CLIENT_ID) {
      expect(response.status).toBe(201);
      expect(response.body.authorizationUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    } else {
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('INTEGRATION_UNAVAILABLE');
    }
  });

  it('POST /integrations/DATEV/connect rejects with 400 — DATEV has no OAuth-capable connector service yet, only the generic credentials PUT', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/integrations/DATEV/connect')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('POST /integrations/GMAIL/test returns { ok: false } (not an error) for a tenant that never connected Gmail', async () => {
    // A fresh, throwaway tenant — not the shared Musterwerk admin tenant used
    // everywhere else in this file. Musterwerk's own Gmail connection state is
    // no longer a safe "never connected" assumption now that a real OAuth
    // connect has legitimately been exercised against it (live verification
    // earlier this session, docs/ASSUMPTIONS.md Channel Event Runtime).
    const suffix = randomUUID();
    const { tenant: freshTenant } = await tenantsService.bootstrapTenant({
      name: `E2E Gmail Test ${suffix}`,
      slug: `e2e-gmail-test-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-gmail-test.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    try {
      const freshLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `admin-${suffix}@e2e-gmail-test.example`, password: 'Musterwerk#2026!' })
        .expect(200);
      const freshToken = freshLogin.body.accessToken as string;

      const response = await request(app.getHttpServer())
        .post('/api/v1/integrations/GMAIL/test')
        .set('Authorization', `Bearer ${freshToken}`)
        .expect(201); // NestJS's default success status for POST without @HttpCode — matches the rest of this controller's un-annotated POST-like mutations
      expect(response.body).toEqual({ ok: false });
    } finally {
      await prisma.tenant.delete({ where: { id: freshTenant.id } }).catch(() => undefined);
    }
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

  /**
   * Proves RLS on the new `integration_credential_secrets` table is actually
   * enforced, not just declared in the migration — this suite's other tests
   * never exercise cross-tenant access (every query already goes through
   * `forTenantId(tenantId)` for the *same* tenant), so they would still pass
   * even if the `ENABLE ROW LEVEL SECURITY` migration had never been applied.
   */
  it("enforces RLS on IntegrationCredentialSecret: a second tenant's scoped client cannot see tenant A's vault row", async () => {
    const created = await request(app.getHttpServer())
      .put('/api/v1/integrations/HUBSPOT/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { apiKey: 'tenant-a-secret' } })
      .expect(200);
    const row = await scoped.integration.findUniqueOrThrow({
      where: { tenantId_connectorType: { tenantId, connectorType: 'HUBSPOT' } },
    });
    expect(created.body.hasCredentials).toBe(true);

    const suffix = randomUUID();
    const { tenant: otherTenant } = await tenantsService.bootstrapTenant({
      name: `E2E RLS Test ${suffix}`,
      slug: `e2e-rls-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-rls.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });

    try {
      const otherTenantScoped = prisma.forTenantId(otherTenant.id);
      await expect(
        otherTenantScoped.integrationCredentialSecret.findUnique({ where: { id: row.credentialReference! } }),
      ).resolves.toBeNull();
    } finally {
      await prisma.tenant.delete({ where: { id: otherTenant.id } }).catch(() => undefined);
    }
  });
});
