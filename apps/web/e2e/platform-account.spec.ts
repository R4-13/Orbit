import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/login';

/**
 * Eigener Zugang (Amendment 03 §3): Passwortwechsel durch die Person selbst. Die Test-Person legt der Owner per API an und deaktiviert sie am Ende.
 */
const OWNER_EMAIL = process.env.E2E_PLATFORM_EMAIL;
const OWNER_PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, 'E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD nicht gesetzt');

const api = (path: string) => `${API_BASE_URL}/api/v1/platform${path}`;
const json = { 'Content-Type': 'application/json' };

test('Passwortwechsel: Eingaben werden vorab geprüft, ein falsches aktuelles Passwort wird abgewiesen, andere Sitzungen enden, das neue Passwort gilt', async ({ page }) => {
  const owner = (await (await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }) })).json()) as { accessToken: string };
  const auth = { Authorization: `Bearer ${owner.accessToken}`, ...json };
  await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: OWNER_PASSWORD }) });

  const tag = randomBytes(3).toString('hex');
  const email = `ui-account-${tag}@orbit.local`;
  const oldPassword = `Alt${randomBytes(12).toString('base64url')}#1a`;
  const newPassword = `Neu${randomBytes(12).toString('base64url')}#2b`;
  const created = await fetch(api('/identities'), { method: 'POST', headers: auth, body: JSON.stringify({ email, displayName: `UI Konto ${tag}`, password: oldPassword, roles: ['PLATFORM_AUDITOR'] }) });
  expect(created.ok, `Identität anlegen: ${created.status}`).toBe(true);
  const identity = (await created.json()) as { id: string };

  try {
    // Eine zweite, parallele Sitzung (z. B. ein anderes Gerät).
    const otherDevice = (await (await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email, password: oldPassword }) })).json()) as { accessToken: string };

    await page.goto('/platform/login');
    await page.getByLabel('E-Mail-Adresse').fill(email);
    await page.getByLabel('Passwort').fill(oldPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForURL(/\/platform$/);
    await page.getByRole('link', { name: 'Mein Zugang und Passwort' }).click();
    await expect(page.getByRole('heading', { name: 'Mein Zugang' })).toBeVisible();

    const form = page.getByRole('form', { name: 'Passwort ändern' });
    const submit = form.getByRole('button', { name: 'Passwort ändern' });
    await form.getByLabel('Aktuelles Passwort').fill(oldPassword);
    await form.getByLabel(/Neues Passwort \(/).fill('zu-kurz');
    await expect(form.getByText(/Noch \d+ Zeichen bis zur Mindestlänge/)).toBeVisible();
    await expect(submit).toBeDisabled();
    await form.getByLabel(/Neues Passwort \(/).fill(newPassword);
    await form.getByLabel('Neues Passwort wiederholen').fill(`${newPassword}x`);
    await expect(form.getByText('Die beiden neuen Passwörter stimmen nicht überein.')).toBeVisible();
    await expect(submit).toBeDisabled();

    // Falsches aktuelles Passwort.
    await form.getByLabel('Neues Passwort wiederholen').fill(newPassword);
    await form.getByLabel('Aktuelles Passwort').fill('falsch-falsch-falsch');
    await submit.click();
    await expect(form.getByRole('alert')).toHaveText('Das aktuelle Passwort ist nicht korrekt.');

    // Richtiger Wechsel.
    await form.getByLabel('Aktuelles Passwort').fill(oldPassword);
    await submit.click();
    await expect(form.getByRole('status')).toContainText('Ihr Passwort wurde geändert.');
    await expect(form.getByRole('status')).toContainText('andere Sitzung');

    // Die andere Sitzung ist beendet, die hiesige besteht weiter, das alte Passwort gilt nicht mehr, das neue schon.
    expect((await fetch(api('/me'), { headers: { Authorization: `Bearer ${otherDevice.accessToken}` } })).status).toBe(401);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mein Zugang' })).toBeVisible();
    expect((await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email, password: oldPassword }) })).status).toBe(401);
    expect((await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email, password: newPassword }) })).ok).toBe(true);
  } finally {
    await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: OWNER_PASSWORD }) });
    await fetch(api(`/identities/${identity.id}/disable`), { method: 'POST', headers: auth, body: JSON.stringify({ reason: 'UI-Test beendet' }) });
  }
});
