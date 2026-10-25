import { describe, expect, it, vi } from 'vitest';
import { HubSpotApiError, HubSpotCrmConnector } from './hubspot-crm-connector';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  auth?: string;
}

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };
type Route = { match: (method: string, path: string, body: unknown) => boolean; respond: () => Answer };

/** Eine nachgebaute HubSpot-Schnittstelle: antwortet je (Methode, Pfad) aus einer Liste und merkt sich die Aufrufe. */
function fakeHubSpot(routes: Route[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://api.hubapi.com', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth: (init?.headers as Record<string, string>).Authorization });
    const found = routes.find((r) => r.match(method, path, body));
    const answer: Answer = found ? found.respond() : { status: 404, body: { category: 'OBJECT_NOT_FOUND', message: 'nicht nachgebaut' } };
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body ?? {}), { status: answer.status, headers: answer.headers });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const route = (method: string, pathStart: string, respond: () => Answer): Route => ({ match: (m, p) => m === method && p.startsWith(pathStart), respond });

const connector = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof HubSpotCrmConnector>[0]> = {}) =>
  new HubSpotCrmConnector({ tokenFor: async (tenant) => (tenant === 'ohne-schluessel' ? Promise.reject(new Error('kein Schlüssel')) : `pat-${tenant}`), fetchImpl, ...extra });

describe('HubSpotCrmConnector – Kontakte', () => {
  it('legt einen unbekannten Kontakt an (Suche leer, dann Anlage), mit dem Schlüssel des Betriebs', async () => {
    const { calls, fetchImpl } = fakeHubSpot([
      route('POST', '/crm/v3/objects/contacts/search', () => ({ status: 200, body: { total: 0, results: [] } })),
      route('POST', '/crm/v3/objects/contacts', () => ({ status: 201, body: { id: '501', properties: {} } })),
    ]);
    const result = await connector(fetchImpl).upsertContact({ tenantId: 't1', email: 'Anna@Kunde.example', firstName: 'Anna', lastName: 'Kunde', phone: '0221 1' });
    expect(result).toEqual({ externalId: '501', email: 'anna@kunde.example', firstName: 'Anna', lastName: 'Kunde' });
    expect(calls[0]).toMatchObject({ auth: 'Bearer pat-t1', body: { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: 'anna@kunde.example' }] }] } });
    expect(calls[1]?.body).toEqual({ properties: { email: 'anna@kunde.example', firstname: 'Anna', lastname: 'Kunde', phone: '0221 1' } });
  });

  it('überschreibt einen gefundenen Kontakt nicht (HubSpot führt)', async () => {
    const { calls, fetchImpl } = fakeHubSpot([
      route('POST', '/crm/v3/objects/contacts/search', () => ({ status: 200, body: { total: 1, results: [{ id: '77', properties: { email: 'anna@kunde.example', firstname: 'Anna-Maria', lastname: 'Kunde-Müller' } }] } })),
    ]);
    const result = await connector(fetchImpl).upsertContact({ tenantId: 't1', email: 'anna@kunde.example', firstName: 'Anna', lastName: 'Kunde' });
    expect(result).toMatchObject({ externalId: '77', firstName: 'Anna-Maria', lastName: 'Kunde-Müller' });
    expect(calls.map((c) => c.path)).toEqual(['/crm/v3/objects/contacts/search']); // nur die Suche, kein Schreiben
  });

  it('bei einem Konflikt während der Anlage wird erneut gesucht statt zu scheitern', async () => {
    let searches = 0;
    const { fetchImpl } = fakeHubSpot([
      route('POST', '/crm/v3/objects/contacts/search', () => (++searches === 1 ? { status: 200, body: { results: [] } } : { status: 200, body: { results: [{ id: '9', properties: { email: 'a@b.example' } }] } })),
      route('POST', '/crm/v3/objects/contacts', () => ({ status: 409, body: { category: 'CONFLICT', message: 'Contact already exists' } })),
    ]);
    expect(await connector(fetchImpl).upsertContact({ tenantId: 't1', email: 'a@b.example', firstName: 'A', lastName: 'B' })).toMatchObject({ externalId: '9' });
  });

  it('verknüpft mit dem Unternehmen über die Standardverknüpfung', async () => {
    const { calls, fetchImpl } = fakeHubSpot([
      route('POST', '/crm/v3/objects/contacts/search', () => ({ status: 200, body: { results: [] } })),
      route('POST', '/crm/v3/objects/contacts', () => ({ status: 201, body: { id: '5' } })),
      route('PUT', '/crm/v4/objects/contacts/5/associations/default/companies/88', () => ({ status: 200, body: {} })),
    ]);
    await connector(fetchImpl).upsertContact({ tenantId: 't1', email: 'a@b.example', firstName: 'A', lastName: 'B', companyExternalId: '88' });
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/crm/v4/objects/contacts/5/associations/default/companies/88' });
  });
});

describe('HubSpotCrmConnector – Unternehmen, Deals, Notizen', () => {
  it('Unternehmen: Treffer über die Domain, sonst Anlage', async () => {
    const found = fakeHubSpot([route('POST', '/crm/v3/objects/companies/search', () => ({ status: 200, body: { results: [{ id: '3', properties: { name: 'Muster GmbH', domain: 'muster.example' } }] } }))]);
    expect(await connector(found.fetchImpl).upsertCompany({ tenantId: 't1', name: 'Andere', domain: 'Muster.example' })).toEqual({ externalId: '3', name: 'Muster GmbH' });
    expect(found.calls[0]?.body).toMatchObject({ filterGroups: [{ filters: [{ propertyName: 'domain', value: 'muster.example' }] }] });

    const created = fakeHubSpot([route('POST', '/crm/v3/objects/companies', () => ({ status: 201, body: { id: '4' } }))]);
    expect(await connector(created.fetchImpl).upsertCompany({ tenantId: 't1', name: 'Neu GmbH' })).toEqual({ externalId: '4', name: 'Neu GmbH' });
    expect(created.calls).toHaveLength(1); // ohne Domain keine Suche
  });

  it('Anfrage wird ein Deal in der ersten Phase der ersten Pipeline, verknüpft mit Kontakt und Unternehmen', async () => {
    const { calls, fetchImpl } = fakeHubSpot([
      route('GET', '/crm/v3/pipelines/deals', () => ({
        status: 200,
        body: { results: [{ id: 'zweite', displayOrder: 1, stages: [{ id: 'z1', displayOrder: 0 }] }, { id: 'default', displayOrder: 0, stages: [{ id: 'spaet', displayOrder: 2 }, { id: 'appointmentscheduled', displayOrder: 0 }] }] },
      })),
      route('POST', '/crm/v3/objects/deals', () => ({ status: 201, body: { id: '900' } })),
      route('PUT', '/crm/v4/objects/deals/900/associations/default/', () => ({ status: 200, body: {} })),
    ]);
    const hub = connector(fetchImpl);
    expect(await hub.createLead({ tenantId: 't1', contactExternalId: '5', companyExternalId: '8', source: 'EMAIL', notes: 'Wärmepumpe' })).toEqual({ externalId: '900' });
    const deal = calls.find((c) => c.path === '/crm/v3/objects/deals');
    expect(deal?.body).toEqual({ properties: { dealname: 'Anfrage (EMAIL)', pipeline: 'default', dealstage: 'appointmentscheduled', description: 'Wärmepumpe' } });
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual(['/crm/v4/objects/deals/900/associations/default/contacts/5', '/crm/v4/objects/deals/900/associations/default/companies/8']);
    await hub.createLead({ tenantId: 't1', contactExternalId: '6', source: 'EMAIL' });
    expect(calls.filter((c) => c.path === '/crm/v3/pipelines/deals')).toHaveLength(1); // die Pipeline wird kurz gemerkt
  });

  it('die Bezeichnung der Anfrage wird der Name des Deals (gekürzt), sonst der Eingangskanal', async () => {
    const { calls, fetchImpl } = fakeHubSpot([route('POST', '/crm/v3/objects/deals', () => ({ status: 201, body: { id: '1' } })), route('PUT', '/crm/v4/', () => ({ status: 200 }))]);
    const hub = connector(fetchImpl, { dealSettingsFor: async () => ({ pipeline: 'p', stage: 's' }) });
    await hub.createLead({ tenantId: 't1', contactExternalId: '5', source: 'EMAIL', title: `  Anfrage Wärmepumpe – Tom Orbit${'x'.repeat(300)}` });
    await hub.createLead({ tenantId: 't1', contactExternalId: '5', source: 'EMAIL', title: '   ' });
    const names = calls.filter((c) => c.path === '/crm/v3/objects/deals').map((c) => (c.body as { properties: { dealname: string } }).properties.dealname);
    expect(names[0]).toMatch(/^Anfrage Wärmepumpe – Tom Orbit/);
    expect(names[0]).toHaveLength(200);
    expect(names[1]).toBe('Anfrage (EMAIL)');
  });

  it('die Einstellung des Betriebs für Pipeline und Phase hat Vorrang (ohne Abfrage der Pipelines)', async () => {
    const { calls, fetchImpl } = fakeHubSpot([route('POST', '/crm/v3/objects/deals', () => ({ status: 201, body: { id: '1' } })), route('PUT', '/crm/v4/', () => ({ status: 200 }))]);
    await connector(fetchImpl, { dealSettingsFor: async () => ({ pipeline: 'p9', stage: 's3' }) }).createLead({ tenantId: 't1', contactExternalId: '5', source: 'PHONE' });
    expect(calls.some((c) => c.path === '/crm/v3/pipelines/deals')).toBe(false);
    expect(calls[0]?.body).toMatchObject({ properties: { pipeline: 'p9', dealstage: 's3' } });
  });

  it('Aktivität wird eine Notiz am Kontakt mit Zeitpunkt und dem Verknüpfungstyp Note-to-contact', async () => {
    const { calls, fetchImpl } = fakeHubSpot([route('POST', '/crm/v3/objects/notes', () => ({ status: 201, body: { id: '1' } }))]);
    await connector(fetchImpl).logActivity({ tenantId: 't1', contactExternalId: '5', activityType: 'EMAIL_RECEIVED', summary: 'Anfrage', occurredAt: new Date('2026-10-16T10:00:00Z') });
    expect(calls[0]?.body).toEqual({
      properties: { hs_timestamp: '2026-10-16T10:00:00.000Z', hs_note_body: 'EMAIL_RECEIVED: Anfrage' },
      associations: [{ to: { id: '5' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
    });
  });
});

describe('HubSpotCrmConnector – Suchindex hinkt hinterher', () => {
  it('ein soeben angelegtes Unternehmen oder ein soeben angelegter Kontakt wird sofort wiedergefunden, auch wenn die Suche ihn noch nicht liefert', async () => {
    const { calls, fetchImpl } = fakeHubSpot([
      route('POST', '/crm/v3/objects/companies/search', () => ({ status: 200, body: { results: [] } })), // Index noch leer
      route('POST', '/crm/v3/objects/companies', () => ({ status: 201, body: { id: '40' } })),
      route('POST', '/crm/v3/objects/contacts/search', () => ({ status: 200, body: { results: [] } })),
      route('POST', '/crm/v3/objects/contacts', () => ({ status: 201, body: { id: '50' } })),
    ]);
    const hub = connector(fetchImpl);
    const first = await hub.upsertCompany({ tenantId: 't1', name: 'Muster', domain: 'muster.example' });
    expect(await hub.upsertCompany({ tenantId: 't1', name: 'Anderer Name', domain: 'MUSTER.example' })).toEqual(first);
    const contact = await hub.upsertContact({ tenantId: 't1', email: 'a@muster.example', firstName: 'A', lastName: 'B' });
    expect((await hub.upsertContact({ tenantId: 't1', email: 'A@muster.example', firstName: 'X', lastName: 'Y' })).externalId).toBe(contact.externalId);
    expect(calls.filter((c) => c.method === 'POST' && !c.path.endsWith('/search'))).toHaveLength(2); // je ein Datensatz, kein Doppelter
    // Ein anderer Betrieb teilt den Merkzettel nicht.
    await hub.upsertCompany({ tenantId: 't2', name: 'Muster', domain: 'muster.example' });
    expect(calls.filter((c) => c.path === '/crm/v3/objects/companies')).toHaveLength(2);
  });
});

describe('HubSpotCrmConnector – Fehler und Prüfung', () => {
  it('Fehler werden benannt, nie als nicht gefunden ausgegeben', async () => {
    const forbidden = fakeHubSpot([route('POST', '/crm/v3/objects/contacts/search', () => ({ status: 403, body: { category: 'MISSING_SCOPES', message: 'x' } }))]);
    await expect(connector(forbidden.fetchImpl).upsertContact({ tenantId: 't1', email: 'a@b.example', firstName: 'A', lastName: 'B' })).rejects.toMatchObject({
      name: 'HubSpotApiError',
      status: 403,
      category: 'MISSING_SCOPES',
      retryable: false,
    });
    const denied = fakeHubSpot([route('POST', '/crm/v3/objects/contacts/search', () => ({ status: 401, body: { category: 'INVALID_AUTHENTICATION' } }))]);
    await expect(connector(denied.fetchImpl).findContactByEmail('t1', 'a@b.example')).rejects.toThrow(/abgelehnt/);
    await expect(connector(forbidden.fetchImpl).upsertContact({ tenantId: 'ohne-schluessel', email: 'a@b.example', firstName: 'A', lastName: 'B' })).rejects.toThrow('kein Schlüssel');
  });

  it('Suche und Lesen werden bei Drosselung einmal wiederholt, Anlegen nie', async () => {
    let searches = 0;
    const retried = fakeHubSpot([
      route('POST', '/crm/v3/objects/contacts/search', () => (++searches === 1 ? { status: 429, body: { category: 'RATE_LIMITS' }, headers: { 'retry-after': '0' } } : { status: 200, body: { results: [] } })),
    ]);
    expect(await connector(retried.fetchImpl).findContactByEmail('t1', 'a@b.example')).toBeNull();
    expect(searches).toBe(2);

    const failing = fakeHubSpot([route('POST', '/crm/v3/objects/companies', () => ({ status: 503, body: {} }))]);
    await expect(connector(failing.fetchImpl).upsertCompany({ tenantId: 't1', name: 'X' })).rejects.toMatchObject({ status: 503, retryable: true });
    expect(failing.calls).toHaveLength(1);
  });

  it('ein Netzwerkfehler ist als wiederholbar gemeldet', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const error = await connector(fetchImpl).findContactByEmail('t1', 'a@b.example').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HubSpotApiError);
    expect(error).toMatchObject({ category: 'NETWORK', retryable: true });
  });

  it('verifyAccess prüft die drei Bereiche einzeln und nennt, was fehlt', async () => {
    const { fetchImpl } = fakeHubSpot([
      route('GET', '/crm/v3/objects/contacts', () => ({ status: 200, body: { results: [] } })),
      route('GET', '/crm/v3/objects/companies', () => ({ status: 403, body: { category: 'MISSING_SCOPES' } })),
      route('GET', '/crm/v3/objects/deals', () => ({ status: 200, body: { results: [] } })),
    ]);
    expect(await connector(fetchImpl).verifyAccess('pat-x')).toEqual({ ok: false, contacts: 'OK', companies: 'MISSING_SCOPES', deals: 'OK' });
    const bad = fakeHubSpot([route('GET', '/crm/v3/objects/', () => ({ status: 401, body: {} }))]);
    expect(await connector(bad.fetchImpl).verifyAccess('pat-y')).toEqual({ ok: false, contacts: 'INVALID_KEY', companies: 'INVALID_KEY', deals: 'INVALID_KEY' });
  });
});

describe('HubSpotCrmConnector – Lead lesen und ändern (Meilenstein B)', () => {
  it('liest den Deal mit Name und Beschreibung; ein nicht vorhandener Deal ist null, ein Ausfall ein Fehler', async () => {
    const { calls, fetchImpl } = fakeHubSpot([
      route('GET', '/crm/v3/objects/deals/900', () => ({ status: 200, body: { id: '900', properties: { dealname: 'Anfrage Wärmepumpe – Tom', description: 'Gasheizung von 1995' } } })),
      route('GET', '/crm/v3/objects/deals/404', () => ({ status: 404, body: { category: 'OBJECT_NOT_FOUND' } })),
      route('GET', '/crm/v3/objects/deals/500', () => ({ status: 500, body: {} })),
    ]);
    const crm = connector(fetchImpl);
    expect(await crm.readLead({ tenantId: 't1', externalId: '900' })).toEqual({ externalId: '900', title: 'Anfrage Wärmepumpe – Tom', notes: 'Gasheizung von 1995' });
    expect(calls[0]?.path).toBe('/crm/v3/objects/deals/900?properties=dealname,description');
    expect(await crm.readLead({ tenantId: 't1', externalId: '404' })).toBeNull();
    await expect(crm.readLead({ tenantId: 't1', externalId: '500' })).rejects.toBeInstanceOf(HubSpotApiError);
  });

  it('ändert nur Name und Beschreibung des genannten Deals (PATCH, ein Versuch) – nie Phase, Besitzer oder Verknüpfungen', async () => {
    const { calls, fetchImpl } = fakeHubSpot([route('PATCH', '/crm/v3/objects/deals/900', () => ({ status: 200, body: { id: '900', properties: {} } }))]);
    await connector(fetchImpl).updateLead({ tenantId: 't1', externalId: '900', title: ' Neuer Name ', notes: 'x'.repeat(2500) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/crm/v3/objects/deals/900', auth: 'Bearer pat-t1' });
    const properties = (calls[0]?.body as { properties: Record<string, string> }).properties;
    expect(Object.keys(properties).sort()).toEqual(['dealname', 'description']);
    expect(properties.dealname).toBe('Neuer Name');
    expect(properties.description).toHaveLength(2000);
  });

  it('ohne zu schreibende Felder passiert nichts; ein Fehler von HubSpot wird gemeldet und nicht wiederholt', async () => {
    const { calls, fetchImpl } = fakeHubSpot([route('PATCH', '/crm/v3/objects/deals/900', () => ({ status: 503, body: {} }))]);
    const crm = connector(fetchImpl);
    await crm.updateLead({ tenantId: 't1', externalId: '900' });
    expect(calls).toHaveLength(0);
    await expect(crm.updateLead({ tenantId: 't1', externalId: '900', notes: 'x' })).rejects.toMatchObject({ status: 503, retryable: true });
    expect(calls).toHaveLength(1);
  });
});
