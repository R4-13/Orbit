import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ORBIT_ENV } from '../src/config/env.token';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const START = 'Start#Passwort2026';
const NEW = 'Mein-eigenes-Passwort-2026!';

/** Startpasswort (AUT-13): bis zum ersten Wechsel ist nur Passwortwechsel, Kontoabfrage und Abmelden möglich. */
describe('Erzwungener Passwortwechsel bei Startpasswort (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let email: string;
  let refreshToken: string;
  let accessToken: string;
  const api = () => request(app.getHttpServer());
  const auth = (token = accessToken) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    email = `admin-${suffix}@e2e-pw.example`;
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `PW ${suffix.slice(0, 8)}`, slug: `e2e-pw-${suffix}`, adminEmail: email, adminPassword: START, adminFirstName: 'A', adminLastName: 'B', requirePasswordChange: true });
    tenantId = tenant.id;
    const login = (await api().post('/api/v1/auth/login').send({ email, password: START }).expect(200)).body as { accessToken: string; refreshToken: string; user: { passwordChangeRequired?: boolean } };
    accessToken = login.accessToken;
    refreshToken = login.refreshToken;
    expect(login.user.passwordChangeRequired).toBe(true);
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  it('sperrt alles außer Kontoabfrage mit PASSWORD_CHANGE_REQUIRED', async () => {
    const blocked = await api().get('/api/v1/cases').set(auth()).expect(403);
    expect(blocked.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    await api().get('/api/v1/auth/me').set(auth()).expect(200);
  });

  it('lehnt ein falsches Startpasswort, ein zu kurzes und ein unverändertes neues Passwort ab', async () => {
    await api().post('/api/v1/auth/change-password').set(auth()).send({ currentPassword: 'falsch-falsch-falsch', newPassword: NEW }).expect(401);
    await api().post('/api/v1/auth/change-password').set(auth()).send({ currentPassword: START, newPassword: 'kurz' }).expect(400);
    await api().post('/api/v1/auth/change-password').set(auth()).send({ currentPassword: START, newPassword: START }).expect(400);
  });

  it('der Wechsel liefert neue, uneingeschränkte Tokens, beendet die alten Sitzungen und schaltet das Konto frei', async () => {
    const changed = (await api().post('/api/v1/auth/change-password').set(auth()).send({ currentPassword: START, newPassword: NEW }).expect(200)).body as { accessToken: string; user: { passwordChangeRequired?: boolean } };
    expect(changed.user.passwordChangeRequired).toBeUndefined();
    await api().get('/api/v1/cases').set(auth(changed.accessToken)).expect(200);
    await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401); // die alte Sitzung ist beendet
    await api().post('/api/v1/auth/login').send({ email, password: START }).expect(401);
    const again = (await api().post('/api/v1/auth/login').send({ email, password: NEW }).expect(200)).body as { user: { passwordChangeRequired?: boolean } };
    expect(again.user.passwordChangeRequired).toBeUndefined();
    const audit = await prisma.forTenantId(tenantId).auditLog.count({ where: { eventType: 'USER_PASSWORD_CHANGED' } });
    expect(audit).toBe(1);
  });

  it('ein früher benutztes Passwort wird nicht wieder vergeben (Verlauf, PLT-07)', async () => {
    const token = (await api().post('/api/v1/auth/login').send({ email, password: NEW }).expect(200)).body.accessToken as string;
    // START wurde beim Wechsel in den Verlauf aufgenommen.
    const rejected = await api().post('/api/v1/auth/change-password').set(auth(token)).send({ currentPassword: NEW, newPassword: START }).expect(400);
    expect(JSON.stringify(rejected.body)).toContain('früher schon verwendet');
    const row = await prisma.withRlsBypass((tx) => tx.user.findFirstOrThrow({ where: { email } }));
    expect(row.passwordHistory).toHaveLength(1);
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
    // Ein wirklich neues Passwort geht, und beide früheren sind danach gesperrt.
    const third = 'Drittes-Passwort-2026!!';
    const changed = (await api().post('/api/v1/auth/change-password').set(auth(token)).send({ currentPassword: NEW, newPassword: third }).expect(200)).body as { accessToken: string };
    await api().post('/api/v1/auth/change-password').set(auth(changed.accessToken)).send({ currentPassword: third, newPassword: NEW }).expect(400);
    const after = await prisma.withRlsBypass((tx) => tx.user.findFirstOrThrow({ where: { email } }));
    expect(after.passwordHistory).toHaveLength(2);
  });

  it('ein abgelaufenes Passwort verlangt beim Anmelden den Wechsel – bis zu diesem ist nur das Nötigste erlaubt (Ablauf, PLT-07)', async () => {
    const env = app.get<{ PASSWORD_MAX_AGE_DAYS: number }>(ORBIT_ENV);
    const previous = env.PASSWORD_MAX_AGE_DAYS;
    env.PASSWORD_MAX_AGE_DAYS = 90;
    try {
      const current = 'Drittes-Passwort-2026!!';
      const fresh = (await api().post('/api/v1/auth/login').send({ email, password: current }).expect(200)).body as { accessToken: string; user: { passwordChangeRequired?: boolean } };
      expect(fresh.user.passwordChangeRequired).toBeUndefined(); // eben erst geändert
      await prisma.withRlsBypass((tx) => tx.user.updateMany({ where: { email }, data: { passwordChangedAt: new Date(Date.now() - 100 * 24 * 3_600_000) } }));
      const stale = (await api().post('/api/v1/auth/login').send({ email, password: current }).expect(200)).body as { accessToken: string; user: { passwordChangeRequired?: boolean } };
      expect(stale.user.passwordChangeRequired).toBe(true);
      expect((await api().get('/api/v1/cases').set(auth(stale.accessToken)).expect(403)).body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      await api().get('/api/v1/auth/me').set(auth(stale.accessToken)).expect(200);
      // Nach dem Wechsel ist das Konto wieder frei.
      const renewed = (await api().post('/api/v1/auth/change-password').set(auth(stale.accessToken)).send({ currentPassword: current, newPassword: 'Viertes-Passwort-2026!!' }).expect(200)).body as { accessToken: string };
      await api().get('/api/v1/cases').set(auth(renewed.accessToken)).expect(200);
    } finally {
      env.PASSWORD_MAX_AGE_DAYS = previous;
    }
  });

  it('ein normal angelegtes Konto (ohne Startpasswort) ist nicht eingeschränkt', async () => {
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `PW2 ${suffix.slice(0, 8)}`, slug: `e2e-pw-${suffix}`, adminEmail: `a-${suffix}@e2e-pw.example`, adminPassword: START, adminFirstName: 'A', adminLastName: 'B' });
    const token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: START }).expect(200)).body.accessToken as string;
    await api().get('/api/v1/cases').set(auth(token)).expect(200);
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenant.id } }));
  });
});
