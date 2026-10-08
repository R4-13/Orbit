import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL, DEMO_PASSWORD, DEMO_USERS, loginViaUi } from './utils/login';
import { installPlatformSession, platformApiLogin } from './utils/platform-session';

/**
 * Plattform-Oberfläche (Amendment 03, /platform/*). Braucht einen echten Betreiberzugang der laufenden Umgebung:
 *   E2E_PLATFORM_EMAIL / E2E_PLATFORM_PASSWORD (Zugang mit Rolle PLATFORM_OWNER, z. B. über scripts/platform-bootstrap.ts angelegt).
 * Ohne diese Variablen werden die Tests übersprungen – sie werden nie mit erfundenen Zugangsdaten ausgeführt.
 */
const EMAIL = process.env.E2E_PLATFORM_EMAIL;
const PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD nicht gesetzt');

/** Legt eine echte Sitzung wie die Anwendung selbst an (httpOnly-Cookie); die Anmeldung über die Oberfläche prüft ein eigener Test. */
async function loginViaApiSession(page: Page): Promise<void> {
  await installPlatformSession(page.context(), await platformApiLogin(EMAIL as string, PASSWORD as string));
}

test.describe('Plattformbetrieb (UI)', () => {
  test('ohne Sitzung führt /platform zur Betreiber-Anmeldung', async ({ page }) => {
    await page.goto('/platform');
    await page.waitForURL('**/platform/login');
    await expect(page.getByRole('heading', { name: /Plattformbetrieb/ })).toBeVisible();
  });

  test('falsches Passwort und Mandantenzugang werden abgewiesen, ohne Hinweis auf das Konto', async ({ page }) => {
    await page.goto('/platform/login');
    await page.getByLabel('E-Mail-Adresse').fill(EMAIL as string);
    await page.getByLabel('Passwort').fill('falsches-Passwort-123!');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.locator('main p[role="alert"]')).toHaveText('E-Mail-Adresse oder Passwort ist nicht korrekt.');

    await page.getByLabel('E-Mail-Adresse').fill(DEMO_USERS.admin);
    await page.getByLabel('Passwort').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.locator('main p[role="alert"]')).toHaveText('E-Mail-Adresse oder Passwort ist nicht korrekt.');
    await expect(page).toHaveURL(/\/platform\/login$/);
  });

  test('Anmeldung über die Oberfläche zeigt Übersicht, Umgebung und Rollen', async ({ page }) => {
    await page.goto('/platform/login');
    await page.getByLabel('E-Mail-Adresse').fill(EMAIL as string);
    await page.getByLabel('Passwort').fill(PASSWORD as string);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForURL(/\/platform$/);
    await expect(page.getByRole('heading', { name: 'Plattformübersicht' })).toBeVisible();
    await expect(page.getByText(/Umgebung: /).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mein Zugang und Passwort' })).toContainText('Owner'); // Rolle in Alltagssprache, nie der technische Schlüssel
    const nav = page.getByRole('navigation', { name: 'Plattformbereiche' });
    for (const label of ['Übersicht', 'Mandanten', 'KI-Steuerung', 'Notschalter und Anbindungen', 'Audit']) await expect(nav.getByRole('link', { name: label })).toBeVisible();
    // Es liegt nichts im Browser-Speicher: das Zugangstoken lebt nur im Arbeitsspeicher, das Refresh-Token nur in einem httpOnly-Cookie (für Skripte unlesbar).
    const storage = await page.evaluate(() => ({ session: window.sessionStorage.length, local: window.localStorage.getItem('orbit.platform.auth'), tenant: window.localStorage.getItem('orbit.auth'), readableCookie: document.cookie }));
    expect(storage).toEqual({ session: 0, local: null, tenant: null, readableCookie: '' });
    const cookie = (await page.context().cookies()).find((c) => c.name === 'orbit_platform_rt');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/platform/auth' });
    // Neuladen: die Sitzung wird über das Cookie wiederhergestellt, ohne erneute Anmeldung.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Plattformübersicht' })).toBeVisible();
    // Abmelden löscht das Cookie; danach führt jeder Aufruf zur Anmeldung.
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await page.waitForURL('**/platform/login');
    expect((await page.context().cookies()).some((c) => c.name === 'orbit_platform_rt')).toBe(false);
    await page.goto('/platform');
    await page.waitForURL('**/platform/login');
  });

  test('mehrere Tabs gleichzeitig: alle stellen die Sitzung über das rotierende Cookie wieder her (Refresh wird tab-übergreifend serialisiert)', async ({ page }) => {
    await loginViaApiSession(page);
    const tabs = [page, await page.context().newPage(), await page.context().newPage()];
    await Promise.all(tabs.map((tab) => tab.goto('/platform')));
    for (const tab of tabs) await expect(tab.getByRole('heading', { name: 'Plattformübersicht' })).toBeVisible();
    // Auch nach erneutem gleichzeitigem Laden bleibt jede Sitzung bestehen – das Cookie wurde nicht durch parallele Rotation entwertet.
    await Promise.all(tabs.map((tab) => tab.reload()));
    for (const tab of tabs) await expect(tab.getByRole('heading', { name: 'Plattformübersicht' })).toBeVisible();
  });

  test('Mandanten, KI-Steuerung und Audit laden ohne Fehlerzustand', async ({ page }) => {
    await loginViaApiSession(page);
    await page.goto('/platform/tenants');
    await expect(page.getByRole('heading', { name: 'Mandanten' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Zustand' })).toBeVisible();
    await page.getByLabel('Suche').fill('musterwerk');
    await expect(page.getByRole('cell', { name: /Musterwerk/ }).first()).toBeVisible();

    await page.goto('/platform/ai');
    await expect(page.getByRole('heading', { name: 'KI-Steuerung' })).toBeVisible();
    await expect(page.getByText(/Registrierte Adapter/)).toBeVisible();

    await page.goto('/platform/audit');
    await expect(page.getByRole('heading', { name: 'Plattform-Audit' })).toBeVisible();
    await expect(page.getByText('PLATFORM_LOGIN').first()).toBeVisible();
    await expect(page.getByText(/Etwas ist schiefgelaufen|konnte nicht geladen/)).toHaveCount(0);
  });

  test('Notschalter: Änderung verlangt erneute Passwortprüfung; Abbruch ändert nichts; auslösen und lösen wird bestätigt angezeigt', async ({ page }) => {
    await loginViaApiSession(page);
    await page.goto('/platform/control');
    const card = page.getByTestId('kill-switch-planner.adaptive');
    await expect(card.getByText('Nicht ausgelöst')).toBeVisible();

    // Begründung ist Pflicht (mindestens 5 Zeichen); Abbruch des Passwortdialogs ändert nichts.
    await card.getByRole('button', { name: 'Notschalter auslösen' }).click();
    const confirm = card.getByRole('button', { name: 'Jetzt auslösen' });
    await expect(confirm).toBeDisabled();
    await card.getByLabel(/Begründung/).fill('UI-Test: Notschalter ausloesen');
    await confirm.click();
    const dialog = page.getByRole('dialog', { name: 'Aktion bestätigen' });
    // Die Bestätigung gilt kurz; war bereits ein Step-up aktiv, erscheint der Dialog nicht und der Schalter ist sofort gesetzt.
    const stepUpShown = await dialog.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
    if (stepUpShown) {
      await dialog.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(card.getByText('Nicht ausgelöst')).toBeVisible();
      await card.getByRole('button', { name: 'Jetzt auslösen' }).click();
      await page.getByRole('dialog', { name: 'Aktion bestätigen' }).getByLabel('Passwort').fill(PASSWORD as string);
      await page.getByRole('dialog', { name: 'Aktion bestätigen' }).getByRole('button', { name: 'Bestätigen' }).click();
    }
    await expect(card.getByText('Aktiv – Funktion gestoppt')).toBeVisible();

    await card.getByRole('button', { name: 'Notschalter lösen' }).click();
    await card.getByLabel(/Begründung/).fill('UI-Test: Notschalter wieder loesen');
    await card.getByRole('button', { name: 'Jetzt lösen' }).click();
    await expect(card.getByText('Nicht ausgelöst')).toBeVisible();

    // Beide Änderungen stehen mit Begründung im Audit.
    await page.goto('/platform/audit');
    await expect(page.getByText('UI-Test: Notschalter wieder loesen').first()).toBeVisible();
  });

  test('Mandantenzustand: Wirkung vorab, Begründung Pflicht, Bestätigung gebunden an die Vorschau; Funktionsgruppe setzen und wieder entfernen', async ({ page }) => {
    // Der Demo-Mandant wird nur um eine Funktionsgruppe ergänzt (wirkt auf keinen Zugriff) und danach zurückgesetzt.
    const tenantLogin = (await (await fetch(`${API_BASE_URL}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEMO_USERS.admin, password: DEMO_PASSWORD }) })).json()) as { user: { tenantId: string } };
    const platformLogin = (await (await fetch(`${API_BASE_URL}/api/v1/platform/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()) as { accessToken: string };
    const tenants = (await (await fetch(`${API_BASE_URL}/api/v1/platform/tenants`, { headers: { Authorization: `Bearer ${platformLogin.accessToken}` } })).json()) as Array<{ tenantId: string; slug: string; displayName: string }>;
    const demo = tenants.find((t) => t.tenantId === tenantLogin.user.tenantId);
    expect(demo, 'Demo-Mandant in der Plattformliste').toBeTruthy();

    await loginViaApiSession(page);
    await page.goto('/platform/tenants');
    await page.getByLabel('Suche').fill(demo!.slug);
    const open = async () => {
      // Mehrere Mandanten können gleich heißen und die Suche ist eine Teilsuche: die Zeile wird über die exakte Kennung gewählt.
      await page.getByRole('row').filter({ has: page.getByText(demo!.slug, { exact: true }) }).getByRole('button', { name: `Zustand von ${demo!.displayName} ändern` }).click();
      return page.getByLabel(`Zustand von ${demo!.displayName} ändern`, { exact: true }).last();
    };

    let panel = await open();
    await expect(panel.getByRole('button', { name: 'Wirkung ansehen' })).toBeDisabled(); // ohne Änderung gibt es nichts zu bestätigen
    await panel.getByLabel('Funktionsgruppen (Kohorten)').fill('ui-test');
    await panel.getByRole('button', { name: 'Wirkung ansehen' }).click();
    await expect(panel.getByText(/Betroffen: \d+ aktive Benutzer/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Änderung bestätigen' })).toBeDisabled(); // Begründung fehlt

    // Eine Änderung am Ziel verwirft die Vorschau: bestätigt wird nur, was angezeigt wurde.
    await panel.getByLabel('Funktionsgruppen (Kohorten)').fill('ui-test, ui-test-b');
    await expect(panel.getByRole('button', { name: 'Wirkung ansehen' })).toBeVisible();
    await panel.getByLabel('Funktionsgruppen (Kohorten)').fill('ui-test');
    await panel.getByRole('button', { name: 'Wirkung ansehen' }).click();

    await panel.getByLabel(/Begründung/).fill('UI-Test: Funktionsgruppe setzen');
    await panel.getByRole('button', { name: 'Änderung bestätigen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Aktion bestätigen' });
    if (await dialog.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
      await dialog.getByLabel('Passwort').fill(PASSWORD as string);
      await dialog.getByRole('button', { name: 'Bestätigen' }).click();
    }
    await expect(page.getByRole('row').filter({ has: page.getByText(demo!.slug, { exact: true }) }).getByText('Funktionsgruppen: ui-test')).toBeVisible();

    // Zurücksetzen.
    panel = await open();
    await panel.getByLabel('Funktionsgruppen (Kohorten)').fill('');
    await panel.getByRole('button', { name: 'Wirkung ansehen' }).click();
    await panel.getByLabel(/Begründung/).fill('UI-Test: Funktionsgruppe entfernen');
    await panel.getByRole('button', { name: 'Änderung bestätigen' }).click();
    await expect(page.getByText('Funktionsgruppen: ui-test')).toHaveCount(0);

    await page.goto('/platform/audit');
    await page.getByLabel('Ereignistyp').fill('PLATFORM_TENANT_LIFECYCLE_CHANGED');
    await expect(page.getByText('UI-Test: Funktionsgruppe entfernen').first()).toBeVisible();
  });

  test('Feature-Flags: anlegen (Entwurf), Verteilung sehen, aktivieren mit Begründung, zurückziehen – alles im Audit', async ({ page }) => {
    await loginViaApiSession(page);
    const key = `ui.test_${Math.random().toString(16).slice(2, 8)}`;
    await page.goto('/platform/features');
    await expect(page.getByRole('heading', { name: 'Feature-Flags' })).toBeVisible();
    await page.getByRole('button', { name: 'Neues Flag' }).click();
    const form = page.getByRole('form', { name: 'Feature-Flag anlegen' });
    await form.getByLabel('Schlüssel').fill(key);
    await form.getByLabel('Verantwortlich').fill('UI-Test');
    await form.getByLabel('Beschreibung').fill('UI-Test: Flag wird nach dem Test zurückgezogen');
    await form.getByRole('button', { name: 'Flag anlegen' }).click();
    const stepUp = page.getByRole('dialog', { name: 'Aktion bestätigen' });
    if (await stepUp.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
      await stepUp.getByLabel('Passwort').fill(PASSWORD as string);
      await stepUp.getByRole('button', { name: 'Bestätigen' }).click();
    }
    const row = page.getByRole('row').filter({ hasText: key });
    await expect(row.locator('span').getByText('Entwurf', { exact: true })).toBeVisible();

    const edit = async (reason: string, change: () => Promise<void>) => {
      await row.getByRole('button', { name: `Flag ${key} ändern` }).click();
      const panel = page.getByLabel(`Flag ${key} ändern`, { exact: true }).last();
      await expect(panel.getByText(/Aktuell für \d+ Mandanten/)).toBeVisible(); // die Verteilung ist vor der Änderung sichtbar
      await expect(panel.getByRole('button', { name: 'Änderung prüfen' })).toBeDisabled();
      await change.call(null);
      await panel.getByRole('button', { name: 'Änderung prüfen' }).click();
      await expect(panel.getByRole('button', { name: 'Änderung bestätigen' })).toBeDisabled(); // Begründung fehlt
      await panel.getByLabel(/Begründung/).fill(reason);
      await panel.getByRole('button', { name: 'Änderung bestätigen' }).click();
    };
    await edit('UI-Test: Flag aktivieren', async () => {
      await page.getByLabel('Lebenszyklus').selectOption('ACTIVE');
      await page.getByLabel('Standardwert').selectOption('true');
    });
    await expect(row.locator('span').getByText('Aktiv', { exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'An', exact: true })).toBeVisible();

    await edit('UI-Test: Flag zurückziehen', async () => {
      await page.getByLabel('Lebenszyklus').selectOption('RETIRED');
    });
    await expect(row.locator('span').getByText('Zurückgezogen', { exact: true })).toBeVisible();

    await page.goto('/platform/audit');
    await page.getByLabel('Ereignistyp').fill('PLATFORM_FEATURE_FLAG_CHANGED');
    await expect(page.getByText('UI-Test: Flag zurückziehen').first()).toBeVisible();
  });

  test('Übersicht: Hintergrundverarbeitung zeigt echte Messwerte beider Warteschlangen; mit laufendem Worker nicht „steht still“', async ({ page }) => {
    await loginViaApiSession(page);
    await page.goto('/platform');
    const card = page.getByRole('heading', { name: /Hintergrundverarbeitung/ }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await expect(card.getByText('Abläufe und Vorgänge')).toBeVisible();
    await expect(card.getByText('Postfach-Abgleich')).toBeVisible();
    await expect(card.getByText(/\d+ Worker verbunden · \d+ wartend/).first()).toBeVisible();
    await expect(card.getByText(/Gemessen .*aktualisiert sich alle 15 Sekunden/)).toBeVisible();
    // Der Docker-Stack läuft mit Worker: dann darf keine Warteschlange „Steht still“ melden (ohne Worker wäre genau das richtig).
    await expect(card.getByText('Steht still')).toHaveCount(0);
    await expect(page.getByText('Queue/Worker-Gesundheit')).toHaveCount(0); // steht nicht mehr unter „Noch nicht verfügbar“
  });

  test('Banner: bei laufendem Worker nicht sichtbar; bei Stillstand (simulierte Antwort) auf jeder Plattformseite mit dem Grund, bei Stau als Hinweis', async ({ page }) => {
    await loginViaApiSession(page);
    await page.goto('/platform/audit');
    await expect(page.getByRole('heading', { name: 'Plattform-Audit' })).toBeVisible();
    await expect(page.getByText(/Hintergrundverarbeitung (steht still|ist eingeschränkt)/)).toHaveCount(0); // echter Stack: Worker läuft

    // Die Darstellung bei Ausfall und Stau wird mit vorgegebenen Antworten geprüft (der echte Ausfall ist per API-E2E und live belegt).
    const queue = (over: Record<string, unknown>) => ({ name: 'workflow-runs', waiting: 0, active: 0, delayed: 0, failed: 0, workers: 1, oldestWaitingAgeSec: null, status: 'OK', note: '', ...over });
    let health: Record<string, unknown> = { status: 'DOWN', checkedAt: new Date().toISOString(), queues: [queue({ workers: 0, status: 'DOWN', note: 'Kein Worker verbunden: Aufträge dieser Warteschlange werden nicht bearbeitet.' })] };
    await page.route('**/api/v1/platform/runtime', (route) => route.fulfill({ json: health }));
    await page.goto('/platform/tenants');
    const down = page.getByRole('alert').filter({ hasText: 'Hintergrundverarbeitung steht still.' });
    await expect(down).toBeVisible();
    await expect(down).toContainText('Kein Worker verbunden');
    await page.goto('/platform/support');
    await expect(page.getByRole('alert').filter({ hasText: 'Hintergrundverarbeitung steht still.' })).toBeVisible(); // auf jeder Seite

    health = { status: 'DEGRADED', checkedAt: new Date().toISOString(), queues: [queue({ waiting: 5, oldestWaitingAgeSec: 900, status: 'DEGRADED', note: 'Der älteste wartende Auftrag wartet seit 15 Minuten; die Verarbeitung kommt nicht hinterher.' })] };
    await page.goto('/platform/features');
    const degraded = page.getByRole('status').filter({ hasText: 'Hintergrundverarbeitung ist eingeschränkt.' });
    await expect(degraded).toBeVisible();
    await expect(degraded).toContainText('15 Minuten');
  });

  test('Diagnose: Vorgang laden (begründet, nur Metadaten) und als Datei exportieren (Step-up, Prüfsumme im Audit)', async ({ page }) => {
    // Ein echter Vorgang des Demo-Mandanten (von den vorherigen Specs angelegt).
    const tenantLogin = (await (await fetch(`${API_BASE_URL}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEMO_USERS.admin, password: DEMO_PASSWORD }) })).json()) as { accessToken: string; user: { tenantId: string } };
    const cases = (await (await fetch(`${API_BASE_URL}/api/v1/cases/overview?filter=ALL`, { headers: { Authorization: `Bearer ${tenantLogin.accessToken}` } })).json()) as { items: Array<{ id: string }> };
    expect(cases.items.length, 'ein Vorgang des Demo-Mandanten').toBeGreaterThan(0);
    const caseId = cases.items[0]!.id;
    const tenants = (await (await fetch(`${API_BASE_URL}/api/v1/platform/tenants`, { headers: { Authorization: `Bearer ${(await platformApiLogin(EMAIL as string, PASSWORD as string)).accessToken}` } })).json()) as Array<{ tenantId: string; slug: string; displayName: string }>;
    const demo = tenants.find((t) => t.tenantId === tenantLogin.user.tenantId)!;

    await loginViaApiSession(page);
    await page.goto('/platform/diagnostics');
    const form = page.getByRole('form', { name: 'Diagnose abrufen' });
    await expect(form.getByRole('button', { name: 'Diagnose laden' })).toBeDisabled();
    await form.getByLabel('Mandant').selectOption(demo.tenantId);
    await form.getByLabel('Vorgangs-ID').fill(caseId);
    await form.getByLabel(/Begründung/).fill('UI-Test: Diagnose prüfen');
    await form.getByRole('button', { name: 'Diagnose laden' }).click();
    await expect(page.getByRole('heading', { name: /^Vorgang / })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Schritt' })).toBeVisible();

    // Export: Datei mit Kopfdaten, ohne Secrets; die Seite zeigt den Hinweis auf das Audit.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Als Datei exportieren (JSON)' }).click();
    const stepUp = page.getByRole('dialog', { name: 'Aktion bestätigen' });
    if (await stepUp.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
      await stepUp.getByLabel('Passwort').fill(PASSWORD as string);
      await stepUp.getByRole('button', { name: 'Bestätigen' }).click();
    }
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`diagnose-${caseId}.json`);
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk;
    const file = JSON.parse(text) as { exportVersion: number; reason: string; projection: { caseId: string } };
    expect(file).toMatchObject({ exportVersion: 1, reason: 'UI-Test: Diagnose prüfen', projection: { caseId } });
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{10,}|sk-[A-Za-z0-9]{10,}/);
    await expect(page.getByRole('status').filter({ hasText: 'Exportiert als' })).toBeVisible();

    await page.goto('/platform/audit');
    await page.getByLabel('Ereignistyp').fill('PLATFORM_DIAGNOSTIC_EXPORTED');
    await expect(page.getByText('PLATFORM_DIAGNOSTIC_EXPORTED').first()).toBeVisible();
  });

  test('Übersicht: Arbeitsstand zeigt echte Zähler; Aufmerksamkeit nur bei hängenden Vorgängen oder ungewissen Aktionen (simulierte Antwort)', async ({ page }) => {
    await loginViaApiSession(page);
    await page.goto('/platform');
    const card = page.getByTestId('work-backlog');
    await expect(card.getByRole('heading', { name: /Arbeitsstand/ })).toBeVisible();
    for (const label of ['Erwartungen offen', 'Wiederholungen geplant', 'Vorgänge in manueller Prüfung', 'Fehlgeschlagene Schritte (24 h)']) await expect(card.getByText(label)).toBeVisible();
    await expect(card.getByText(/Nur Zähler über alle Mandanten/)).toBeVisible();

    // Darstellung der Aufmerksamkeit mit vorgegebener Antwort (der echte Zustand hängt vom Datenbestand ab).
    const backlog = { checkedAt: new Date().toISOString(), openWaits: 4, overdueWaits: 1, scheduledRetries: 2, dueRetries: 0, stuckCases: 2, casesInReview: 1, unknownOutcomes: 1, failedSteps24h: 3 };
    await page.route('**/api/v1/platform/runtime/work', (route) => route.fulfill({ json: backlog }));
    await page.goto('/platform');
    const attention = page.getByTestId('work-backlog');
    await expect(attention.getByText('Braucht Aufmerksamkeit')).toBeVisible();
    await expect(attention.getByRole('alert')).toContainText('2 Vorgänge kommen trotz offener Arbeit nicht voran.');
    await expect(attention.getByRole('alert')).toContainText('1 Aktion hat ein ungewisses Ergebnis');
    await expect(attention.getByText('1 mit überschrittener Frist')).toBeVisible();
  });

  test('Diagnose: Kennung suchen (begründet) findet Mandant und Vorgang und übernimmt sie in die Diagnose; Unbekanntes liefert keine Treffer', async ({ page }) => {
    const tenantLogin = (await (await fetch(`${API_BASE_URL}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEMO_USERS.admin, password: DEMO_PASSWORD }) })).json()) as { accessToken: string; user: { tenantId: string } };
    const cases = (await (await fetch(`${API_BASE_URL}/api/v1/cases/overview?filter=ALL`, { headers: { Authorization: `Bearer ${tenantLogin.accessToken}` } })).json()) as { items: Array<{ id: string }> };
    expect(cases.items.length, 'ein Vorgang des Demo-Mandanten').toBeGreaterThan(0);
    const caseId = cases.items[0]!.id;

    await loginViaApiSession(page);
    await page.goto('/platform/diagnostics');
    const search = page.getByRole('form', { name: 'Kennung suchen' });
    await expect(search.getByRole('button', { name: 'Suchen' })).toBeDisabled();
    await search.getByLabel('Kennung').fill(caseId);
    await search.getByLabel(/Begründung/).fill('UI-Test: Kennung suchen');
    await search.getByRole('button', { name: 'Suchen' }).click();
    const hit = search.getByRole('list', { name: 'Treffer' }).getByRole('listitem').first();
    await expect(hit).toContainText('Vorgang');
    await expect(hit).toContainText(caseId);
    await hit.getByRole('button', { name: 'In Diagnose übernehmen' }).click();

    const form = page.getByRole('form', { name: 'Diagnose abrufen' });
    await expect(form.getByLabel('Vorgangs-ID')).toHaveValue(caseId);
    await expect(form.getByLabel(/Begründung/)).toHaveValue('UI-Test: Kennung suchen');
    await form.getByRole('button', { name: 'Diagnose laden' }).click();
    await expect(page.getByRole('heading', { name: /^Vorgang / })).toBeVisible();

    await search.getByLabel('Kennung').fill('00000000-0000-4000-8000-000000000000');
    await search.getByRole('button', { name: 'Suchen' }).click();
    await expect(search.getByRole('status')).toContainText('Keine Treffer');

    await page.goto('/platform/audit');
    await page.getByLabel('Ereignistyp').fill('PLATFORM_DIAGNOSTICS_READ');
    await expect(page.getByText('PLATFORM_DIAGNOSTICS_READ').first()).toBeVisible();
  });

  test('keine Verbindung zwischen den Domänen: die Mandanten-Oberfläche verlinkt den Plattformbereich nicht, ein Mandantenzugang öffnet ihn nicht', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.admin);
    await expect(page.locator('a[href^="/platform"]')).toHaveCount(0);
    await page.goto('/platform');
    await page.waitForURL('**/platform/login');
  });

  test('axe: keine A/AA-Verstöße auf Anmeldung, Übersicht und Notschaltern', async ({ page }) => {
    await page.goto('/platform/login');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await loginViaApiSession(page);
    for (const path of ['/platform', '/platform/control']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Plattformbereiche' })).toBeVisible();
      await expect(page.getByText('Wird geladen …')).toHaveCount(0);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations, path).toEqual([]);
    }
  });
});
