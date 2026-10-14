import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { CustomerDirectory, CustomerLookupResult } from '@orbit/integration-core';
import request from 'supertest';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { AttentionService } from '../src/organization/attention.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CUSTOMER_DIRECTORIES } from '../src/process/customer/customer-directory';
import { CustomerRecordService, RECHECK_DELAYS_MS, recheckDelayMs, splitDisplayName } from '../src/process/customer/customer-record.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';
const MIN = 60_000;

/** Ein „führendes System“ (CRM/ERP), das der Test steuert: erreichbar oder nicht, mit oder ohne Eintrag. ORBIT darf dort nicht schreiben. */
class FakeLeadingSystem implements CustomerDirectory {
  readonly systemKey = 'FAKE_ERP';
  readonly label = 'Test-ERP';
  readonly canCreate = false;
  available = true;
  known = new Set<string>();
  async lookup({ email }: { tenantId: string; email: string }): Promise<CustomerLookupResult> {
    if (!this.available) throw new Error('ERP antwortet nicht');
    return this.known.has(email) ? { outcome: 'FOUND', matches: [{ externalId: `K-${email}`, displayName: 'Bekannt', email }] } : { outcome: 'NOT_FOUND', matches: [] };
  }
}

describe('Customer record: look up, create or ask, re-check (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: CustomerRecordService;
  let attention: AttentionService;
  let tenantId: string;
  let token: string;
  let directories: CustomerDirectory[];
  let original: CustomerDirectory[];
  let sent: OutboundMessage[] = [];
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const db = () => prisma.forTenantId(tenantId);

  const makeCase = (title = `Anfrage ${randomUUID().slice(0, 6)}`) => db().case.create({ data: { tenantId, type: 'SALES', title, orchestrationStatus: 'IN_PROGRESS' } as never });
  const watchOf = (caseId: string) => db().customerRecordWatch.findUnique({ where: { caseId } });
  const tasksOf = (caseId: string) => db().task.findMany({ where: { tenantId, caseId } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    service = app.get(CustomerRecordService);
    attention = app.get(AttentionService);
    directories = app.get<CustomerDirectory[]>(CUSTOMER_DIRECTORIES);
    original = [...directories];
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_t, message) => {
      sent.push(message);
      return { providerMessageId: 'x', from: 'betrieb@test.example', executionMode: 'LIVE' };
    });
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `E2E Customer ${suffix}`, slug: `e2e-customer-${suffix}`, adminEmail: `admin-${suffix}@e2e-customer.example`, adminPassword: PASSWORD, adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenantId = tenant.id;
    token = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
    await request(app.getHttpServer()).post('/api/v1/staff').set(auth()).send({ externalId: 'S-1', firstName: 'Sven', lastName: 'Vertrieb', roleKind: 'SALES', email: 'sven@betrieb.test', responsibilities: ['QUOTES'] }).expect(201);
  });

  afterAll(async () => {
    directories.splice(0, directories.length, ...original);
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  beforeEach(() => {
    sent = [];
    directories.splice(0, directories.length, ...original);
  });

  describe('Hilfsfunktionen', () => {
    it('Namen werden nur aufgeteilt, wenn Vor- und Nachname erkennbar sind – nichts wird geraten', () => {
      expect(splitDisplayName('Anna Beispiel')).toEqual({ firstName: 'Anna', lastName: 'Beispiel' });
      expect(splitDisplayName('Anna Maria von Beispiel')).toEqual({ firstName: 'Anna Maria von', lastName: 'Beispiel' });
      expect(splitDisplayName('Beispiel, Anna')).toEqual({ firstName: 'Anna', lastName: 'Beispiel' });
      expect(splitDisplayName('Anna')).toBeUndefined();
      expect(splitDisplayName('anna@kunde.example')).toBeUndefined();
      expect(splitDisplayName(null)).toBeUndefined();
    });
    it('die Wiederholungsprüfung wird seltener und bleibt begrenzt', () => {
      expect([1, 2, 3, 4, 9].map(recheckDelayMs)).toEqual([RECHECK_DELAYS_MS[0], RECHECK_DELAYS_MS[1], RECHECK_DELAYS_MS[2], RECHECK_DELAYS_MS[3], RECHECK_DELAYS_MS[3]]);
    });
  });

  describe('Kleiner Betrieb: ORBITs eigene Kontakte sind der Kundenstamm', () => {
    it('ein unbekannter Absender mit vollständigem Namen wird von ORBIT angelegt – und beim nächsten Mal als bekannt gefunden', async () => {
      const c = await makeCase();
      const state = await service.observe(tenantId, c.id, { email: 'Anna.Beispiel@Kunde.example', displayName: 'Anna Beispiel' });
      expect(state).toMatchObject({ status: 'FOUND', system: 'ORBIT_CONTACTS', origin: 'CREATED_BY_ORBIT' });
      expect(await db().contact.findFirst({ where: { tenantId, email: 'anna.beispiel@kunde.example' } })).toMatchObject({ firstName: 'Anna', lastName: 'Beispiel' });
      expect(await tasksOf(c.id)).toHaveLength(0);
      const events = await db().caseEvent.findMany({ where: { caseId: c.id, type: 'customer.record_checked' } });
      expect(events).toHaveLength(1);

      const second = await makeCase();
      expect(await service.observe(tenantId, second.id, { email: 'anna.beispiel@kunde.example', displayName: 'Anna B.' })).toMatchObject({ status: 'FOUND', origin: 'EXISTING' });
      expect(await db().contact.count({ where: { tenantId, email: 'anna.beispiel@kunde.example' } })).toBe(1); // keine Dublette
    });

    it('ohne erkennbaren Namen legt ORBIT nichts an: eine Aufgabe bittet einen Menschen – und ORBIT merkt selbst, wenn der Eintrag später da ist', async () => {
      const c = await makeCase();
      const state = await service.observe(tenantId, c.id, { email: 'unbekannt@kunde.example', displayName: null });
      expect(state).toMatchObject({ status: 'NOT_FOUND' });
      expect(state.reason).toContain('kein vollständiger Name');
      expect(await db().contact.count({ where: { tenantId, email: 'unbekannt@kunde.example' } })).toBe(0);
      const tasks = await tasksOf(c.id);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe('Kunden anlegen: unbekannt@kunde.example');

      // Zu früh: keine Prüfung. Nach 11 Minuten: geprüft, noch nicht da.
      expect((await service.sweep(new Date(Date.now() + 5 * MIN))).checked).toBe(0);
      const early = await service.sweep(new Date(Date.now() + 11 * MIN));
      expect(early.found).toBe(0);
      expect((await watchOf(c.id))!.checks).toBeGreaterThanOrEqual(2);

      // Ein Mensch legt den Kontakt an (Kontakte-Seite): der nächste Takt findet ihn, ohne dass jemand antworten musste.
      await request(app.getHttpServer()).post('/api/v1/contacts').set(auth()).send({ firstName: 'Uwe', lastName: 'Unbekannt', email: 'unbekannt@kunde.example' }).expect(201);
      const later = await service.sweep(new Date(Date.now() + 60 * MIN));
      expect(later.found).toBeGreaterThanOrEqual(1);
      expect(await watchOf(c.id)).toMatchObject({ status: 'FOUND', origin: 'CREATED_BY_HUMAN', nextCheckAt: null });
      expect(await tasksOf(c.id)).toHaveLength(1); // keine zweite Aufgabe
    });

    it('verlangen die Regeln eine Freigabe für neue Kontakte, legt ORBIT nichts an und bittet einen Menschen', async () => {
      await request(app.getHttpServer()).patch('/api/v1/policies/crm.contact.manage').set(auth()).send({ mode: 'REQUIRE_APPROVAL' }).expect(200);
      try {
        const c = await makeCase();
        const state = await service.observe(tenantId, c.id, { email: 'regel@kunde.example', displayName: 'Rita Regel' });
        expect(state.status).toBe('NOT_FOUND');
        expect(state.reason).toContain('Regeln');
        expect(await db().contact.count({ where: { tenantId, email: 'regel@kunde.example' } })).toBe(0);
        expect(await tasksOf(c.id)).toHaveLength(1);
      } finally {
        await request(app.getHttpServer()).patch('/api/v1/policies/crm.contact.manage').set(auth()).send({ mode: 'AUTONOMOUS' }).expect(200);
      }
    });
  });

  describe('Größerer Betrieb: ein führendes System (CRM/ERP), in das ORBIT nicht schreibt', () => {
    it('ist das System nicht erreichbar, ist das Ergebnis „nicht erreichbar“ – nicht „unbekannt“; nichts wird angelegt', async () => {
      const erp = new FakeLeadingSystem();
      erp.available = false;
      directories.splice(0, directories.length, erp);
      const c = await makeCase();
      const state = await service.observe(tenantId, c.id, { email: 'neu@kunde.example', displayName: 'Nina Neu' });
      expect(state.status).toBe('UNAVAILABLE');
      expect(state.reason).toContain('ERP antwortet nicht');
      expect(await db().contact.count({ where: { tenantId, email: 'neu@kunde.example' } })).toBe(0);
      expect(await tasksOf(c.id)).toHaveLength(0); // kein „bitte anlegen“, solange nicht einmal klar ist, ob er fehlt
    });

    it('sobald das System wieder antwortet, wird neu geprüft: kennt es den Kunden, ist der Fall erledigt', async () => {
      const erp = new FakeLeadingSystem();
      erp.available = false;
      directories.splice(0, directories.length, erp);
      const c = await makeCase();
      await service.observe(tenantId, c.id, { email: 'spaeter@kunde.example', displayName: 'Sam Später' });
      erp.available = true;
      erp.known.add('spaeter@kunde.example');
      await service.sweep(new Date(Date.now() + 11 * MIN));
      expect(await watchOf(c.id)).toMatchObject({ status: 'FOUND', system: 'FAKE_ERP', externalId: 'K-spaeter@kunde.example' });
    });

    it('fehlt der Kunde im führenden System, bittet ORBIT einen Menschen, ihn dort anzulegen – es schreibt nicht daneben in die eigenen Kontakte', async () => {
      const erp = new FakeLeadingSystem();
      directories.splice(0, directories.length, erp);
      const c = await makeCase();
      const state = await service.observe(tenantId, c.id, { email: 'fehlt@kunde.example', displayName: 'Fred Fehlt' });
      expect(state.status).toBe('NOT_FOUND');
      expect(state.reason).toContain('nicht selbst schreibt');
      expect(await db().contact.count({ where: { tenantId, email: 'fehlt@kunde.example' } })).toBe(0);
      expect((await tasksOf(c.id))[0]!.description).toContain('Bitte den Kunden dort anlegen');

      // Ein Mensch legt ihn im ERP an – ORBIT findet ihn beim nächsten Takt.
      erp.known.add('fehlt@kunde.example');
      await service.sweep(new Date(Date.now() + 11 * MIN));
      expect(await watchOf(c.id)).toMatchObject({ status: 'FOUND', origin: 'CREATED_BY_HUMAN' });
    });

    it('die Wiederholungsabstände wachsen: 10, 30, 60, dann alle 120 Minuten', async () => {
      const erp = new FakeLeadingSystem();
      directories.splice(0, directories.length, erp);
      const c = await makeCase();
      const base = Date.now();
      await service.observe(tenantId, c.id, { email: 'abstand@kunde.example', displayName: 'Ada Abstand' });
      const gaps: number[] = [];
      let clock = base;
      for (let i = 0; i < 5; i += 1) {
        const w = (await watchOf(c.id))!;
        gaps.push(Math.round((w.nextCheckAt!.getTime() - w.lastCheckedAt.getTime()) / MIN));
        clock = w.nextCheckAt!.getTime() + 1000;
        await service.sweep(new Date(clock));
      }
      expect(gaps).toEqual([10, 30, 60, 120, 120]);
    });
  });

  describe('Menschen informieren und eskalieren, wenn nichts passiert', () => {
    it('ein fehlender Kundeneintrag meldet sich bei der zuständigen Person, erinnert und löst sich, sobald der Eintrag da ist', async () => {
      const erp = new FakeLeadingSystem();
      directories.splice(0, directories.length, erp);
      const c = await makeCase('Anfrage Fensterbau');
      await service.observe(tenantId, c.id, { email: 'melden@kunde.example', displayName: 'Mia Melden' });

      const t0 = new Date();
      const first = await attention.syncTenant(tenantId, t0);
      expect(first.opened).toBeGreaterThanOrEqual(1);
      const item = await db().attentionItem.findFirst({ where: { tenantId, caseId: c.id } });
      expect(item).toMatchObject({ kind: 'CUSTOMER_RECORD_MISSING', responsibility: 'QUOTES', state: 'OPEN' });
      // Haben sich vorher mehrere Vorgänge angesammelt, kommt die erste Meldung in einer Zusammenfassung (AUT-05): der Vorgang steht dann im Text statt im Betreff.
      const mail = sent.find((m) => m.subject.includes('Anfrage Fensterbau') || m.bodyText.includes('Anfrage Fensterbau'));
      expect(mail?.to).toBe('sven@betrieb.test');
      expect(mail?.bodyText).toContain('braucht einen Kundeneintrag');
      expect(mail?.bodyText).toContain('Mia Melden');

      sent = [];
      await attention.syncTenant(tenantId, new Date(t0.getTime() + 5 * 60 * MIN));
      expect(sent.some((m) => m.subject.startsWith('Erinnerung:') && m.to === 'sven@betrieb.test')).toBe(true);

      erp.known.add('melden@kunde.example');
      await service.sweep(new Date(t0.getTime() + 6 * 60 * MIN));
      const result = await attention.syncTenant(tenantId, new Date(t0.getTime() + 6 * 60 * MIN));
      expect(result.resolved).toBeGreaterThanOrEqual(1);
      expect((await db().attentionItem.findUnique({ where: { id: item!.id } }))!.state).toBe('RESOLVED');
    });
  });
});
