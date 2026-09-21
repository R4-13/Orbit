import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Exercises real login/permission enforcement against the live Postgres
 * instance, using the seeded "Musterwerk GmbH" demo tenant (Phase 13,
 * packages/domain/prisma/seed.ts) as fixture data. Run `pnpm prisma:seed`
 * before this suite (see docs/DEMO_DATA.md); a fresh `pnpm prisma:deploy`
 * without seeding leaves these tests failing on 401 for every demo login.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in a seeded demo user and returns a JWT with the correct role/permissions', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'finance@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({
      email: 'finance@musterwerk.example',
      roles: ['FINANCE_USER'],
    });
    expect(response.body.user.permissions).toEqual(expect.arrayContaining(['invoice.read', 'booking.create']));
  });

  it('rejects a wrong password with 401 and no user-enumeration hint', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'finance@musterwerk.example', password: 'not-the-real-password' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@musterwerk.example', password: 'irrelevant' })
      .expect(401);

    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('rejects a malformed login body with 400 (ValidationPipe)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);
  });

  it('rejects a protected route with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
  });

  it('rejects a protected route with a garbage bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tasks')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  it('enforces per-role permissions: FINANCE_USER cannot manage suppliers', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'finance@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Sollte nie angelegt werden GmbH' })
      .expect(403);
  });

  it('lets an APPROVER manage suppliers (has SUPPLIER_MANAGE)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'approval@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/suppliers')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
  });
});
