import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL, DEMO_PASSWORD, DEMO_USERS, loginViaUi } from './utils/login';

/**
 * Plattform-Oberfläche (Amendment 03, /platform/*). Braucht einen echten Betreiberzugang der laufenden Umgebung:
 *   E2E_PLATFORM_EMAIL / E2E_PLATFORM_PASSWORD (Zugang mit Rolle PLATFORM_OWNER, z. B. über scripts/platform-bootstrap.ts angelegt).
 * Ohne diese Variablen werden die Tests übersprungen – sie werden nie mit erfundenen Zugangsdaten ausgeführt.
 */
const EMAIL = process.env.E2E_PLATFORM_EMAIL;
const PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD nicht gesetzt');

/** Meldet über die echte Plattform-API an und legt die Sitzung vor dem ersten Seitenaufruf ab (die Anmeldung selbst prüft der UI-Test). */
async function loginViaApiSession(page: Page): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  expect(response.ok, `Plattform-Login über die API: ${response.status}`).toBe(true);
  const data = (await response.json()) as { accessToken: string; refreshToken: string; principal: unknown };
  await page.addInitScript((auth) => window.sessionStorage.setItem('orbit.platform.auth', JSON.stringify(auth)), { accessToken: data.accessToken, refreshToken: data.refreshToken, principal: data.principal });
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
    await expect(page.getByText(/PLATFORM_OWNER/)).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Plattformbereiche' });
    for (const label of ['Übersicht', 'Mandanten', 'KI-Steuerung', 'Notschalter und Anbindungen', 'Audit']) await expect(nav.getByRole('link', { name: label })).toBeVisible();
    // Die Sitzung liegt im Tab-Speicher, nicht im Mandanten-Speicher und nicht im dauerhaften Browser-Speicher.
    const storage = await page.evaluate(() => ({ session: window.sessionStorage.getItem('orbit.platform.auth') !== null, tenant: window.localStorage.getItem('orbit.auth'), platformInLocal: window.localStorage.getItem('orbit.platform.auth') }));
    expect(storage).toEqual({ session: true, tenant: null, platformInLocal: null });
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
