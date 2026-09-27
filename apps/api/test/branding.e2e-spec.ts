import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/**
 * §5-6/§27/§35 der UI/UX-Spezifikation ("Tenant/Company Branding and CI
 * Theming") — live gegen echte Postgres: fehlende Zeile = Default-Theme,
 * Speichern/Lesen/Zurücksetzen, Tenant-Isolation (die zweite Kern-
 * Akzeptanzanforderung aus §35: "Tenant A branding can never appear for
 * Tenant B").
 */
describe('Tenant branding (e2e)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    tenantsService = app.get(TenantsService);

    const suffixA = randomUUID();
    const { adminUser: adminA } = await tenantsService.bootstrapTenant({
      name: `E2E Branding Test A ${suffixA}`,
      slug: `e2e-branding-a-${suffixA}`,
      adminEmail: `admin-${suffixA}@e2e-branding-a.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminA.email, password: PASSWORD })
      .expect(200);
    tokenA = loginA.body.accessToken as string;

    const suffixB = randomUUID();
    const { adminUser: adminB } = await tenantsService.bootstrapTenant({
      name: `E2E Branding Test B ${suffixB}`,
      slug: `e2e-branding-b-${suffixB}`,
      adminEmail: `admin-${suffixB}@e2e-branding-b.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminB.email, password: PASSWORD })
      .expect(200);
    tokenB = loginB.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET returns null when no branding is configured', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tenant/branding')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body).toEqual({ branding: null });
  });

  it('rejects an invalid hex color with 400', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/tenant/branding')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ primaryColor: 'not-a-color' })
      .expect(400);
  });

  it('saves branding and returns it on the next GET', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/tenant/branding')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ companyDisplayName: 'ACME GmbH', primaryColor: '#1d4ed8', primaryForeground: '#ffffff' })
      .expect(200)
      .expect((res) => {
        expect(res.body.companyDisplayName).toBe('ACME GmbH');
        expect(res.body.primaryColor).toBe('#1d4ed8');
      });

    const response = await request(app.getHttpServer())
      .get('/api/v1/tenant/branding')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body.branding.companyDisplayName).toBe('ACME GmbH');
  });

  it("Tenant B never sees Tenant A's branding", async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tenant/branding')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(response.body).toEqual({ branding: null });
  });

  it('DELETE resets branding back to null with an empty 204 (no JSON body to parse)', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/tenant/branding')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);

    const response = await request(app.getHttpServer())
      .get('/api/v1/tenant/branding')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body).toEqual({ branding: null });
  });

  it('rejects PUT without TENANT_BRANDING_CONFIGURE-carrying auth', async () => {
    await request(app.getHttpServer()).put('/api/v1/tenant/branding').send({ companyDisplayName: 'x' }).expect(401);
  });
});
