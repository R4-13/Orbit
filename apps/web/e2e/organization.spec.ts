import { expect, test, type Page, type Route } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaStorage } from './utils/login';

/**
 * Unternehmensprofil und Mitarbeiterverzeichnis. Beides sind Daten des Demo-Mandanten (und der Anwender testet in derselben Umgebung): die Schnittstelle wird deshalb mit
 * einem Speicher im Test ersetzt, die Entwicklungsdaten bleiben unberührt. Die echte Speicherung, Mandantentrennung und der Abgleich sind in
 * apps/api/test/organization.e2e-spec.ts gegen Postgres geprüft.
 */

const POLICY = { reminderAfterMinutes: 240, escalateAfterMinutes: 1440, emergencyReminderMinutes: 15, emergencyEscalateMinutes: 45 };

interface FakeStaff {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  roleKind: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  teamsAddress: string | null;
  whatsappNumber: string | null;
  preferredChannel: string;
  responsibilities: string[];
  calendarId: string | null;
  availabilityNote: string | null;
  supervisorId: string | null;
  deputyId: string | null;
  supervisorName: string | null;
  deputyName: string | null;
  active: boolean;
}

async function installFakeBackend(page: Page) {
  const staff: FakeStaff[] = [];
  let profile: Record<string, unknown> | null = null;
  let policy = { ...POLICY };
  const requests: Array<{ method: string; path: string; body: unknown }> = [];

  const state = () => {
    const active = staff.filter((s) => s.active);
    const steps = [
      { key: 'INDUSTRY', label: 'Branche angeben', done: Boolean(profile?.industry), hint: 'Die Branche bestimmt, wie ORBIT Anfragen versteht.', href: '/admin/company' },
      { key: 'STAFF', label: 'Mitarbeiter erfassen', done: active.length > 0, hint: 'Manuell, per CSV-Datei oder über die Schnittstelle.', href: '/admin/staff' },
    ];
    const gaps = active.length > 0 && !active.some((s) => s.roleKind === 'OWNER' || s.roleKind === 'MANAGER') ? ['Es fehlt eine Person mit der Rolle Inhaber oder Leitung – sie ist die letzte Stufe, wenn niemand reagiert.'] : [];
    const doneCount = steps.filter((s) => s.done).length;
    return {
      profile: profile ? { id: 'p1', services: [], exclusions: [], openingHours: [], faqs: [], languages: ['de'], tone: 'FORMAL', emergencyService: false, ...profile } : null,
      escalationPolicy: policy,
      escalationDefaults: POLICY,
      automation: 'BALANCED',
      onboarding: { steps, doneCount, complete: doneCount === steps.length && gaps.length === 0, gaps },
    };
  };

  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

  await page.route('**/api/v1/tenant/profile', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      requests.push({ method: 'PUT', path: '/tenant/profile', body });
      const { escalationPolicy, ...rest } = body;
      profile = { ...(profile ?? {}), ...rest };
      if (escalationPolicy) policy = { ...policy, ...(escalationPolicy as typeof policy) };
    }
    return json(route, state());
  });

  await page.route('**/api/v1/staff**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/staff', '') || '/';
    const method = request.method();
    if (method === 'GET' && path === '/') return json(route, staff.filter((s) => url.searchParams.get('includeInactive') === 'true' || s.active));
    const body = request.postData() ? (request.postDataJSON() as Record<string, string | string[]>) : {};
    requests.push({ method, path, body });
    const nameOf = (id: unknown) => {
      const found = staff.find((s) => s.id === id);
      return found ? `${found.firstName} ${found.lastName}` : null;
    };
    const blank = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
    if (method === 'POST' && path === '/import/preview') {
      return json(route, {
        dryRun: true,
        created: 1,
        updated: 0,
        unchanged: 0,
        deactivated: 0,
        failed: 1,
        mapping: [{ header: 'Vorname', field: 'firstName' }, { header: 'Lieblingsfarbe', field: null }],
        rows: [
          { line: 2, name: 'Dora Disposition', action: 'CREATE', errors: [], warnings: ['Vorgesetzte/r „X-9“ ist im Verzeichnis nicht zu finden und wurde nicht gesetzt.'] },
          { line: 3, name: '', action: 'ERROR', errors: ['Für den Kanal E-Mail fehlt die E-Mail-Adresse.'], warnings: [] },
        ],
      });
    }
    if (method === 'POST' && path === '/import') {
      staff.push({ ...baseStaff('dora'), firstName: 'Dora', lastName: 'Disposition', roleKind: 'DISPATCHER', email: 'dora@csv.example' });
      return json(route, { dryRun: false, created: 1, updated: 0, unchanged: 0, deactivated: 0, failed: 1, rows: [] });
    }
    if (method === 'POST' && path === '/') {
      const created: FakeStaff = {
        ...baseStaff(`s${staff.length + 1}`),
        firstName: String(body.firstName),
        lastName: String(body.lastName),
        roleKind: String(body.roleKind),
        email: blank(body.email),
        phone: blank(body.phone),
        preferredChannel: String(body.preferredChannel),
        responsibilities: (body.responsibilities as string[]) ?? [],
        supervisorId: blank(body.supervisorRef),
        deputyId: blank(body.deputyRef),
      };
      created.supervisorName = nameOf(created.supervisorId);
      created.deputyName = nameOf(created.deputyId);
      staff.push(created);
      return json(route, created, 201);
    }
    const id = path.slice(1);
    const person = staff.find((s) => s.id === id);
    if (!person) return json(route, { code: 'NOT_FOUND', message: 'Die Person wurde nicht gefunden.' }, 404);
    if (method === 'DELETE') person.active = false;
    if (method === 'PATCH') {
      if (body.active !== undefined) person.active = Boolean(body.active);
    }
    return json(route, person);
  });

  return { staff, requests, getProfile: () => profile };
}

function baseStaff(id: string): FakeStaff {
  return {
    id,
    externalId: null,
    firstName: '',
    lastName: '',
    roleKind: 'OFFICE',
    roleTitle: null,
    email: null,
    phone: null,
    teamsAddress: null,
    whatsappNumber: null,
    preferredChannel: 'EMAIL',
    responsibilities: [],
    calendarId: null,
    availabilityNote: null,
    supervisorId: null,
    deputyId: null,
    supervisorName: null,
    deputyName: null,
    active: true,
  };
}

test.describe('Unternehmensprofil und Mitarbeiter', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await loginViaStorage(page, DEMO_USERS.admin);
  });

  test('Die Administration nennt beide Bereiche; die Checkliste führt zu den offenen Schritten', async ({ page }) => {
    await installFakeBackend(page);
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: /Unternehmensprofil/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^Mitarbeiter/ }).first()).toBeVisible();
    const checklist = page.getByTestId('onboarding-checklist');
    await expect(checklist).toContainText('0 von 2 erledigt');
    await checklist.getByRole('link', { name: 'Branche angeben' }).click();
    await expect(page).toHaveURL(/\/admin\/company$/);
  });

  test('Profil: Branche, Leistungen, Öffnungszeiten, Notdienst und Eskalationszeiten werden gespeichert; die Checkliste hakt die Branche ab', async ({ page }) => {
    const backend = await installFakeBackend(page);
    await page.goto('/admin/company');
    await expect(page.getByRole('heading', { name: 'Unternehmensprofil' })).toBeVisible();
    const save = page.getByRole('button', { name: 'Profil speichern' });
    await expect(save).toBeDisabled(); // nichts geändert

    await page.getByLabel('Branche / Gewerk').fill('Heizung und Sanitär');
    await page.getByLabel('Leistungen (eine pro Zeile)').fill('Heizungswartung\nBadsanierung');
    await page.getByRole('button', { name: 'Zeit hinzufügen' }).click();
    await expect(page.getByTestId('hours-row')).toHaveCount(1);
    await page.getByLabel('Wir bieten einen Notdienst an').check();
    await page.getByLabel('Hinweis zum Notdienst').fill('rund um die Uhr');
    await page.getByLabel('Erinnerung nach (Stunden)').fill('2');
    await expect(page.getByText('Ungespeicherte Änderungen')).toBeVisible();
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();

    const put = backend.requests.find((r) => r.method === 'PUT');
    expect(put?.body).toMatchObject({
      industry: 'Heizung und Sanitär',
      services: ['Heizungswartung', 'Badsanierung'],
      emergencyService: true,
      openingHours: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '08:00', to: '17:00' }],
      escalationPolicy: { reminderAfterMinutes: 120, escalateAfterMinutes: 1440 },
    });
    await expect(page.getByTestId('onboarding-step-INDUSTRY')).toHaveAttribute('data-done', 'true');
  });

  test('Mitarbeiter erfassen: Rolle, Kanal, Zuständigkeit, Vertretung und Vorgesetzte; ein noch nicht angebundener Kanal wird ehrlich genannt', async ({ page }) => {
    const backend = await installFakeBackend(page);
    await page.goto('/admin/staff');
    await expect(page.getByText('Noch keine Person erfasst')).toBeVisible();

    await page.getByRole('button', { name: 'Person erfassen' }).click();
    await page.getByLabel('Vorname').fill('Clara');
    await page.getByLabel('Nachname').fill('Chef');
    await page.getByLabel('Rolle im Betrieb').selectOption('OWNER');
    await page.getByLabel('E-Mail-Adresse').fill('clara@betrieb.example');
    await page.getByLabel('Mobil-/Rufnummer').fill('+49 171 1234567');
    await page.getByLabel('So darf ORBIT die Person erreichen').selectOption('WHATSAPP');
    await expect(page.getByText('Dieser Kanal ist noch nicht angebunden – Meldungen gehen vorerst per E-Mail.')).toBeVisible();
    await page.getByLabel('Notfälle/Notdienst').check();
    await page.getByRole('button', { name: 'Speichern' }).click();

    const row = page.getByTestId('staff-row').filter({ hasText: 'Clara Chef' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('WhatsApp');
    await expect(row).toContainText('Zustellung vorerst per E-Mail');
    await expect(row).toContainText('Notfälle/Notdienst');
    expect(backend.requests.find((r) => r.method === 'POST' && r.path === '/')?.body).toMatchObject({ roleKind: 'OWNER', preferredChannel: 'WHATSAPP', responsibilities: ['EMERGENCY'] });

    // Zweite Person mit Vorgesetzter und Vertretung – Auswahl aus dem Verzeichnis.
    await page.getByRole('button', { name: 'Person erfassen' }).click();
    await page.getByLabel('Vorname').fill('Bea');
    await page.getByLabel('Nachname').fill('Buchhaltung');
    await page.getByLabel('E-Mail-Adresse').fill('bea@betrieb.example');
    await page.getByLabel('Vorgesetzte/r').selectOption({ label: 'Clara Chef' });
    await page.getByLabel('Vertretung (bei Krankheit/Urlaub)').selectOption({ label: 'Clara Chef' });
    await page.getByRole('button', { name: 'Speichern' }).click();
    const bea = page.getByTestId('staff-row').filter({ hasText: 'Bea Buchhaltung' });
    await expect(bea).toContainText('Vertretung: Clara Chef');
    await expect(bea).toContainText('Vorgesetzte/r: Clara Chef');
  });

  test('Deaktivieren nimmt die Person aus der Liste, „Auch deaktivierte anzeigen“ zeigt sie wieder, Aktivieren holt sie zurück', async ({ page }) => {
    const backend = await installFakeBackend(page);
    backend.staff.push({ ...baseStaff('x1'), firstName: 'Tim', lastName: 'Monteur', email: 'tim@betrieb.example' });
    await page.goto('/admin/staff');
    const row = page.getByTestId('staff-row').filter({ hasText: 'Tim Monteur' });
    await row.getByRole('button', { name: 'Deaktivieren' }).click();
    await expect(page.getByTestId('staff-row').filter({ hasText: 'Tim Monteur' })).toHaveCount(0);
    await page.getByLabel('Auch deaktivierte anzeigen').check();
    const inactive = page.getByTestId('staff-row').filter({ hasText: 'Tim Monteur' });
    await expect(inactive).toContainText('Deaktiviert');
    await inactive.getByRole('button', { name: 'Aktivieren' }).click();
    await expect(inactive).not.toContainText('Deaktiviert');
  });

  test('CSV: Vorschau mit Zeilenergebnissen, Warnungen und nicht verstandenen Spalten; erst „Übernehmen“ speichert', async ({ page }) => {
    const backend = await installFakeBackend(page);
    await page.goto('/admin/staff');
    const preview = page.getByRole('button', { name: 'Vorschau' });
    await expect(preview).toBeDisabled();

    // Datei hochladen (UTF-8 mit Umlauten).
    await page.getByTestId('staff-csv-file').setInputFiles({ name: 'team.csv', mimeType: 'text/csv', buffer: Buffer.from('Vorname;Nachname;Lieblingsfarbe\nDora;Disposition;Grün\n', 'utf-8') });
    await expect(page.getByLabel('Inhalt (CSV)')).toHaveValue(/Dora;Disposition;Grün/);
    await preview.click();

    const result = page.getByTestId('staff-import-result');
    await expect(result).toContainText('Vorschau – noch nichts gespeichert');
    await expect(result).toContainText('1 neu');
    await expect(result).toContainText('Nicht verstandene Spalten (werden ignoriert): Lieblingsfarbe');
    await expect(result.locator('tr[data-action="CREATE"]')).toContainText('nicht zu finden');
    await expect(result.locator('tr[data-action="ERROR"]')).toContainText('E-Mail-Adresse');
    expect(backend.staff).toHaveLength(0);

    await page.getByRole('button', { name: /^Übernehmen/ }).click();
    await expect(result).toContainText('Übernommen:');
    await expect(page.getByTestId('staff-row').filter({ hasText: 'Dora Disposition' })).toBeVisible();
  });

  test('Die Beispieldatei lässt sich herunterladen; die Schnittstelle ist beschrieben', async ({ page }) => {
    await installFakeBackend(page);
    await page.goto('/admin/staff');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Beispieldatei herunterladen' }).click();
    expect((await download).suggestedFilename()).toBe('mitarbeiter-vorlage.csv');
    await page.getByText('Größere Betriebe: Abgleich über die Schnittstelle').click();
    await expect(page.getByText('PUT /api/v1/staff/sync')).toBeVisible();
  });

  test('Lücken im Verzeichnis werden benannt (hier: keine Leitung)', async ({ page }) => {
    const backend = await installFakeBackend(page);
    backend.staff.push({ ...baseStaff('x2'), firstName: 'Ben', lastName: 'Büro', email: 'ben@betrieb.example' });
    await page.goto('/admin/staff');
    await expect(page.getByTestId('directory-gaps')).toContainText('Inhaber oder Leitung');
  });
});

test.describe('Meldungen am Vorgang', () => {
  test('ein auf Menschen wartender Vorgang zeigt, wer informiert wurde und wie weit die Eskalation ist; „Ich kümmere mich“ beendet die Erinnerungen', async ({ page }) => {
    // Ein echter Vorgang des Demo-Mandanten dient nur als Seite; die Meldungen kommen aus vorgegebenen Antworten (nichts wird gespeichert oder gesendet).
    const token = await loginViaApi(DEMO_USERS.admin);
    const cases = (await (await fetch(`${API_BASE_URL}/api/v1/cases/overview?filter=ALL`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { items: Array<{ id: string }> };
    expect(cases.items.length, 'ein Vorgang des Demo-Mandanten').toBeGreaterThan(0);
    const caseId = cases.items[0]!.id;

    const base = { id: 'a1', kind: 'WAITING_FOR_APPROVAL', state: 'OPEN', phase: 'ESCALATED', emergency: false, since: '2026-10-09T08:00:00.000Z', acknowledgedAt: null };
    const notifications = [
      { person: 'Bea Buchhaltung', role: 'RESPONSIBLE', phase: 'INITIAL', wantedChannel: 'EMAIL', deliveredVia: 'EMAIL', status: 'SENT', executionMode: 'LIVE', note: null, at: '2026-10-09T08:01:00.000Z' },
      { person: 'Vera Vertretung', role: 'DEPUTY', phase: 'REMINDER', wantedChannel: 'EMAIL', deliveredVia: 'EMAIL', status: 'SENT', executionMode: 'LIVE', note: null, at: '2026-10-09T12:01:00.000Z' },
      { person: 'Ben Notdienst', role: 'SUPERVISOR', phase: 'ESCALATED', wantedChannel: 'WHATSAPP', deliveredVia: 'EMAIL', status: 'SENT', executionMode: 'LIVE', note: 'Gewünscht ist WHATSAPP; dieser Kanal ist noch nicht angebunden, deshalb per E-Mail.', at: '2026-10-10T08:01:00.000Z' },
    ];
    let acknowledged = false;
    const acks: string[] = [];
    await page.route(`**/api/v1/attention/cases/${caseId}`, (route) => route.fulfill({ json: { attention: { ...base, state: acknowledged ? 'ACKNOWLEDGED' : 'OPEN', acknowledgedAt: acknowledged ? '2026-10-10T09:00:00.000Z' : null, notifications } } }));
    await page.route('**/api/v1/attention/a1/acknowledge', (route) => {
      acks.push(route.request().method());
      acknowledged = true;
      return route.fulfill({ status: 201, json: {} });
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto(`/cases/${caseId}`);
    const notice = page.getByTestId('case-attention');
    await expect(notice).toContainText('Dieser Vorgang wartet auf einen Menschen.');
    await expect(notice).toContainText('Eskalation läuft');
    await expect(notice).toContainText('Bea Buchhaltung (zuständig)');
    await expect(notice).toContainText('Vera Vertretung (Vertretung)');
    await expect(notice).toContainText('Ben Notdienst (Vorgesetzte/r)');
    await expect(notice).toContainText('per E-Mail (gewünscht: WhatsApp)');

    await notice.getByRole('button', { name: 'Ich kümmere mich darum' }).click();
    await expect(notice).toContainText('Ein Mensch hat den Vorgang übernommen.');
    await expect(notice.getByRole('button', { name: 'Ich kümmere mich darum' })).toHaveCount(0);
    expect(acks).toEqual(['POST']);
  });

  test('ohne offene Meldung erscheint kein Hinweis', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const cases = (await (await fetch(`${API_BASE_URL}/api/v1/cases/overview?filter=ALL`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { items: Array<{ id: string }> };
    const caseId = cases.items[0]!.id;
    await page.route(`**/api/v1/attention/cases/${caseId}`, (route) => route.fulfill({ json: { attention: null } }));
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto(`/cases/${caseId}`);
    await expect(page.getByRole('tablist', { name: 'Bereiche des Vorgangs' })).toBeVisible();
    await expect(page.getByTestId('case-attention')).toHaveCount(0);
  });
});
