import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/login';
import { installPlatformSession } from './utils/platform-session';

/**
 * Betreiberzugänge in der Plattform-Oberfläche (Amendment 03 §2, §4): anlegen, Rollen ändern, deaktivieren – jeweils mit Begründung und Passwortbestätigung.
 * Die Test-Person wird am Ende deaktiviert (Zugänge lassen sich nicht löschen, sie bleiben für das Audit erhalten).
 */
const EMAIL = process.env.E2E_PLATFORM_EMAIL;
const PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD nicht gesetzt');

const api = (path: string) => `${API_BASE_URL}/api/v1/platform${path}`;
const json = { 'Content-Type': 'application/json' };

test('Betreiberzugänge: anlegen, Rollen ändern, deaktivieren; die deaktivierte Person kann sich nicht mehr anmelden', async ({ page }) => {
  const login = (await (await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()) as { accessToken: string; refreshToken: string; principal: unknown };
  await installPlatformSession(page.context(), login);

  const tag = randomBytes(3).toString('hex');
  const email = `ui-ident-${tag}@orbit.local`;
  const name = `UI Zugang ${tag}`;
  const password = `Id${randomBytes(12).toString('base64url')}#2y`;
  const confirmWithPassword = async () => {
    const dialog = page.getByRole('dialog', { name: 'Aktion bestätigen' });
    if (await dialog.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
      await dialog.getByLabel('Passwort').fill(PASSWORD as string);
      await dialog.getByRole('button', { name: 'Bestätigen' }).click();
    }
  };

  await page.goto('/platform/identities');
  await expect(page.getByRole('heading', { name: 'Betreiberzugänge' })).toBeVisible();
  await page.getByRole('button', { name: 'Zugang anlegen' }).click();
  const form = page.getByRole('form', { name: 'Betreiberzugang anlegen' });
  await expect(form.getByRole('button', { name: 'Zugang anlegen' })).toBeDisabled(); // ohne Rolle nicht anlegbar
  await form.getByLabel('E-Mail-Adresse').fill(email);
  await form.getByLabel('Name').fill(name);
  await form.getByLabel(/Startpasswort/).fill(password);
  await form.locator('#id-new-role-PLATFORM_SUPPORT').check();
  await form.getByRole('button', { name: 'Zugang anlegen' }).click();
  await confirmWithPassword();
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row.getByText('Support', { exact: true })).toBeVisible();
  await expect(row.locator('span').getByText('Aktiv', { exact: true })).toBeVisible();

  // Die neue Person kann sich anmelden.
  const first = await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
  expect(first.ok).toBe(true);

  // Rollen ändern: Wirkung steht vorab da, Begründung ist Pflicht.
  await row.getByRole('button', { name: `Rollen von ${name} ändern` }).click();
  const editor = page.getByLabel(`Rollen von ${name} ändern`, { exact: true }).last();
  await expect(editor.getByRole('button', { name: 'Änderung prüfen' })).toBeDisabled();
  await editor.locator('input[id$="-PLATFORM_AUDITOR"]').check();
  await editor.getByRole('button', { name: 'Änderung prüfen' }).click();
  await expect(editor.getByText(/Alle laufenden Sitzungen dieser Person enden sofort/)).toBeVisible();
  await editor.getByLabel(/Begründung/).fill('UI-Test: Rolle ergänzen');
  await editor.getByRole('button', { name: 'Rollen ändern' }).click();
  await confirmWithPassword();
  await expect(row.getByText('Support, Audit', { exact: true })).toBeVisible();

  // Die Rollenänderung beendet die laufende Sitzung der Person sofort.
  const session = (await first.json()) as { accessToken: string };
  expect((await fetch(api('/me'), { headers: { Authorization: `Bearer ${session.accessToken}` } })).status).toBe(401);

  // Deaktivieren.
  await row.getByRole('button', { name: `Zugang von ${name} deaktivieren` }).click();
  await page.getByLabel(/Begründung/).last().fill('UI-Test: Zugang beenden');
  await page.getByRole('button', { name: 'Zugang deaktivieren' }).last().click();
  await confirmWithPassword();
  await expect(row.locator('span').getByText('Deaktiviert', { exact: true })).toBeVisible();
  expect((await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).status).toBe(401);

  // Der eigene Zugang trägt „(Sie)“; der letzte aktive Owner lässt sich nicht deaktivieren (Serverregel).
  await expect(page.getByText('(Sie)')).toBeVisible();
});
