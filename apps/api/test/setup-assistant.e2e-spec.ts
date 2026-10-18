import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SetupAssessment } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** Der Einrichtungsassistent gegen echte Postgres: ein neuer Betrieb wird Schritt für Schritt eingerichtet, und der Assistent zeigt jeweils, was ORBIT damit übernimmt. */
describe('Einrichtungsassistent (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenantIds: string[] = [];
  const api = () => request(app.getHttpServer());

  async function createTenant(label: string) {
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({
      name: `E2E Setup ${label} ${suffix}`,
      slug: `e2e-setup-${label}-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-setup.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenantIds.push(tenant.id);
    const login = await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200);
    return { tenantId: tenant.id, auth: { Authorization: `Bearer ${login.body.accessToken as string}` } };
  }
  const assess = async (auth: { Authorization: string }) => (await api().get('/api/v1/tenant/setup').set(auth).expect(200)).body as SetupAssessment;
  const step = (a: SetupAssessment, key: string) => a.steps.find((s) => s.key === key)!;
  const task = (a: SetupAssessment, key: string) => a.tasks.find((t) => t.key === key)!;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenantIds } } }));
    await app.close();
  });

  it('ohne Anmeldung gibt es nichts; ein Betrieb sieht nur seinen eigenen Stand', async () => {
    await api().get('/api/v1/tenant/setup').expect(401);
  });

  it('ein neuer Betrieb: nichts eingerichtet, ORBIT nimmt noch keine Anfragen entgegen und sagt, warum', async () => {
    const { auth } = await createTenant('neu');
    const a = await assess(auth);
    expect(a.ready).toBe(false);
    expect(a.requiredTotal).toBe(4);
    expect(step(a, 'MAIL').status).toBe('OPEN');
    expect(step(a, 'CALENDAR').required).toBe(false);
    expect(task(a, 'READ_MAIL')).toMatchObject({ state: 'UNAVAILABLE', unlock: { stepKey: 'MAIL' } });
    expect(task(a, 'NOTIFY')).toMatchObject({ state: 'UNAVAILABLE', unlock: { stepKey: 'STAFF' } });
    expect(task(a, 'HANDOFF').detail).toContain('eigenen Kundenverwaltung'); // ohne CRM
  });

  it('Schritt für Schritt: Profil, Mitarbeitende, Postfach, Regeln – danach startklar; der Kalender erweitert, was ORBIT übernimmt', async () => {
    const { tenantId, auth } = await createTenant('schritt');
    const scoped = prisma.forTenantId(tenantId);

    // 1. Profil
    await api()
      .put('/api/v1/tenant/profile')
      .set(auth)
      .send({ industry: 'Heizung und Sanitär', services: ['Heizungswartung', 'Badsanierung'], openingHours: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '08:00', to: '16:00' }] })
      .expect(200);
    let a = await assess(auth);
    expect(step(a, 'PROFILE').status).toBe('DONE');
    expect(task(a, 'ANSWER')).toMatchObject({ state: 'UNAVAILABLE', unlock: { stepKey: 'MAIL' } }); // die Leistungen sind da, nur das Senden fehlt – der Grund ist nicht mehr das Profil

    // 2. Mitarbeitende: eine Leitung mit E-Mail genügt für den Start
    await api().post('/api/v1/staff').set(auth).send({ firstName: 'Frank', lastName: 'Chef', roleKind: 'OWNER', email: 'chef@betrieb.example', preferredChannel: 'EMAIL', responsibilities: ['QUOTES', 'EMERGENCY', 'APPOINTMENTS'] }).expect(201);
    a = await assess(auth);
    expect(step(a, 'STAFF').status).toBe('DONE');
    expect(task(a, 'NOTIFY').state).not.toBe('UNAVAILABLE');

    // 3. Postfach nur zum Lesen: Anfragen kommen an, antworten kann ORBIT noch nicht
    const gmail = await scoped.integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read'] } });
    a = await assess(auth);
    expect(step(a, 'MAIL').status).toBe('PARTIAL');
    expect(task(a, 'READ_MAIL').state).toBe('AUTOMATIC');
    expect(task(a, 'ASK_BACK')).toMatchObject({ state: 'UNAVAILABLE', unlock: { stepKey: 'MAIL' } });

    // ... mit Senden-Erlaubnis
    await scoped.integration.update({ where: { id: gmail.id }, data: { grantedCapabilities: ['email.read', 'email.send'] } });
    a = await assess(auth);
    expect(step(a, 'MAIL').status).toBe('DONE');
    expect(task(a, 'ASK_BACK').state).not.toBe('UNAVAILABLE');
    expect(task(a, 'PROPOSE_SLOTS')).toMatchObject({ state: 'BY_HAND', unlock: { stepKey: 'CALENDAR' } });
    expect(task(a, 'BOOK').state).toBe('BY_HAND');

    // 4. Regeln bewusst wählen → alle Pflichtschritte erledigt
    expect(a.ready).toBe(false);
    await api().post('/api/v1/policies/automation').set(auth).send({ preset: 'BALANCED' }).expect(201);
    a = await assess(auth);
    expect(step(a, 'RULES').status).toBe('DONE');
    expect(a.ready).toBe(true);
    expect(a.requiredDone).toBe(a.requiredTotal);

    // 5. Kalender: erst lesen, dann auch anlegen – ORBIT schlägt zuerst Termine vor, bucht danach
    await scoped.integration.update({ where: { id: gmail.id }, data: { grantedCapabilities: ['email.read', 'email.send', 'calendar.freebusy'] } });
    a = await assess(auth);
    expect(step(a, 'CALENDAR').status).toBe('PARTIAL');
    expect(task(a, 'PROPOSE_SLOTS').state).toBe('AUTOMATIC');
    expect(task(a, 'BOOK').state).toBe('BY_HAND');
    await scoped.integration.update({ where: { id: gmail.id }, data: { grantedCapabilities: ['email.read', 'email.send', 'calendar.freebusy', 'calendar.write'] } });
    a = await assess(auth);
    expect(step(a, 'CALENDAR').status).toBe('DONE');
    expect(['AUTOMATIC', 'WITH_APPROVAL']).toContain(task(a, 'BOOK').state);

    // 6. CRM
    await scoped.integration.create({ data: { tenantId, connectorType: 'HUBSPOT', status: 'CONNECTED', externalAccountDisplayName: 'HubSpot' } });
    a = await assess(auth);
    expect(step(a, 'CRM').status).toBe('DONE');
    expect(task(a, 'HANDOFF').detail).toContain('HubSpot');
    expect(task(a, 'HANDOFF').unlock).toBeUndefined();
  });

  it('eine getrennte Verbindung zählt nicht als verbunden', async () => {
    const { tenantId, auth } = await createTenant('getrennt');
    await prisma.forTenantId(tenantId).integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'DISCONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    const a = await assess(auth);
    expect(step(a, 'MAIL').status).toBe('OPEN');
    expect(task(a, 'READ_MAIL').state).toBe('UNAVAILABLE');
  });

  it('Mandantentrennung: der Stand eines Betriebs ändert sich nicht durch die Einrichtung eines anderen', async () => {
    const one = await createTenant('eins');
    const two = await createTenant('zwei');
    await prisma.forTenantId(one.tenantId).integration.create({ data: { tenantId: one.tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'a@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    expect(step(await assess(one.auth), 'MAIL').status).toBe('DONE');
    expect(step(await assess(two.auth), 'MAIL').status).toBe('OPEN');
  });
});
