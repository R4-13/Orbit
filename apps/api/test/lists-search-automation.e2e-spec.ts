import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

interface CaseListResponse {
  items: Array<{ title: string; createdAt: string; updatedAt: string }>;
}
interface SearchResultLike {
  type: string;
  href: string;
}

/**
 * Übersichten mit Datum und Sortierung, Absprung aus der Suche auf genau den Treffer und der Automatisierungsgrad – gegen echte Postgres, in einem
 * eigenen Mandanten (die Entwicklungsdaten bleiben unberührt).
 */
describe('Lists, search and automation level (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({
      name: `E2E Lists ${suffix}`,
      slug: `e2e-lists-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-lists.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenantId = tenant.id;
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200);
    token = login.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  describe('Vorgänge: Eingang, Aktualisierung und serverseitige Sortierung', () => {
    const day = 24 * 3_600_000;

    beforeAll(async () => {
      const db = prisma.forTenantId(tenantId);
      const base = Date.now() - 10 * day;
      for (const [index, title] of ['Charlie Anfrage', 'Alpha Anfrage', 'Bravo Anfrage'].entries()) {
        const created = await db.case.create({ data: { tenantId, type: 'GENERAL', title } });
        // Eingang in der Reihenfolge Charlie (älteste) → Alpha → Bravo (neueste)
        await db.case.update({ where: { id: created.id }, data: { createdAt: new Date(base + index * day) } });
      }
    });

    const titles = async (query: string) => ((await request(app.getHttpServer()).get(`/api/v1/cases/overview?filter=ALL${query}`).set(auth()).expect(200)).body as CaseListResponse).items.map((i) => i.title);

    it('jeder Eintrag trägt das Datum seines Eingangs und der letzten Änderung', async () => {
      const body = (await request(app.getHttpServer()).get('/api/v1/cases/overview?filter=ALL').set(auth()).expect(200)).body as CaseListResponse;
      for (const item of body.items) {
        expect(new Date(item.createdAt).getTime()).not.toBeNaN();
        expect(new Date(item.updatedAt).getTime()).not.toBeNaN();
      }
    });

    it('sortiert nach Titel und nach Eingang, in beide Richtungen; ohne Angabe gilt „zuletzt aktualisiert zuerst“', async () => {
      expect(await titles('&sort=title&dir=asc')).toEqual(['Alpha Anfrage', 'Bravo Anfrage', 'Charlie Anfrage']);
      expect(await titles('&sort=title&dir=desc')).toEqual(['Charlie Anfrage', 'Bravo Anfrage', 'Alpha Anfrage']);
      expect(await titles('&sort=createdAt&dir=asc')).toEqual(['Charlie Anfrage', 'Alpha Anfrage', 'Bravo Anfrage']);
      expect(await titles('&sort=createdAt&dir=desc')).toEqual(['Bravo Anfrage', 'Alpha Anfrage', 'Charlie Anfrage']);
      expect((await titles('')).length).toBe(3);
    });

    it('ein unbekannter Sortierschlüssel wird abgewiesen (kein frei wählbares Feld)', async () => {
      await request(app.getHttpServer()).get('/api/v1/cases/overview?filter=ALL&sort=tenantId').set(auth()).expect(400);
      await request(app.getHttpServer()).get('/api/v1/inbox/items?sort=senderRef').set(auth()).expect(400);
      await request(app.getHttpServer()).get('/api/v1/inbox/items?sort=subject&dir=asc').set(auth()).expect(200);
      await request(app.getHttpServer()).get('/api/v1/inbox/items?sort=occurredAt&dir=desc').set(auth()).expect(200);
    });
  });

  describe('Suche: jeder Treffer führt auf genau seinen Eintrag', () => {
    it('Kontakt, Unternehmen und Aufgabe verlinken mit ihrer Kennung, nicht auf die ganze Liste', async () => {
      const db = prisma.forTenantId(tenantId);
      const company = await db.company.create({ data: { tenantId, name: 'Zebra Werke GmbH' } });
      const contact = await db.contact.create({ data: { tenantId, firstName: 'Zebra', lastName: 'Kontakt', email: 'zebra@example.com', companyId: company.id } });
      const task = await db.task.create({ data: { tenantId, title: 'Zebra nachfassen' } });

      const hits = (await request(app.getHttpServer()).get('/api/v1/search?q=zebra').set(auth()).expect(200)).body as SearchResultLike[];
      expect(hits.find((h) => h.type === 'CONTACT')?.href).toBe(`/sales/contacts?focus=${contact.id}`);
      expect(hits.find((h) => h.type === 'COMPANY')?.href).toBe(`/sales/contacts?company=${company.id}`);
      expect(hits.find((h) => h.type === 'TASK')?.href).toBe(`/tasks?focus=${task.id}`);
    });
  });

  describe('Automatisierungsgrad', () => {
    const get = () => request(app.getHttpServer()).get('/api/v1/policies/automation').set(auth());
    const apply = (preset: string) => request(app.getHttpServer()).post('/api/v1/policies/automation').set(auth()).send({ preset });
    const modeOf = async (action: string) => (await prisma.forTenantId(tenantId).policyConfig.findUnique({ where: { tenantId_action: { tenantId, action } } }))?.mode;

    it('ein neuer Mandant steht auf „Vorsichtig“; jede Stufe nennt, was sie gegenüber heute ändert', async () => {
      const body = (await get().expect(200)).body as { current: string; presets: Array<{ key: string; changes: Array<{ action: string; to: string }> }> };
      expect(body.current).toBe('CAUTIOUS');
      expect(body.presets.map((p) => p.key)).toEqual(['CAUTIOUS', 'BALANCED', 'HIGH']);
      expect(body.presets[0]!.changes).toEqual([]);
      expect(body.presets[1]!.changes).toEqual([{ action: 'email.send.clarification', from: 'REQUIRE_APPROVAL', to: 'AUTONOMOUS' }]);
    });

    it('„Ausgewogen“ lässt Rückfragen selbstständig hinausgehen, Angebote bleiben freigabepflichtig', async () => {
      const result = (await apply('BALANCED').expect(201)).body as { current: string; changed: number };
      expect(result).toEqual({ current: 'BALANCED', changed: 1 });
      expect(await modeOf('email.send.clarification')).toBe('AUTONOMOUS');
      expect(await modeOf('email.send.quote_delivery')).toBe('REQUIRE_APPROVAL');
      expect(((await get().expect(200)).body as { current: string }).current).toBe('BALANCED');
    });

    it('„Hochautomatisiert“ lockert viel, aber nie eine gesperrte Aktion (neuer Lieferant, Bankdaten, Zahlung)', async () => {
      await apply('HIGH').expect(201);
      expect(await modeOf('followup.send')).toBe('AUTONOMOUS');
      expect(await modeOf('email.send.quote_delivery')).toBe('AUTONOMOUS');
      expect(await modeOf('supplier.create')).toBe('REQUIRE_APPROVAL');
      expect(await modeOf('supplier.bank_details.change')).toBe('REQUIRE_APPROVAL');
      expect(await modeOf('payment.execute')).toBe('DISABLED');
      expect(((await get().expect(200)).body as { current: string }).current).toBe('HIGH');
    });

    it('eine einzelne abweichende Regel macht daraus „Individuell“; „Vorsichtig“ stellt alles zurück; jede Änderung ist im Audit', async () => {
      await request(app.getHttpServer()).patch('/api/v1/policies/meeting.create').set(auth()).send({ mode: 'REQUIRE_APPROVAL' }).expect(200);
      expect(((await get().expect(200)).body as { current: string }).current).toBe('CUSTOM');
      await apply('CAUTIOUS').expect(201);
      expect(((await get().expect(200)).body as { current: string }).current).toBe('CAUTIOUS');
      expect(await modeOf('email.send.clarification')).toBe('REQUIRE_APPROVAL');

      const audits = await prisma.forTenantId(tenantId).auditLog.count({ where: { eventType: 'POLICY_CONFIG_UPDATED' } });
      expect(audits).toBeGreaterThanOrEqual(6);
    });

    it('unbekannte Stufe → 400; ohne Anmeldung → 401', async () => {
      await apply('YOLO').expect(400);
      await request(app.getHttpServer()).post('/api/v1/policies/automation').send({ preset: 'HIGH' }).expect(401);
    });
  });
});
