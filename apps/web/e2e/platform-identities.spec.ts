import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/login';
import { installPlatformSession, platformApiLogin } from './utils/platform-session';

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

test('Passwort zurücksetzen: Startpasswort nur einmal sichtbar; die Person muss sofort wechseln (alles andere gesperrt) und hat danach vollen Zugang', async ({ page, browser }) => {
  const login = await platformApiLogin(EMAIL as string, PASSWORD as string);
  const auth = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };
  await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: PASSWORD }) });
  const tag = randomBytes(3).toString('hex');
  const email = `ui-reset-${tag}@orbit.local`;
  const name = `UI Reset ${tag}`;
  const oldPassword = `Alt${randomBytes(12).toString('base64url')}#1a`;
  const chosen = `Neu${randomBytes(12).toString('base64url')}#2b`;
  const created = await fetch(api('/identities'), { method: 'POST', headers: auth, body: JSON.stringify({ email, displayName: name, password: oldPassword, roles: ['PLATFORM_AUDITOR'] }) });
  expect(created.ok).toBe(true);
  const identity = (await created.json()) as { id: string };

  try {
    await installPlatformSession(page.context(), login);
    await page.goto('/platform/identities');
    const row = page.getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: `Passwort von ${name} zurücksetzen` }).click();
    await page.getByLabel(/Begründung/).last().fill('UI-Test: Passwort vergessen');
    await page.getByRole('button', { name: 'Passwort zurücksetzen' }).last().click();
    const dialog = page.getByRole('dialog', { name: 'Aktion bestätigen' });
    if (await dialog.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
      await dialog.getByLabel('Passwort').fill(PASSWORD as string);
      await dialog.getByRole('button', { name: 'Bestätigen' }).click();
    }
    const temporary = (await page.getByTestId('temporary-password').textContent()) ?? '';
    expect(temporary.length).toBeGreaterThanOrEqual(14);
    await page.getByRole('button', { name: 'Verstanden, Anzeige schließen' }).click();
    await expect(page.getByTestId('temporary-password')).toHaveCount(0); // einmalig: nicht mehr sichtbar
    await page.reload();
    await expect(page.getByText(temporary)).toHaveCount(0); // und nirgends abrufbar

    // Das alte Passwort gilt nicht mehr; mit dem Startpasswort muss die Person sofort wechseln.
    expect((await fetch(api('/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: oldPassword }) })).status).toBe(401);
    const personContext = await browser.newContext();
    const person = await personContext.newPage();
    await person.goto('/platform/login');
    await person.getByLabel('E-Mail-Adresse').fill(email);
    await person.getByLabel('Passwort').fill(temporary);
    await person.getByRole('button', { name: 'Anmelden' }).click();
    await person.waitForURL('**/platform/account');
    await expect(person.getByRole('alert').filter({ hasText: 'Bitte ändern Sie zuerst Ihr Passwort' })).toBeVisible();
    await expect(person.getByRole('navigation', { name: 'Plattformbereiche' }).getByRole('link')).toHaveCount(0); // keine Bereiche, solange der Wechsel aussteht
    await person.goto('/platform/tenants');
    await person.waitForURL('**/platform/account'); // jeder andere Bereich führt zurück

    const form = person.getByRole('form', { name: 'Passwort ändern' });
    await form.getByLabel('Aktuelles Passwort').fill(temporary);
    await form.getByLabel(/Neues Passwort \(/).fill(chosen);
    await form.getByLabel('Neues Passwort wiederholen').fill(chosen);
    await form.getByRole('button', { name: 'Passwort ändern' }).click();
    await expect(form.getByRole('status')).toContainText('Ihr Passwort wurde geändert.');
    await expect(person.getByRole('navigation', { name: 'Plattformbereiche' }).getByRole('link', { name: 'Audit' })).toBeVisible(); // Zwang entfällt
    await person.goto('/platform/audit');
    await expect(person.getByRole('heading', { name: 'Plattform-Audit' })).toBeVisible();
    await personContext.close();
  } finally {
    await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: PASSWORD }) });
    await fetch(api(`/identities/${identity.id}/disable`), { method: 'POST', headers: auth, body: JSON.stringify({ reason: 'UI-Test beendet' }) });
  }
});
