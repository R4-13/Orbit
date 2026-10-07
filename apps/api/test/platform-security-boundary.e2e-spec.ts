import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { OrbitEnv } from '@orbit/config';
import { PLATFORM_ROLES, PLATFORM_SCOPES, type PlatformRole } from '@orbit/shared';
import request from 'supertest';
import { ORBIT_ENV } from '../src/config/env.token';
import { PlatformAuditService } from '../src/platform/audit/platform-audit.service';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Amendment 03, Phase OPS-1 — Sicherheitsgrenze der Plattformdomäne (OPR-01…03, OPR-07, OPR-08, OAS-02/03, OPS-01…04, OPS-24).
 * Testet gegen die echte Postgres-Instanz mit RLS (Rolle orbit_app) und das Demo-Mandantenset (Musterwerk).
 */
describe('Platform security boundary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: PlatformAuthService;
  let identities: PlatformIdentityService;
  let env: OrbitEnv;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const created: string[] = [];

  async function makeIdentity(role: PlatformRole, tag = role.toLowerCase().replace('platform_', '')): Promise<{ id: string; email: string; token: string }> {
    const email = `ops1-${suffix}-${tag}@platform-test.example`;
    const identity = await identities.create(null, { email, displayName: `Test ${tag}`, password, roles: [role] });
    created.push(identity.id);
    const tokens = await auth.login(email, password);
    return { id: identity.id, email, token: tokens.accessToken };
  }

  async function tenantToken(email: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Musterwerk#2026!' }).expect(200);
    return response.body.accessToken as string;
  }

  const get = (path: string, token?: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(token ? { Authorization: `Bearer ${token}` } : {});

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    auth = app.get(PlatformAuthService);
    identities = app.get(PlatformIdentityService);
    env = app.get(ORBIT_ENV);
    expect(env.PLATFORM_JWT_SECRET).toBeTruthy();
  });

  afterAll(async () => {
    await prisma.withPlatformScope((tx) => tx.platformUser.deleteMany({ where: { id: { in: created } } }));
    await app.close();
  });

  describe('OPR-01/02 – Mandantenidentitäten erreichen die Plattform nie', () => {
    it('ein Business User und ein Tenant Admin werden an jeder Plattformroute abgewiesen', async () => {
      const viewer = await tenantToken('viewer@musterwerk.example');
      const admin = await tenantToken('admin@musterwerk.example');
      for (const token of [viewer, admin]) {
        for (const path of ['/platform/me', '/platform/overview', '/platform/tenants', '/platform/audit', '/platform/identities']) {
          const response = await get(path, token);
          expect([401, 403]).toContain(response.status);
        }
        await request(app.getHttpServer()).put('/api/v1/platform/identities/some-id/roles').set({ Authorization: `Bearer ${token}` }).send({ roles: ['PLATFORM_OWNER'], reason: 'escalation attempt' }).expect((r) => expect([401, 403]).toContain(r.status));
        await request(app.getHttpServer()).post('/api/v1/platform/identities').set({ Authorization: `Bearer ${token}` }).send({ email: 'x@y.example', displayName: 'X', password, roles: ['PLATFORM_OWNER'] }).expect((r) => expect([401, 403]).toContain(r.status));
      }
    });

    it('ohne Token: 401', async () => {
      await get('/platform/me').expect(401);
    });

    it('ein mit dem Mandanten-Secret signiertes Token, das wie ein Plattform-Token aussieht, wird nicht akzeptiert', async () => {
      const forged = new JwtService({}).sign({ sub: 'x', sid: 'y', dom: 'PLATFORM', env: env.ORBIT_ENVIRONMENT }, { secret: env.JWT_SECRET, audience: 'orbit-platform', issuer: 'orbit', expiresIn: '5m' });
      await get('/platform/me', forged).expect(401);
    });

    it('ein Plattform-Token funktioniert nicht an Mandanten-Endpunkten', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER);
      await get('/auth/me', owner.token).expect(401);
      await get('/cases', owner.token).expect(401);
      await get('/invoices', owner.token).expect(401);
    });
  });

  describe('OPR-03 – keine Rollenvergabe aus dem Mandantenpfad', () => {
    it('die Datenbank verbietet Mandantenrollen mit reserviertem Präfix', async () => {
      const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findFirstOrThrow());
      await expect(
        prisma.withRlsBypass((tx) => tx.role.create({ data: { tenantId: tenant.id, name: 'PLATFORM_OWNER' } })),
      ).rejects.toThrow(/roles_name_not_platform_chk|check constraint/i);
    });

    it('Plattformrollen gibt es nur als Plattform-Zuweisung (DB-Check auf platform_role_assignments)', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_AUDITOR, 'check');
      await expect(
        prisma.withPlatformScope((tx) => tx.platformRoleAssignment.create({ data: { platformUserId: owner.id, role: 'SYSTEM_ADMIN' } })),
      ).rejects.toThrow(/platform_role_assignments_role_chk|check constraint/i);
    });
  });

  describe('Rollen und Scopes (Amendment 03 §2.3)', () => {
    it('Support darf Mandanten und Übersicht lesen, aber keine Identitäten verwalten', async () => {
      const support = await makeIdentity(PLATFORM_ROLES.PLATFORM_SUPPORT);
      await get('/platform/tenants', support.token).expect(200);
      await get('/platform/overview', support.token).expect(200);
      const denied = await get('/platform/identities', support.token).expect(403);
      expect(denied.body.code).toBe('PERMISSION_DENIED');
      expect(denied.body.details.missing).toContain(PLATFORM_SCOPES.IDENTITY_MANAGE);
    });

    it('die Verweigerung wird mit Akteur und Route im Plattform-Audit festgehalten', async () => {
      const support = await makeIdentity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'denied');
      await get('/platform/identities', support.token).expect(403);
      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_ACCESS_DENIED', actorPlatformUserId: support.id } }));
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows[0].payload)).toContain('missing scope');
    });

    it('/platform/me zeigt den serverseitig aufgebauten Kontext, nie ein Client-Feld', async () => {
      const finops = await makeIdentity(PLATFORM_ROLES.PLATFORM_FINOPS);
      const me = await get('/platform/me', finops.token).expect(200);
      expect(me.body.platformRoles).toEqual(['PLATFORM_FINOPS']);
      expect(me.body.platformScopes).toContain(PLATFORM_SCOPES.AI_COST_READ);
      expect(me.body.platformScopes).not.toContain(PLATFORM_SCOPES.IDENTITY_MANAGE);
      expect(me.body.authenticationAssurance).toBe('PASSWORD');
      expect(me.body.environment).toBe(env.ORBIT_ENVIRONMENT);
    });

    it('das Audit ist rollenabhängig: Auditor sieht alles, FinOps nur Kosten-/AI-Ereignisse, Support nur eigene Handlungen', async () => {
      const auditor = await makeIdentity(PLATFORM_ROLES.PLATFORM_AUDITOR);
      const finops = await makeIdentity(PLATFORM_ROLES.PLATFORM_FINOPS, 'finops2');
      const support = await makeIdentity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support2');
      await get('/platform/me', support.token).expect(200);
      const all = await get('/platform/audit?limit=200', auditor.token).expect(200);
      expect(all.body.items.length).toBeGreaterThan(0);
      expect(all.body.items.some((i: { eventType: string }) => i.eventType === 'PLATFORM_IDENTITY_CREATED')).toBe(true);

      const finopsView = await get('/platform/audit?limit=200', finops.token).expect(200);
      for (const item of finopsView.body.items as Array<{ eventType: string }>) expect(item.eventType).toMatch(/^PLATFORM_(AI_|SECRET)/);

      const own = await get('/platform/audit?limit=200', support.token).expect(200);
      for (const item of own.body.items as Array<{ actorUserId: string }>) expect(item.actorUserId).toBe(support.id);
    });
  });

  describe('OPR-07/08 – Sitzung, Ablauf, Umgebung', () => {
    it('Abmelden wirkt sofort: dasselbe Token ist danach ungültig', async () => {
      const operator = await makeIdentity(PLATFORM_ROLES.PLATFORM_OPERATOR);
      await get('/platform/me', operator.token).expect(200);
      await request(app.getHttpServer()).post('/api/v1/platform/auth/logout').set({ Authorization: `Bearer ${operator.token}` }).expect(204);
      await get('/platform/me', operator.token).expect(401);
    });

    it('eine abgelaufene Sitzung wird sofort verweigert, auch bei noch gültigem Token', async () => {
      const operator = await makeIdentity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'expiry');
      await get('/platform/me', operator.token).expect(200);
      await prisma.withPlatformScope((tx) => tx.platformSession.updateMany({ where: { platformUserId: operator.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
      await get('/platform/me', operator.token).expect(401);
    });

    it('ein abgelaufenes Access Token wird verweigert', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER, 'exp2');
      const session = await prisma.withPlatformScope((tx) => tx.platformSession.findFirstOrThrow({ where: { platformUserId: owner.id } }));
      const expired = new JwtService({}).sign({ sub: owner.id, sid: session.id, dom: 'PLATFORM', env: env.ORBIT_ENVIRONMENT }, { secret: env.PLATFORM_JWT_SECRET, audience: 'orbit-platform', issuer: 'orbit', expiresIn: -10 });
      await get('/platform/me', expired).expect(401);
    });

    it('eine Sitzung aus einer fremden Umgebung wird nicht akzeptiert (kein Test-zu-Prod-Durchgriff)', async () => {
      const operator = await makeIdentity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'envx');
      const other = env.ORBIT_ENVIRONMENT === 'production' ? 'staging' : 'production';
      await prisma.withPlatformScope((tx) => tx.platformSession.updateMany({ where: { platformUserId: operator.id }, data: { environment: other } }));
      await get('/platform/me', operator.token).expect(401);
    });

    it('Refresh rotiert: das alte Refresh-Token ist nach Gebrauch wertlos', async () => {
      const email = `ops1-${suffix}-refresh@platform-test.example`;
      const identity = await identities.create(null, { email, displayName: 'Refresh', password, roles: [PLATFORM_ROLES.PLATFORM_AUDITOR] });
      created.push(identity.id);
      const first = await auth.login(email, password);
      const second = await request(app.getHttpServer()).post('/api/v1/platform/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
      expect(second.body.refreshToken).not.toBe(first.refreshToken);
      await request(app.getHttpServer()).post('/api/v1/platform/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
      await get('/platform/me', second.body.accessToken).expect(200);
    });
  });

  describe('Identitätsverwaltung, Step-up und Rollenwechsel', () => {
    it('kritische Operationen verlangen Step-up; ein falsches Passwort gibt kein Erhöhungsfenster', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER, 'stepup');
      const body = { email: `ops1-${suffix}-new@platform-test.example`, displayName: 'Neu', password, roles: [PLATFORM_ROLES.PLATFORM_AUDITOR] };
      const blocked = await request(app.getHttpServer()).post('/api/v1/platform/identities').set({ Authorization: `Bearer ${owner.token}` }).send(body).expect(403);
      expect(blocked.body.code).toBe('STEP_UP_REQUIRED');

      await request(app.getHttpServer()).post('/api/v1/platform/auth/step-up').set({ Authorization: `Bearer ${owner.token}` }).send({ password: 'definitely-wrong-password' }).expect(401);
      await request(app.getHttpServer()).post('/api/v1/platform/identities').set({ Authorization: `Bearer ${owner.token}` }).send(body).expect(403);

      const stepUp = await request(app.getHttpServer()).post('/api/v1/platform/auth/step-up').set({ Authorization: `Bearer ${owner.token}` }).send({ password }).expect(200);
      expect(stepUp.body.authenticationAssurance).toBe('PASSWORD_STEP_UP');
      const createdRes = await request(app.getHttpServer()).post('/api/v1/platform/identities').set({ Authorization: `Bearer ${owner.token}` }).send(body).expect(201);
      created.push(createdRes.body.id);
      expect(createdRes.body.roles).toEqual(['PLATFORM_AUDITOR']);
      expect(JSON.stringify(createdRes.body)).not.toContain(password);
      expect(createdRes.body).not.toHaveProperty('passwordHash');
    });

    it('das Step-up-Fenster läuft ab', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER, 'stepexp');
      await request(app.getHttpServer()).post('/api/v1/platform/auth/step-up').set({ Authorization: `Bearer ${owner.token}` }).send({ password }).expect(200);
      await prisma.withPlatformScope((tx) => tx.platformSession.updateMany({ where: { platformUserId: owner.id }, data: { stepUpUntil: new Date(Date.now() - 1000) } }));
      const blocked = await request(app.getHttpServer()).post('/api/v1/platform/identities').set({ Authorization: `Bearer ${owner.token}` }).send({ email: `ops1-${suffix}-x@platform-test.example`, displayName: 'X', password, roles: [PLATFORM_ROLES.PLATFORM_AUDITOR] }).expect(403);
      expect(blocked.body.code).toBe('STEP_UP_REQUIRED');
    });

    it('Rollen nur aus der Identitätsverwaltung: unbekannte oder Mandantenrollen werden abgelehnt', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER, 'badrole');
      await request(app.getHttpServer()).post('/api/v1/platform/auth/step-up').set({ Authorization: `Bearer ${owner.token}` }).send({ password }).expect(200);
      for (const role of ['SYSTEM_ADMIN', 'TENANT_ADMIN', 'platform_owner', 'PLATFORM_GOD']) {
        await request(app.getHttpServer())
          .post('/api/v1/platform/identities')
          .set({ Authorization: `Bearer ${owner.token}` })
          .send({ email: `ops1-${suffix}-${Math.random().toString(36).slice(2, 7)}@platform-test.example`, displayName: 'Bad', password, roles: [role] })
          .expect(400);
      }
    });

    it('ein Rollenwechsel wirkt sofort: alte Sitzungen sind danach ungültig, das Audit hält Vorher/Nachher fest', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER, 'rolechg');
      const target = await makeIdentity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'target');
      await request(app.getHttpServer()).post('/api/v1/platform/auth/step-up').set({ Authorization: `Bearer ${owner.token}` }).send({ password }).expect(200);
      await get('/platform/overview', target.token).expect(200);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/platform/identities/${target.id}/roles`)
        .set({ Authorization: `Bearer ${owner.token}` })
        .send({ roles: [PLATFORM_ROLES.PLATFORM_AUDITOR], reason: 'Rolle angepasst (Test)' })
        .expect(200);
      expect(res.body.roles).toEqual(['PLATFORM_AUDITOR']);
      await get('/platform/overview', target.token).expect(401);

      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', entityId: target.id, eventType: { in: ['PLATFORM_ROLE_GRANTED', 'PLATFORM_ROLE_REVOKED'] } } }));
      expect(rows.map((r) => r.eventType).sort()).toEqual(['PLATFORM_ROLE_GRANTED', 'PLATFORM_ROLE_REVOKED']);
      expect(JSON.stringify(rows.map((r) => r.payload))).toContain('Rolle angepasst');
      expect(rows.every((r) => r.tenantId === null && r.actorPlatformUserId === owner.id)).toBe(true);
    });

    it('eine deaktivierte Identität kann sich nicht mehr anmelden und ihre Sitzungen enden sofort', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER, 'disabler');
      const victim = await makeIdentity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'victim');
      await request(app.getHttpServer()).post('/api/v1/platform/auth/step-up').set({ Authorization: `Bearer ${owner.token}` }).send({ password }).expect(200);
      await request(app.getHttpServer()).post(`/api/v1/platform/identities/${victim.id}/disable`).set({ Authorization: `Bearer ${owner.token}` }).send({ reason: 'Austritt (Test)' }).expect(200);
      await get('/platform/me', victim.token).expect(401);
      await expect(auth.login(victim.email, password)).rejects.toThrow(/Invalid credentials/);
    });

    it('Passwortwechsel: aktuelles Passwort wird erneut geprüft, Mindestlänge gilt, andere Sitzungen enden sofort, die aktuelle bleibt; altes Passwort ist wertlos; das Audit enthält kein Passwort', async () => {
      const person = await makeIdentity('PLATFORM_SUPPORT', 'pwchange');
      const other = await auth.login(person.email, password); // zweite Sitzung (z. B. ein gestohlenes Token)
      const newPassword = `Neu-${randomBytes(9).toString('base64url')}-7#`;
      const change = (body: Record<string, string>, token = person.token) => request(app.getHttpServer()).post('/api/v1/platform/auth/change-password').set({ Authorization: `Bearer ${token}` }).send(body);

      // Falsches aktuelles Passwort: abgewiesen und auditiert; zu kurz / gleich: abgelehnt, nichts ändert sich.
      await change({ currentPassword: 'falsch-falsch-falsch', newPassword }).expect(401);
      await change({ currentPassword: password, newPassword: 'kurz' }).expect(400);
      await change({ currentPassword: password, newPassword: password }).expect(400);
      await auth.login(person.email, password); // altes Passwort gilt weiterhin

      const ok = await change({ currentPassword: password, newPassword }).expect(200);
      expect(ok.body).toEqual({ revokedOtherSessions: expect.any(Number) });
      expect(ok.body.revokedOtherSessions).toBeGreaterThanOrEqual(1);

      // Die aktuelle Sitzung bleibt, die andere (und jede frühere) endet sofort.
      await get('/platform/me', person.token).expect(200);
      await get('/platform/me', other.accessToken).expect(401);

      // Altes Passwort ist wertlos, das neue gilt.
      await expect(auth.login(person.email, password)).rejects.toThrow();
      await expect(auth.login(person.email, newPassword)).resolves.toBeTruthy();

      // Audit: der Wechsel steht drin, kein Passwort.
      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_PASSWORD_CHANGED', entityId: person.id } }));
      expect(rows).toHaveLength(1);
      const serialized = JSON.stringify(rows);
      for (const secret of [password, newPassword]) expect(serialized).not.toContain(secret);
    });

    it('Anmeldefehler werden auditiert, ohne die E-Mail-Adresse oder das Passwort im Klartext abzulegen', async () => {
      const email = `ops1-${suffix}-ghost@platform-test.example`;
      await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email, password: 'wrong-password-123' }).expect(401);
      const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_LOGIN_FAILED' }, orderBy: { createdAt: 'desc' }, take: 5 }));
      const serialized = JSON.stringify(rows.map((r) => r.payload));
      expect(rows.length).toBeGreaterThan(0);
      expect(serialized).not.toContain(email);
      expect(serialized).not.toContain('wrong-password-123');
    });
  });

  describe('OAS-02/03 – Audit-Unveränderlichkeit und Domänentrennung (RLS)', () => {
    it('Plattform-Audit kann weder geändert noch gelöscht werden – auch nicht mit Plattform-Scope', async () => {
      const row = await prisma.withPlatformScope((tx) => tx.auditLog.findFirstOrThrow({ where: { domain: 'PLATFORM' } }));
      await expect(prisma.withPlatformScope((tx) => tx.auditLog.update({ where: { id: row.id }, data: { eventType: 'TAMPERED' } }))).rejects.toThrow(/immutable/i);
      await expect(prisma.withPlatformScope((tx) => tx.auditLog.delete({ where: { id: row.id } }))).rejects.toThrow(/immutable/i);
      await expect(prisma.withPlatformScope((tx) => tx.auditLog.deleteMany({ where: { id: row.id } }))).rejects.toThrow(/immutable/i);
    });

    it('Mandantencode sieht keine Plattform-Auditzeilen und kann keine anlegen', async () => {
      const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findFirstOrThrow({ where: { slug: 'musterwerk' } }).catch(() => tx.tenant.findFirstOrThrow()));
      const visible = await prisma.forTenantId(tenant.id).auditLog.findMany({ where: { domain: 'PLATFORM' } });
      expect(visible).toEqual([]);
      const viaBypass = await prisma.withRlsBypass((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM' } }));
      expect(viaBypass).toEqual([]);
      await expect(
        prisma.forTenantId(tenant.id).auditLog.create({ data: { tenantId: tenant.id, domain: 'PLATFORM', eventType: 'PLATFORM_LOGIN', actorType: 'SYSTEM' } }),
      ).rejects.toThrow();
    });

    it('Plattformtabellen sind ohne Plattform-Scope leer (Row-Level Security, auch mit Tenant- und Bypass-Scope)', async () => {
      expect(await prisma.platformUser.findMany()).toEqual([]);
      expect(await prisma.withRlsBypass((tx) => tx.platformUser.findMany())).toEqual([]);
      const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findFirstOrThrow());
      expect(await prisma.inTenantTransaction(tenant.id, (tx) => tx.platformSession.findMany())).toEqual([]);
      expect(await prisma.withPlatformScope((tx) => tx.platformUser.count())).toBeGreaterThan(0);
    });

    it('Audit-Snapshots enthalten keine Secrets (Schwärzung vor dem Speichern)', async () => {
      const owner = await makeIdentity(PLATFORM_ROLES.PLATFORM_OWNER, 'redact');
      const audit = app.get(PlatformAuditService);
      await audit.record({ eventType: 'PLATFORM_SECRET_CHANGED', actor: { userId: owner.id, roles: ['PLATFORM_OWNER'] }, targetType: 'Secret', targetId: 'test', before: { apiKey: 'sk-live-aaaaaaaaaaaa', note: 'x' }, after: { apiKey: 'sk-live-bbbbbbbbbbbb', note: 'y', Authorization: 'Bearer abc.def.ghi-jkl' } });
      const row = await prisma.withPlatformScope((tx) => tx.auditLog.findFirstOrThrow({ where: { eventType: 'PLATFORM_SECRET_CHANGED', actorPlatformUserId: owner.id } }));
      const text = JSON.stringify(row.payload);
      expect(text).not.toContain('sk-live');
      expect(text).not.toContain('abc.def');
      expect(text).toContain('[REDACTED]');
      expect((row.payload as { beforeHash: string }).beforeHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('Mandantenregister', () => {
    it('liefert Metadaten und Zähler, keine Geschäftsdaten', async () => {
      const operator = await makeIdentity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'tenants');
      const list = await get('/platform/tenants', operator.token).expect(200);
      expect(list.body.length).toBeGreaterThan(0);
      expect(Object.keys(list.body[0]).sort()).toEqual(['createdAt', 'deletionRequested', 'displayName', 'featureCohorts', 'lifecycleStatus', 'slug', 'suspensionScopes', 'tenantId', 'userCount']);
      const overview = await get('/platform/overview', operator.token).expect(200);
      expect(overview.body.notYetAvailable).toEqual(expect.arrayContaining(['Support-Sessions']));
      expect(overview.body.environment).toBe(env.ORBIT_ENVIRONMENT);
    });
  });
});

