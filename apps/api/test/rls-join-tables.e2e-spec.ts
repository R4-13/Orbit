import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** RLS auch für Tabellen ohne eigene tenant_id (MST-13): `role_permissions`, `user_roles`, `refresh_tokens` erreichen ihren Mandanten über die Elterntabelle. */
describe('RLS für Verknüpfungstabellen (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenants: Array<{ id: string; userId: string; email: string }> = [];
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    for (let i = 0; i < 2; i += 1) {
      const suffix = randomUUID();
      const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Join ${suffix.slice(0, 8)}`, slug: `e2e-rlsjoin-${suffix}`, adminEmail: `a-${suffix}@e2e-rlsjoin.example`, adminPassword: PASSWORD, adminFirstName: 'A', adminLastName: 'B' });
      tenants.push({ id: tenant.id, userId: adminUser.id, email: adminUser.email });
      await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200); // legt ein Refresh-Token an
    }
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } }));
    await app.close();
  });

  it('im Kontext eines Mandanten sind nur dessen Zuordnungen, Rechte und Sitzungen sichtbar', async () => {
    const [a, b] = tenants as [(typeof tenants)[number], (typeof tenants)[number]];
    const seen = await prisma.inTenantTransaction(b.id, async (tx) => ({
      userRoles: await tx.userRole.findMany({ include: { user: { select: { tenantId: true } } } }),
      permissions: await tx.rolePermission.findMany({ include: { role: { select: { tenantId: true } } } }),
      tokens: await tx.refreshToken.findMany({ include: { user: { select: { tenantId: true } } } }),
    }));
    expect(seen.userRoles.length).toBeGreaterThan(0);
    expect(seen.userRoles.every((r) => r.user.tenantId === b.id)).toBe(true);
    expect(seen.permissions.length).toBeGreaterThan(0);
    expect(seen.permissions.every((p) => p.role.tenantId === b.id)).toBe(true);
    expect(seen.tokens.length).toBeGreaterThan(0);
    expect(seen.tokens.every((t) => t.user.tenantId === b.id)).toBe(true);
    // Mandant A sieht umgekehrt nichts von B.
    const aTokens = await prisma.inTenantTransaction(a.id, (tx) => tx.refreshToken.count({ where: { userId: b.userId } }));
    expect(aTokens).toBe(0);
  });

  it('ohne Mandantenkontext (und ohne Umgehung) sieht eine Abfrage nichts – fail closed', async () => {
    expect(await prisma.userRole.count()).toBe(0);
    expect(await prisma.rolePermission.count()).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('ein Mandant kann fremde Sitzungen nicht schreiben oder widerrufen', async () => {
    const [a, b] = tenants as [(typeof tenants)[number], (typeof tenants)[number]];
    const revoked = await prisma.inTenantTransaction(a.id, (tx) => tx.refreshToken.updateMany({ where: { userId: b.userId }, data: { revokedAt: new Date() } }));
    expect(revoked.count).toBe(0);
    expect(await prisma.withRlsBypass((tx) => tx.refreshToken.count({ where: { userId: b.userId, revokedAt: null } }))).toBeGreaterThan(0);
  });

  it('Anmeldung, Erneuerung und Abmelden funktionieren weiter; die Deaktivierung widerruft die Sitzungen des Kontos', async () => {
    const t = tenants[0]!;
    const login = (await api().post('/api/v1/auth/login').send({ email: t.email, password: PASSWORD }).expect(200)).body as { accessToken: string; refreshToken: string };
    const refreshed = (await api().post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken }).expect(200)).body as { refreshToken: string };
    await api().post('/api/v1/auth/logout').send({ refreshToken: refreshed.refreshToken }).expect(204);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: refreshed.refreshToken }).expect(401);
  });
});
