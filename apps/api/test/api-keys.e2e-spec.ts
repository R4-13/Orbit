import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** Zugriffsschlüssel / Dienstzugang (AUT-12): ein Schlüssel kann genau seinen Bereich, nichts sonst; Widerruf wirkt sofort; Klartext nur einmal. */
describe('Zugriffsschlüssel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenants: Array<{ id: string; token: string }> = [];
  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const staffPayload = (externalId: string) => ({ staff: [{ externalId, firstName: 'Sync', lastName: externalId, roleKind: 'OFFICE', email: `${externalId.toLowerCase()}@sync.example` }] });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    for (let i = 0; i < 2; i += 1) {
      const suffix = randomUUID();
      const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Key ${suffix.slice(0, 8)}`, slug: `e2e-keys-${suffix}`, adminEmail: `a-${suffix}@e2e-keys.example`, adminPassword: PASSWORD, adminFirstName: 'A', adminLastName: 'B' });
      const token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
      tenants.push({ id: tenant.id, token });
    }
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } }));
    await app.close();
  });

  it('Anlage zeigt den Schlüssel einmal; die Liste nie – und nur der Hash steht in der Datenbank', async () => {
    const [a] = tenants as [(typeof tenants)[number]];
    const created = (await api().post('/api/v1/tenant/api-keys').set(bearer(a.token)).send({ name: 'Personalverwaltung', scopes: ['staff.sync'] }).expect(201)).body as { id: string; key: string; prefix: string; scopes: string[] };
    expect(created.key.startsWith(`osk_${created.prefix}_`)).toBe(true);
    const listed = (await api().get('/api/v1/tenant/api-keys').set(bearer(a.token)).expect(200)).body as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.key);
    expect(listed[0]).toMatchObject({ name: 'Personalverwaltung', prefix: created.prefix, scopes: ['staff.sync'], revokedAt: null });
    const row = await prisma.withRlsBypass((tx) => tx.apiKey.findUniqueOrThrow({ where: { id: created.id } }));
    expect(row.keyHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect(await prisma.forTenantId(a.id).auditLog.count({ where: { eventType: 'API_KEY_CREATED', entityId: created.id } })).toBe(1);
  });

  it('der Schlüssel gleicht das Mitarbeiterverzeichnis ab (Bearer und X-Api-Key) – und kann sonst nichts', async () => {
    const [a] = tenants as [(typeof tenants)[number]];
    const { key } = (await api().post('/api/v1/tenant/api-keys').set(bearer(a.token)).send({ name: 'Sync zwei', scopes: ['staff.sync'] }).expect(201)).body as { key: string };

    await api().put('/api/v1/staff/sync').set(bearer(key)).send({ ...staffPayload('K-1'), dryRun: true }).expect(200);
    expect(await prisma.forTenantId(a.id).staffMember.count({ where: { externalId: 'K-1' } })).toBe(0); // Probelauf schreibt nichts
    await api().put('/api/v1/staff/sync').set(bearer(key)).send(staffPayload('K-1')).expect(200);
    await api().put('/api/v1/staff/sync').set({ 'X-Api-Key': key }).send(staffPayload('K-2')).expect(200);
    expect(await prisma.forTenantId(a.id).staffMember.count({ where: { externalId: { in: ['K-1', 'K-2'] } } })).toBe(2);

    // Alles andere bleibt zu: Verzeichnis lesen, Schlüssel verwalten, Vorgänge.
    await api().get('/api/v1/staff').set(bearer(key)).expect(401);
    await api().get('/api/v1/tenant/api-keys').set(bearer(key)).expect(401);
    await api().get('/api/v1/cases').set(bearer(key)).expect(401);
  });

  it('ein falscher Schlüssel und ein Schlüssel eines anderen Mandanten wirken nur im eigenen', async () => {
    const [a, b] = tenants as [(typeof tenants)[number], (typeof tenants)[number]];
    await api().put('/api/v1/staff/sync').set(bearer('osk_deadbeef_ungueltig')).send(staffPayload('X-1')).expect(401);
    const { key } = (await api().post('/api/v1/tenant/api-keys').set(bearer(b.token)).send({ name: 'Schlüssel B', scopes: ['staff.sync'] }).expect(201)).body as { key: string };
    await api().put('/api/v1/staff/sync').set(bearer(key)).send(staffPayload('B-1')).expect(200);
    expect(await prisma.forTenantId(a.id).staffMember.count({ where: { externalId: 'B-1' } })).toBe(0);
    expect(await prisma.forTenantId(b.id).staffMember.count({ where: { externalId: 'B-1' } })).toBe(1);
  });

  it('Widerruf wirkt sofort; ein Mandant kann fremde Schlüssel nicht widerrufen; ungültige Bereiche werden abgewiesen', async () => {
    const [a, b] = tenants as [(typeof tenants)[number], (typeof tenants)[number]];
    const created = (await api().post('/api/v1/tenant/api-keys').set(bearer(a.token)).send({ name: 'Wird widerrufen', scopes: ['staff.sync'] }).expect(201)).body as { id: string; key: string };
    await api().put('/api/v1/staff/sync').set(bearer(created.key)).send(staffPayload('R-1')).expect(200);
    await api().delete(`/api/v1/tenant/api-keys/${created.id}`).set(bearer(b.token)).expect(404);
    await api().delete(`/api/v1/tenant/api-keys/${created.id}`).set(bearer(a.token)).expect(200);
    await api().put('/api/v1/staff/sync').set(bearer(created.key)).send(staffPayload('R-2')).expect(401);
    expect(await prisma.forTenantId(a.id).auditLog.count({ where: { eventType: 'API_KEY_REVOKED', entityId: created.id } })).toBe(1);
    await api().post('/api/v1/tenant/api-keys').set(bearer(a.token)).send({ name: 'Zu mächtig', scopes: ['tenant.manage'] }).expect(400);
    await api().post('/api/v1/tenant/api-keys').set(bearer(a.token)).send({ name: 'x', scopes: ['staff.sync'] }).expect(400);
  });

  it('das Konto eines Administrators gleicht weiterhin ohne Schlüssel ab', async () => {
    const [a] = tenants as [(typeof tenants)[number]];
    await api().put('/api/v1/staff/sync').set(bearer(a.token)).send(staffPayload('ADM-1')).expect(200);
  });
});
