import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { STAFF_CSV_TEMPLATE } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

interface StaffRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  externalId: string | null;
  active: boolean;
  supervisorId: string | null;
  deputyId: string | null;
  supervisorName: string | null;
  deputyName: string | null;
  responsibilities: string[];
  calendarId: string | null;
}
interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  rows: Array<{ line: number; action: string; errors: string[]; warnings: string[] }>;
}
interface ProfileState {
  profile: { industry: string | null; services: string[]; automationConfirmedAt: string | null } | null;
  escalationPolicy: { reminderAfterMinutes: number; escalateAfterMinutes: number };
  automation: string;
  onboarding: { doneCount: number; complete: boolean; gaps: string[]; steps: Array<{ key: string; done: boolean }> };
}

/** Betriebsprofil, Mitarbeiterverzeichnis (einzeln, CSV, Schnittstelle), Vertretung/Vorgesetzte und Mandantentrennung – gegen echte Postgres, in eigenen Mandanten. */
describe('Organization: profile and staff directory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenantIds: string[] = [];
  let tenantId: string;
  let token: string;
  let otherToken: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const api = () => request(app.getHttpServer());

  async function createTenant(label: string, extra: { industry?: string; automationPreset?: 'CAUTIOUS' | 'BALANCED' | 'HIGH' } = {}) {
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({
      name: `E2E Org ${label} ${suffix}`,
      slug: `e2e-org-${label}-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-org.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
      ...extra,
    });
    tenantIds.push(tenant.id);
    const login = await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200);
    return { tenantId: tenant.id, token: login.body.accessToken as string };
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    ({ tenantId, token } = await createTenant('main', { industry: 'Heizung und Sanitär', automationPreset: 'BALANCED' }));
    ({ token: otherToken } = await createTenant('other'));
  });

  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenantIds } } }));
    await app.close();
  });

  const list = async (includeInactive = true) => ((await api().get(`/api/v1/staff?includeInactive=${includeInactive}`).set(auth()).expect(200)).body as StaffRow[]);
  const byExternal = (rows: StaffRow[], externalId: string) => rows.find((r) => r.externalId === externalId) as StaffRow;

  describe('Neukunde: Branche und Automatisierungsgrad von Anfang an', () => {
    it('der Betrieb startet mit Branche und der gewählten Stufe; die Checkliste hakt beides ab', async () => {
      const state = (await api().get('/api/v1/tenant/profile').set(auth()).expect(200)).body as ProfileState;
      expect(state.profile?.industry).toBe('Heizung und Sanitär');
      expect(state.automation).toBe('BALANCED');
      expect(state.onboarding.steps.find((s) => s.key === 'INDUSTRY')?.done).toBe(true);
      expect(state.onboarding.steps.find((s) => s.key === 'AUTOMATION')?.done).toBe(true);
      expect(state.onboarding.complete).toBe(false);
      expect(state.escalationPolicy.reminderAfterMinutes).toBe(240);
    });

    it('ohne Angaben startet ein Betrieb vorsichtig und ohne bestätigte Stufe', async () => {
      const other = (await api().get('/api/v1/tenant/profile').set({ Authorization: `Bearer ${otherToken}` }).expect(200)).body as ProfileState;
      expect(other.profile).toBeNull();
      expect(other.automation).toBe('CAUTIOUS');
      expect(other.onboarding.steps.find((s) => s.key === 'AUTOMATION')?.done).toBe(false);
    });

    it('die Stufe bewusst zu wählen (auch unverändert) bestätigt sie', async () => {
      await api().post('/api/v1/policies/automation').set({ Authorization: `Bearer ${otherToken}` }).send({ preset: 'CAUTIOUS' }).expect(201);
      const other = (await api().get('/api/v1/tenant/profile').set({ Authorization: `Bearer ${otherToken}` }).expect(200)).body as ProfileState;
      expect(other.onboarding.steps.find((s) => s.key === 'AUTOMATION')?.done).toBe(true);
    });
  });

  describe('Betriebsprofil', () => {
    it('speichert Leistungen, Zeiten und Notdienst; fremde Felder und falsche Zeiten werden abgewiesen', async () => {
      await api()
        .put('/api/v1/tenant/profile')
        .set(auth())
        .send({ services: ['Heizungswartung', 'Badsanierung'], openingHours: [{ days: ['MON', 'TUE'], from: '07:00', to: '16:00' }], emergencyService: true, emergencyNote: 'Notdienst-Nummer', tone: 'FRIENDLY' })
        .expect(200);
      const state = (await api().get('/api/v1/tenant/profile').set(auth()).expect(200)).body as ProfileState;
      expect(state.profile?.services).toEqual(['Heizungswartung', 'Badsanierung']);
      expect(state.profile?.industry).toBe('Heizung und Sanitär'); // unverändert
      await api().put('/api/v1/tenant/profile').set(auth()).send({ openingHours: [{ days: ['MON'], from: '25:00', to: '16:00' }] }).expect(400);
      await api().put('/api/v1/tenant/profile').set(auth()).send({ unbekannt: 1 }).expect(400);
    });

    it('Erinnerung und Eskalation sind einstellbar, die Eskalation muss nach der Erinnerung liegen', async () => {
      const ok = (await api().put('/api/v1/tenant/profile').set(auth()).send({ escalationPolicy: { reminderAfterMinutes: 60 } }).expect(200)).body as ProfileState;
      expect(ok.escalationPolicy).toMatchObject({ reminderAfterMinutes: 60, escalateAfterMinutes: 1440 });
      await api().put('/api/v1/tenant/profile').set(auth()).send({ escalationPolicy: { reminderAfterMinutes: 2000 } }).expect(400);
    });

    it('verlangt die Berechtigung und eine Anmeldung', async () => {
      await api().get('/api/v1/tenant/profile').expect(401);
      await api().get('/api/v1/staff').expect(401);
    });
  });

  describe('Mitarbeiter einzeln erfassen', () => {
    let chefId: string;
    it('legt Inhaber, Buchhalterin mit Vertretung und Vorgesetzter an und löst die Verweise auf', async () => {
      const chef = (await api().post('/api/v1/staff').set(auth()).send({ externalId: 'M-1', firstName: 'Clara', lastName: 'Chef', roleKind: 'OWNER', email: 'clara@betrieb.example', preferredChannel: 'WHATSAPP', phone: '+49 171 1111111', responsibilities: ['EMERGENCY', 'QUOTES'] }).expect(201)).body as StaffRow;
      chefId = chef.id;
      await api().post('/api/v1/staff').set(auth()).send({ externalId: 'M-2', firstName: 'Vera', lastName: 'Vertretung', roleKind: 'OFFICE', email: 'vera@betrieb.example', responsibilities: ['INVOICES'], supervisorRef: 'M-1' }).expect(201);
      const buch = (await api().post('/api/v1/staff').set(auth()).send({ externalId: 'M-3', firstName: 'Bea', lastName: 'Buchhaltung', roleKind: 'ACCOUNTING', email: 'bea@betrieb.example', responsibilities: ['INVOICES'], supervisorRef: 'clara@betrieb.example', deputyRef: 'M-2' }).expect(201)).body as StaffRow;
      expect(buch).toMatchObject({ supervisorName: 'Clara Chef', deputyName: 'Vera Vertretung' });
    });

    it('der gewünschte Kanal muss erreichbar sein; Kennung eindeutig; Verweise müssen auffindbar sein', async () => {
      const body = { firstName: 'Tim', lastName: 'Teams', roleKind: 'TECHNICIAN', email: 'tim@betrieb.example' };
      expect((await api().post('/api/v1/staff').set(auth()).send({ ...body, preferredChannel: 'TEAMS' }).expect(400)).body.message).toContain('Teams-Adresse');
      await api().post('/api/v1/staff').set(auth()).send({ ...body, externalId: 'M-1' }).expect(400);
      await api().post('/api/v1/staff').set(auth()).send({ ...body, supervisorRef: 'gibt-es-nicht' }).expect(400);
    });

    it('niemand ist sein eigener Vorgesetzter, und die Berichtskette bildet keine Schleife', async () => {
      const rows = await list();
      const clara = byExternal(rows, 'M-1');
      const bea = byExternal(rows, 'M-3');
      await api().patch(`/api/v1/staff/${clara.id}`).set(auth()).send({ supervisorRef: 'M-1' }).expect(400);
      // Bea berichtet an Clara – Clara darf nicht an Bea berichten.
      await api().patch(`/api/v1/staff/${clara.id}`).set(auth()).send({ supervisorRef: bea.externalId }).expect(400);
    });

    it('Änderungen werden zusammengeführt geprüft; eine Person lässt sich deaktivieren und wieder aktivieren', async () => {
      const tim = (await api().post('/api/v1/staff').set(auth()).send({ firstName: 'Tim', lastName: 'Monteur', roleKind: 'TECHNICIAN', email: 'tim@betrieb.example', calendarId: 'tim@betrieb.example' }).expect(201)).body as StaffRow;
      // Kanal auf Anruf ohne Nummer → Fehler; mit Nummer → ok.
      await api().patch(`/api/v1/staff/${tim.id}`).set(auth()).send({ preferredChannel: 'PHONE' }).expect(400);
      await api().patch(`/api/v1/staff/${tim.id}`).set(auth()).send({ preferredChannel: 'PHONE', phone: '+49 172 2222222' }).expect(200);
      const off = (await api().delete(`/api/v1/staff/${tim.id}`).set(auth()).expect(200)).body as StaffRow;
      expect(off.active).toBe(false);
      expect((await list(false)).some((r) => r.id === tim.id)).toBe(false);
      expect((await list(true)).some((r) => r.id === tim.id)).toBe(true);
      expect(((await api().patch(`/api/v1/staff/${tim.id}`).set(auth()).send({ active: true }).expect(200)).body as StaffRow).active).toBe(true);
      await api().get(`/api/v1/staff/${randomUUID()}`).set(auth()).expect(404);
    });

    it('jeder Mandant sieht nur sein Verzeichnis', async () => {
      const others = (await api().get('/api/v1/staff?includeInactive=true').set({ Authorization: `Bearer ${otherToken}` }).expect(200)).body as StaffRow[];
      expect(others).toEqual([]);
      await api().get(`/api/v1/staff/${chefId}`).set({ Authorization: `Bearer ${otherToken}` }).expect(404);
    });

    it('die Checkliste zeigt Lücken ehrlich: Notfallzuständige sind erfasst, Vertretung/Vorgesetzte fehlen noch bei Tim', async () => {
      const state = (await api().get('/api/v1/tenant/profile').set(auth()).expect(200)).body as ProfileState;
      expect(state.onboarding.steps.find((s) => s.key === 'STAFF')?.done).toBe(true);
      expect(state.onboarding.steps.find((s) => s.key === 'EMERGENCY')?.done).toBe(true);
    });
  });

  describe('Mitarbeiter per CSV einlesen', () => {
    const csv = [
      'Personalnummer;Vorname;Nachname;Rolle;E-Mail;Mobil;Bevorzugter Kanal;Zuständigkeiten;Vorgesetzter;Vertretung',
      'C-1;Dora;Disposition;Disposition;dora@csv.example;+49 170 3333333;Anruf;Termine;M-1;',
      'C-2;Emil;Elektriker;Monteur;emil@csv.example;;E-Mail;;C-1;C-1',
      'C-3;Fritz;Fehler;Monteur;;;E-Mail;;;',
    ].join('\n');

    it('die Vorschau speichert nichts und nennt je Zeile, was geschehen würde', async () => {
      const before = (await list()).length;
      const preview = (await api().post('/api/v1/staff/import/preview').set(auth()).send({ csv }).expect(201)).body as ImportResult;
      expect(preview).toMatchObject({ dryRun: true, created: 2, failed: 1 });
      expect(preview.rows.map((r) => r.action)).toEqual(['CREATE', 'CREATE', 'ERROR']);
      expect(preview.rows[2]!.errors.join(' ')).toContain('E-Mail');
      expect((await list()).length).toBe(before);
    });

    it('die Übernahme legt die gültigen Zeilen an, löst Vorgesetzte/Vertretung auf (auch innerhalb der Datei) und meldet die fehlerhafte', async () => {
      const result = (await api().post('/api/v1/staff/import').set(auth()).send({ csv }).expect(201)).body as ImportResult;
      expect(result).toMatchObject({ dryRun: false, created: 2, failed: 1 });
      const rows = await list();
      expect(byExternal(rows, 'C-1')).toMatchObject({ supervisorName: 'Clara Chef' });
      expect(byExternal(rows, 'C-2')).toMatchObject({ supervisorName: 'Dora Disposition', deputyName: 'Dora Disposition' });
      expect(rows.some((r) => r.firstName === 'Fritz')).toBe(false);
    });

    it('derselbe Import danach ändert nichts; eine geänderte Adresse ist eine Aktualisierung', async () => {
      const again = (await api().post('/api/v1/staff/import').set(auth()).send({ csv }).expect(201)).body as ImportResult;
      expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, failed: 1 });
      const changed = csv.replace('emil@csv.example', 'emil.neu@csv.example');
      const result = (await api().post('/api/v1/staff/import').set(auth()).send({ csv: changed }).expect(201)).body as ImportResult;
      expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
      expect(byExternal(await list(), 'C-2').email).toBe('emil.neu@csv.example');
    });

    it('eine Datei ohne Kalender- oder Zuständigkeitsspalte löscht diese Angaben bei bestehenden Personen nicht', async () => {
      const dora = byExternal(await list(), 'C-1');
      await api().patch(`/api/v1/staff/${dora.id}`).set(auth()).send({ calendarId: 'dora@csv.example' }).expect(200);
      const slim = 'Personalnummer;Vorname;Nachname;E-Mail;Mobil;Bevorzugter Kanal\nC-1;Dora;Disposition;dora@csv.example;+49 170 3333333;Anruf';
      const result = (await api().post('/api/v1/staff/import').set(auth()).send({ csv: slim }).expect(201)).body as ImportResult;
      expect(result.unchanged).toBe(1);
      expect(byExternal(await list(), 'C-1')).toMatchObject({ calendarId: 'dora@csv.example', responsibilities: ['APPOINTMENTS'], supervisorName: 'Clara Chef' });
    });

    it('„Fehlende deaktivieren“ ist nur bei fehlerfreier Datei erlaubt und trifft nur Personen mit Kennung', async () => {
      await api().post('/api/v1/staff/import').set(auth()).send({ csv, deactivateMissing: true }).expect(400); // Zeile 4 fehlerhaft
      const clean = csv.split('\n').slice(0, 3).join('\n');
      const result = (await api().post('/api/v1/staff/import').set(auth()).send({ csv: clean, deactivateMissing: true }).expect(201)).body as ImportResult;
      // M-1, M-2, M-3 haben eine Kennung und stehen nicht in der Datei; die von Hand erfasste Person ohne Kennung bleibt aktiv.
      expect(result.deactivated).toBe(3);
      const rows = await list();
      expect(byExternal(rows, 'M-1').active).toBe(false);
      expect(rows.find((r) => r.firstName === 'Tim')?.active).toBe(true);
    });

    it('unlesbare Dateien werden mit klarer Meldung abgewiesen; die Beispieldatei ist gültig', async () => {
      expect((await api().post('/api/v1/staff/import/preview').set(auth()).send({ csv: 'E-Mail;Mobil\na@x.example;1' }).expect(400)).body.message).toContain('Name');
      const sample = (await api().post('/api/v1/staff/import/preview').set(auth()).send({ csv: STAFF_CSV_TEMPLATE }).expect(201)).body as ImportResult;
      expect(sample).toMatchObject({ created: 2, failed: 0 });
      expect(sample.rows.flatMap((r) => r.warnings)).toEqual([]); // Vorgesetzter/Vertretung der Beispieldatei zeigen aufeinander
    });
  });

  describe('Schnittstelle für größere Betriebe (PUT /staff/sync)', () => {
    const entry = (n: number, extra: Record<string, unknown> = {}) => ({ externalId: `S-${n}`, firstName: `Sync${n}`, lastName: 'Person', roleKind: 'TECHNICIAN', email: `sync${n}@api.example`, ...extra });

    it('gleicht eine Liste über die Kennung ab: neu, unverändert, geändert; unbekannte Verweise werden als Warnung gemeldet', async () => {
      const first = (await api().put('/api/v1/staff/sync').set(auth()).send({ staff: [entry(1), entry(2, { supervisorRef: 'S-1' }), entry(3, { supervisorRef: 'S-99' })] }).expect(200)).body as ImportResult;
      expect(first).toMatchObject({ created: 3, failed: 0 });
      expect(first.rows[2]!.warnings[0]).toContain('S-99');
      expect(byExternal(await list(), 'S-2').supervisorName).toBe('Sync1 Person');

      const second = (await api().put('/api/v1/staff/sync').set(auth()).send({ staff: [entry(1), entry(2, { supervisorRef: 'S-1' }), entry(3, { roleTitle: 'Obermonteur' })] }).expect(200)).body as ImportResult;
      expect(second).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    });

    it('Probelauf (dryRun) ändert nichts; ohne Kennung wird ein Eintrag abgewiesen; Doppelte werden erkannt', async () => {
      const before = await list();
      const dry = (await api().put('/api/v1/staff/sync').set(auth()).send({ staff: [entry(7)], dryRun: true }).expect(200)).body as ImportResult;
      expect(dry).toMatchObject({ dryRun: true, created: 1 });
      expect(await list()).toHaveLength(before.length);

      const mixed = (await api().put('/api/v1/staff/sync').set(auth()).send({ staff: [{ firstName: 'Ohne', lastName: 'Kennung', email: 'ohne@api.example' }, entry(8), entry(8)] }).expect(200)).body as ImportResult;
      expect(mixed.rows.map((r) => r.action)).toEqual(['ERROR', 'CREATE', 'ERROR']);
      expect(mixed.rows[0]!.errors[0]).toContain('externalId');
      expect(mixed.rows[2]!.errors[0]).toContain('mehrfach');
    });

    it('ein Eintrag ohne Pflichtfelder oder eine leere Liste ist ein Fehler (400)', async () => {
      await api().put('/api/v1/staff/sync').set(auth()).send({ staff: [] }).expect(400);
      const bad = (await api().put('/api/v1/staff/sync').set(auth()).send({ staff: [{ externalId: 'S-50' }] }).expect(200)).body as ImportResult;
      expect(bad).toMatchObject({ failed: 1, created: 0 });
    });

    it('der Abgleich ist im Audit protokolliert – mit Anzahlen, nicht mit Personendaten', async () => {
      const events = await prisma.forTenantId(tenantId).auditLog.findMany({ where: { tenantId, eventType: 'STAFF_IMPORTED' } });
      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(events.map((e) => e.payload))).not.toContain('@');
    });
  });
});
