import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ExternalSystemError } from '@orbit/shared';
import request from 'supertest';
import { ContactsService } from '../src/contacts/contacts.service';
import { ExecutionEvidenceService } from '../src/intake/execution-evidence.service';
import { LeadsService } from '../src/leads/leads.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CustomerRecordService } from '../src/process/customer/customer-record.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

interface HubCall {
  method: string;
  path: string;
  key: string;
  body?: Record<string, unknown>;
}

/**
 * HubSpot-Anbindung je Betrieb (Service-Schlüssel, nachgebaute HubSpot-Schnittstelle – der Test erreicht HubSpot nie): Schlüssel wird vor dem Speichern geprüft und liegt
 * verschlüsselt im Tresor, Kontakte/Anfragen gehen nur bei verbundenem Betrieb dorthin, ein Ausfall weicht nie auf die Test-Ablage aus, das Kundenverzeichnis kennt HubSpot als
 * „nicht erreichbar“ statt „nicht gefunden“.
 */
describe('HubSpot-Anbindung (e2e, nachgebaute Schnittstelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenants: Array<{ id: string; token: string }> = [];
  const hubCalls: HubCall[] = [];
  /** Das, was die nachgebaute Schnittstelle gerade antwortet. */
  const hub = {
    scopesMissing: new Set<string>(),
    rejectKey: false,
    down: false,
    contacts: new Map<string, string>(), // E-Mail → Kennung
    nextId: 1000,
  };
  const realFetch = globalThis.fetch;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    for (let i = 0; i < 2; i += 1) {
      const suffix = randomUUID();
      const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Hub ${suffix.slice(0, 8)}`, slug: `e2e-hub-${suffix}`, adminEmail: `a-${suffix}@e2e-hub.example`, adminPassword: PASSWORD, adminFirstName: 'Hanna', adminLastName: 'Hub' });
      const token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
      tenants.push({ id: tenant.id, token });
    }
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.hubapi.com')) return realFetch(input, init);
      const path = url.replace('https://api.hubapi.com', '');
      const method = init?.method ?? 'GET';
      const key = String((init?.headers as Record<string, string>).Authorization ?? '').replace('Bearer ', '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      hubCalls.push({ method, path, key, body });
      if (hub.rejectKey) return json(401, { category: 'INVALID_AUTHENTICATION', message: 'abgelehnt' });
      if (hub.down) return json(503, { message: 'Dienst nicht verfügbar' });
      const objectOf = /\/crm\/v3\/objects\/(contacts|companies|deals|notes)/.exec(path)?.[1];
      if (objectOf && hub.scopesMissing.has(objectOf)) return json(403, { category: 'MISSING_SCOPES' });
      if (method === 'GET' && path.startsWith('/crm/v3/objects/')) return json(200, { results: [] });
      if (method === 'GET' && path === '/crm/v3/pipelines/deals') return json(200, { results: [{ id: 'default', displayOrder: 0, stages: [{ id: 'erste', displayOrder: 0 }] }] });
      if (method === 'POST' && path === '/crm/v3/objects/contacts/search') {
        const email = ((body?.filterGroups as Array<{ filters: Array<{ value: string }> }>)[0]?.filters[0]?.value ?? '').toLowerCase();
        const id = hub.contacts.get(email);
        return json(200, { total: id ? 1 : 0, results: id ? [{ id, properties: { email, firstname: 'Bekannt', lastname: 'Kunde' } }] : [] });
      }
      if (method === 'POST' && path === '/crm/v3/objects/contacts') {
        const email = String((body?.properties as Record<string, string>).email ?? '');
        const id = String(hub.nextId++);
        if (email) hub.contacts.set(email, id);
        return json(201, { id, properties: {} });
      }
      if (method === 'POST' && path === '/crm/v3/objects/companies/search') return json(200, { results: [] });
      if (method === 'POST') return json(201, { id: String(hub.nextId++), properties: {} });
      return json(200, {});
    });
  });

  beforeEach(() => {
    hubCalls.length = 0;
    hub.scopesMissing.clear();
    hub.rejectKey = false;
    hub.down = false;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } }));
    await app.close();
  });

  const [a, b] = [0, 1].map((i) => () => tenants[i] as (typeof tenants)[number]);
  const connectA = (key = 'pat-eu1-schluessel-a') => api().put('/api/v1/integrations/HUBSPOT/credentials').set(bearer((a() as { token: string }).token)).send({ credentials: { serviceKey: key } });

  it('der Schlüssel wird vor dem Speichern geprüft: fehlende Berechtigung und abgelehnter Schlüssel verbinden nichts', async () => {
    hub.scopesMissing.add('companies');
    const missing = await connectA().expect(400);
    expect(JSON.stringify(missing.body)).toContain('Unternehmen');
    hub.scopesMissing.clear();
    hub.rejectKey = true;
    expect(JSON.stringify((await connectA().expect(400)).body)).toContain('abgelehnt');
    await api().put('/api/v1/integrations/HUBSPOT/credentials').set(bearer(a().token)).send({ credentials: { serviceKey: 'kurz' } }).expect(400);
    expect(await prisma.forTenantId(a().id).integration.count({ where: { connectorType: 'HUBSPOT' } })).toBe(0); // nichts gespeichert, nichts „verbunden“
  });

  it('ein gültiger Schlüssel verbindet; er liegt verschlüsselt im Tresor, nie im Klartext in der Datenbank oder in Antworten', async () => {
    const res = await connectA().expect(200);
    expect(res.body).toMatchObject({ connectorType: 'HUBSPOT', status: 'CONNECTED' });
    expect(JSON.stringify(res.body)).not.toContain('pat-eu1-schluessel-a');
    const row = await prisma.forTenantId(a().id).integration.findUniqueOrThrow({ where: { tenantId_connectorType: { tenantId: a().id, connectorType: 'HUBSPOT' } } });
    expect(JSON.stringify(row)).not.toContain('pat-eu1-schluessel-a');
    const secret = await prisma.forTenantId(a().id).integrationCredentialSecret.findUniqueOrThrow({ where: { id: row.credentialReference as string } });
    expect(Buffer.from(secret.encryptedValue).toString('utf8')).not.toContain('pat-eu1-schluessel-a');
    // Die Prüfung ging mit genau diesem Schlüssel an HubSpot (lesend).
    expect(hubCalls.every((c) => c.method === 'GET' && c.key === 'pat-eu1-schluessel-a')).toBe(true);
    // Der andere Betrieb sieht davon nichts.
    expect(await prisma.forTenantId(b().id).integration.count({ where: { connectorType: 'HUBSPOT' } })).toBe(0);
  });

  it('der Verbindungstest meldet den Zustand ehrlich; ein abgelehnter Schlüssel setzt die Verbindung auf „Anmeldung erforderlich“', async () => {
    const ok = (await api().post('/api/v1/integrations/HUBSPOT/test').set(bearer(a().token)).expect(201)).body as { ok: boolean };
    expect(ok.ok).toBe(true);
    hub.rejectKey = true;
    const failed = (await api().post('/api/v1/integrations/HUBSPOT/test').set(bearer(a().token)).expect(201)).body as { ok: boolean; message: string };
    expect(failed).toMatchObject({ ok: false });
    expect(failed.message).toContain('abgelehnt');
    const row = await prisma.forTenantId(a().id).integration.findUniqueOrThrow({ where: { tenantId_connectorType: { tenantId: a().id, connectorType: 'HUBSPOT' } } });
    expect(row.status).toBe('AUTH_REQUIRED');
    expect(row.lastErrorCode).toBe('KEY_REJECTED');
    hub.rejectKey = false;
    await connectA().expect(200); // erneuern
    expect((await prisma.forTenantId(a().id).integration.findUniqueOrThrow({ where: { tenantId_connectorType: { tenantId: a().id, connectorType: 'HUBSPOT' } } })).status).toBe('CONNECTED');
  });

  it('ein Kontakt eines verbundenen Betriebs geht mit dessen Schlüssel an HubSpot; ein Betrieb ohne Anbindung nutzt die Test-Ablage und ruft HubSpot nie auf', async () => {
    const contacts = app.get(ContactsService);
    const created = await contacts.upsert(a().id, undefined, { email: 'neu@kunde.example', firstName: 'Neu', lastName: 'Kunde' }, 'AGENT');
    expect(created.crmExternalId).toMatch(/^\d+$/); // HubSpot-Kennung
    expect(hubCalls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /crm/v3/objects/contacts/search', 'POST /crm/v3/objects/contacts']);
    expect(hubCalls.every((c) => c.key === 'pat-eu1-schluessel-a')).toBe(true);

    hubCalls.length = 0;
    const other = await contacts.upsert(b().id, undefined, { email: 'neu@kunde.example', firstName: 'Neu', lastName: 'Kunde' }, 'AGENT');
    expect(other.crmExternalId).toMatch(/^mock-contact-/);
    expect(hubCalls).toEqual([]);
  });

  it('eine Anfrage wird ein Deal; ein alter Kontakt aus der Test-Ablage wird dabei einmal in HubSpot zugeordnet', async () => {
    const db = prisma.forTenantId(a().id);
    const old = await db.contact.create({ data: { tenantId: a().id, firstName: 'Alt', lastName: 'Bestand', email: 'alt@kunde.example', crmExternalId: 'mock-contact-alt' } });
    const lead = await app.get(LeadsService).create(a().id, undefined, { contactId: old.id, source: 'EMAIL', notes: 'Wärmepumpe' }, 'AGENT');
    expect(lead.contactId).toBe(old.id);
    const refreshed = await db.contact.findUniqueOrThrow({ where: { id: old.id } });
    expect(refreshed.crmExternalId).toMatch(/^\d+$/); // jetzt die HubSpot-Kennung
    const deal = hubCalls.find((c) => c.path === '/crm/v3/objects/deals');
    expect(deal?.body).toMatchObject({ properties: { dealname: 'Anfrage (EMAIL)', pipeline: 'default', dealstage: 'erste' } });
    expect(hubCalls.some((c) => c.method === 'PUT' && c.path.includes('/associations/default/contacts/'))).toBe(true);
  });

  it('bei einem Ausfall von HubSpot gibt es einen wiederholbaren Fehler – es wird nie auf die Test-Ablage ausgewichen', async () => {
    hub.down = true;
    const before = await prisma.withRlsBypass((tx) => tx.mockCrmRecord.count({ where: { tenantId: a().id } }));
    const error = await app.get(ContactsService).upsert(a().id, undefined, { email: 'ausfall@kunde.example', firstName: 'Aus', lastName: 'Fall' }, 'AGENT').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExternalSystemError);
    expect(await prisma.forTenantId(a().id).contact.count({ where: { email: 'ausfall@kunde.example' } })).toBe(0); // auch in ORBIT nichts halb angelegt
    expect(await prisma.withRlsBypass((tx) => tx.mockCrmRecord.count({ where: { tenantId: a().id } }))).toBe(before);
  });

  it('das Kundenverzeichnis kennt HubSpot: gefunden, nicht gefunden, nicht erreichbar – und nur für Betriebe mit Anbindung', async () => {
    const records = app.get(CustomerRecordService);
    hub.contacts.set('bekannt@kunde.example', '777');
    const found = await records.check(a().id, 'bekannt@kunde.example');
    expect(found.outcome).toBe('FOUND');
    expect(found.match).toMatchObject({ systemKey: 'HUBSPOT', externalId: '777' });
    const unknown = await records.check(a().id, 'unbekannt@kunde.example');
    expect(unknown.outcome).toBe('NOT_FOUND');
    expect(unknown.systems.map((s) => s.systemKey)).toEqual(['ORBIT_CONTACTS', 'HUBSPOT']);
    hub.down = true;
    const down = await records.check(a().id, 'irgendwer@kunde.example');
    expect(down.outcome).toBe('UNAVAILABLE'); // nie „nicht gefunden“, sonst entstünden Doppelte
    expect(down.systems.find((s) => s.systemKey === 'HUBSPOT')?.reason).toBeTruthy();
    hubCalls.length = 0;
    hub.down = false;
    const without = await records.check(b().id, 'bekannt@kunde.example');
    expect(without.systems.map((s) => s.systemKey)).toEqual(['ORBIT_CONTACTS']);
    expect(hubCalls).toEqual([]);
  });

  it('der Nachweis nennt HubSpot als echt (LIVE) nur für den verbundenen Betrieb', async () => {
    const evidence = app.get(ExecutionEvidenceService);
    expect((await evidence.capture(a().id, { channelProvider: 'gmail', simulatedChannel: false })).crm).toEqual({ provider: 'hubspot', mode: 'LIVE' });
    expect((await evidence.capture(b().id, { channelProvider: 'gmail', simulatedChannel: false })).crm.mode).toBe('SIMULATED');
  });

  it('Trennen entfernt den Schlüssel; danach geht nichts mehr an HubSpot', async () => {
    await api().delete('/api/v1/integrations/HUBSPOT').set(bearer(a().token)).expect(200);
    expect(await prisma.forTenantId(a().id).integrationCredentialSecret.count()).toBe(0);
    hubCalls.length = 0;
    const contact = await app.get(ContactsService).upsert(a().id, undefined, { email: 'danach@kunde.example', firstName: 'Da', lastName: 'Nach' }, 'AGENT');
    expect(contact.crmExternalId).toMatch(/^mock-contact-/);
    expect(hubCalls).toEqual([]);
  });
});
