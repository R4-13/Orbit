import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PLATFORM_ROLES, type PlatformRole } from '@orbit/shared';
import request from 'supertest';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

interface Provisioned {
  tenant: { tenantId: string; slug: string; displayName: string; userCount: number };
  adminEmail: string;
  temporaryPassword: string;
}
interface ProfileBody {
  profile: { industry: string | null } | null;
  automation: string;
  onboarding: { steps: Array<{ key: string; done: boolean }> };
}

/** Neukunde anlegen über die Plattform: Branche, Automatisierungsstufe und erster Administrator, mit Step-up, Begründung und Audit – gegen echte Postgres. */
describe('Platform: provision a new customer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const platformUsers: string[] = [];
  const tenantIds: string[] = [];
  const tokens: Record<string, string> = {};

  const provision = (token: string, body: Record<string, unknown>) => request(app.getHttpServer()).post('/api/v1/platform/tenants').set({ Authorization: `Bearer ${token}` }).send(body);
  const base = (over: Record<string, unknown> = {}) => ({
    name: `Dachdeckerei Müller & Söhne ${suffix}`,
    industry: 'Dachdecker',
    automationPreset: 'HIGH',
    adminEmail: `chef-${suffix}@kunde-test.example`,
    adminFirstName: 'Clara',
    adminLastName: 'Müller',
    reason: 'Neukunde aus dem Vertrieb (Test)',
    ...over,
  });

  async function identity(role: PlatformRole, tag: string, stepUp: boolean): Promise<string> {
    const email = `prov-${suffix}-${tag}@platform-test.example`;
    const created = await app.get(PlatformIdentityService).create(null, { email, displayName: tag, password, roles: [role] });
    platformUsers.push(created.id);
    const token = (await app.get(PlatformAuthService).login(email, password)).accessToken;
    if (stepUp) {
      const auth = app.get(PlatformAuthService);
      await auth.stepUp(await auth.authenticate(token), password);
    }
    return token;
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    tokens.operator = await identity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'operator', true);
    tokens.operatorNoStepUp = await identity(PLATFORM_ROLES.PLATFORM_OPERATOR, 'nostep', false);
    tokens.support = await identity(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support', true);
  });

  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenantIds } } }));
    await prisma.withPlatformScope(async (tx) => {
      await tx.platformSession.deleteMany({ where: { platformUserId: { in: platformUsers } } });
      await tx.platformRoleAssignment.deleteMany({ where: { platformUserId: { in: platformUsers } } });
      await tx.platformUser.deleteMany({ where: { id: { in: platformUsers } } });
    });
    await app.close();
  });

  let created: Provisioned;

  it('legt Betrieb, Branche, Automatisierungsstufe und ersten Administrator an; das Startpasswort funktioniert', async () => {
    const response = await provision(tokens.operator!, base()).expect(201);
    created = response.body as Provisioned;
    tenantIds.push(created.tenant.tenantId);
    expect(created.tenant).toMatchObject({ slug: `dachdeckerei-muller-sohne-${suffix}`, userCount: 1 });
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(20);

    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: created.adminEmail, password: created.temporaryPassword }).expect(200);
    const state = (await request(app.getHttpServer()).get('/api/v1/tenant/profile').set({ Authorization: `Bearer ${login.body.accessToken as string}` }).expect(200)).body as ProfileBody;
    expect(state.profile?.industry).toBe('Dachdecker');
    expect(state.automation).toBe('HIGH');
    expect(state.onboarding.steps.filter((s) => s.done).map((s) => s.key)).toEqual(expect.arrayContaining(['INDUSTRY', 'AUTOMATION']));
  });

  it('die Aktion steht im Audit mit Begründung, Branche und Stufe – aber ohne Passwort und ohne E-Mail-Adresse', async () => {
    const rows = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { eventType: 'PLATFORM_TENANT_PROVISIONED', targetTenantId: created.tenant.tenantId } }));
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows[0]!.payload);
    expect(text).toContain('Neukunde aus dem Vertrieb');
    expect(text).toContain('Dachdecker');
    expect(text).not.toContain(created.temporaryPassword);
    expect(text).not.toContain(created.adminEmail);
  });

  it('ein zweiter Betrieb mit gleichem Namen erhält eine freie Kennung; eine ausdrücklich gewählte vergebene Kennung wird abgewiesen', async () => {
    const second = (await provision(tokens.operator!, base({ adminEmail: `zweiter-${suffix}@kunde-test.example` })).expect(201)).body as Provisioned;
    tenantIds.push(second.tenant.tenantId);
    expect(second.tenant.slug).toBe(`dachdeckerei-muller-sohne-${suffix}-2`);
    const clash = await provision(tokens.operator!, base({ slug: created.tenant.slug, adminEmail: `dritter-${suffix}@kunde-test.example` })).expect(400);
    expect(clash.body.message).toContain('schon vergeben');
  });

  it('eine bereits verwendete Administrator-Adresse wird abgewiesen, ohne dass ein halber Betrieb entsteht', async () => {
    const before = (await prisma.withRlsBypass((tx) => tx.tenant.count()));
    const response = await provision(tokens.operator!, base({ name: `Anderer Betrieb ${suffix}`, adminEmail: created.adminEmail })).expect(400);
    expect(response.body.message).toContain('E-Mail-Adresse');
    expect(await prisma.withRlsBypass((tx) => tx.tenant.count())).toBe(before);
  });

  it('ungültige Angaben werden abgewiesen (Stufe, Begründung, Kennung)', async () => {
    await provision(tokens.operator!, base({ automationPreset: 'ALLES' })).expect(400);
    await provision(tokens.operator!, base({ reason: 'x' })).expect(400);
    await provision(tokens.operator!, base({ slug: 'Falsche Kennung!' })).expect(400);
  });

  it('verlangt Step-up und die Berechtigung zur Mandantenverwaltung', async () => {
    const noStep = await provision(tokens.operatorNoStepUp!, base({ adminEmail: `x1-${suffix}@kunde-test.example` })).expect(403);
    expect(noStep.body.code).toBe('STEP_UP_REQUIRED');
    await provision(tokens.support!, base({ adminEmail: `x2-${suffix}@kunde-test.example` })).expect(403);
    await request(app.getHttpServer()).post('/api/v1/platform/tenants').send(base()).expect(401);
  });
});
