import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/login';
import { installPlatformSession } from './utils/platform-session';

/**
 * KI-Steuerung in der Plattform-Oberfläche (Amendment 03 §9–12): Profil veröffentlichen, Route anlegen, Vorprüfung der Aktivierung.
 * Die Testdaten (Anbieter, Modell, Profil mit eindeutigem Schlüssel) legt der Test über die API an; sie berühren keine echte Konfiguration:
 * das Profil `UI_TEST_*` hat keinen Aufrufer, und die Route wird bewusst **nicht** aktiviert – ohne Verbindung und ohne freigegebenes Modell ist sie
 * auch nicht aktivierbar, was die Oberfläche mit den Gründen zeigt. Die erfolgreiche Aktivierung belegt der API-E2E `platform-ai-governance`.
 * Registereinträge lassen sich nicht löschen; die Testdaten bleiben als Entwurf/ohne aktive Route zurück.
 */
const EMAIL = process.env.E2E_PLATFORM_EMAIL;
const PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD nicht gesetzt');

const api = (path: string) => `${API_BASE_URL}/api/v1/platform${path}`;
const json = { 'Content-Type': 'application/json' };

test('KI-Routen: Profil veröffentlichen, Route anlegen, Aktivierung wird mit Gründen vorab abgelehnt – nichts wird aktiv', async ({ page }) => {
  const login = (await (await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()) as { accessToken: string; refreshToken: string; principal: unknown };
  const auth = { Authorization: `Bearer ${login.accessToken}`, ...json };
  expect((await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: PASSWORD }) })).ok).toBe(true);

  const tag = randomBytes(3).toString('hex');
  const providerKey = `ui-test-${tag}`;
  const profileKey = `UI_TEST_${tag.toUpperCase()}`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(api(path), { method: 'POST', headers: auth, body: JSON.stringify(body) });
    expect(response.ok, `${path}: ${response.status} ${await response.clone().text()}`).toBe(true);
  };
  await post('/ai/providers', { providerKey, displayName: `UI Testanbieter ${tag}`, adapterKey: 'openai' });
  await post('/ai/models', { providerKey, providerModelId: `ui-test-model-${tag}`, displayName: `UI Testmodell ${tag}` });
  await post('/ai/model-profiles', { profileKey, purpose: 'UI-Test: Profil ohne Aufrufer', requiredCapabilities: ['chat'] });

  await installPlatformSession(page.context(), login);
  await page.goto('/platform/ai');
  await expect(page.getByRole('heading', { name: 'KI-Steuerung' })).toBeVisible();

  // 1. Profil veröffentlichen (unveränderlich danach) – mit Begründung und Passwortbestätigung.
  const profileRow = page.getByRole('listitem').filter({ hasText: profileKey });
  await expect(profileRow.locator('span').getByText('DRAFT', { exact: true })).toBeVisible();
  await profileRow.getByRole('button', { name: new RegExp(`Profil ${profileKey} Version 1 veröffentlichen`) }).click();
  await profileRow.getByLabel(/Begründung/).fill('UI-Test: Profil veröffentlichen');
  await profileRow.getByRole('button', { name: 'Veröffentlichen', exact: true }).last().click();
  const stepUp = page.getByRole('dialog', { name: 'Aktion bestätigen' });
  if (await stepUp.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
    await stepUp.getByLabel('Passwort').fill(PASSWORD as string);
    await stepUp.getByRole('button', { name: 'Bestätigen' }).click();
  }
  await expect(profileRow.locator('span').getByText('PUBLISHED', { exact: true })).toBeVisible();

  // 2. Route anlegen: zunächst inaktiv.
  await page.getByRole('button', { name: 'Neue Route' }).click();
  const form = page.getByRole('form', { name: 'Route anlegen' });
  await expect(form.getByRole('button', { name: 'Route anlegen' })).toBeDisabled();
  await form.getByLabel('Profil').selectOption(profileKey);
  await form.getByLabel('Hauptmodell').selectOption({ label: `UI Testmodell ${tag} (${providerKey})` });
  await form.getByRole('button', { name: 'Route anlegen' }).click();
  const routeRow = page.getByRole('listitem').filter({ hasText: `UI Testmodell ${tag}` }).filter({ hasText: profileKey });
  await expect(routeRow.locator('span').getByText('Inaktiv', { exact: true })).toBeVisible();

  // 3. Aktivierung: Vorprüfung nennt die Gründe, es gibt nichts zu bestätigen.
  await routeRow.getByRole('button', { name: `Route ${profileKey} aktivieren` }).click();
  await routeRow.getByRole('button', { name: 'Vorbedingungen und Wirkung prüfen' }).click();
  const alert = routeRow.getByRole('alert');
  await expect(alert.getByText('Diese Route kann noch nicht aktiviert werden:')).toBeVisible();
  await expect(alert.getByRole('listitem').first()).toBeVisible();
  await expect(routeRow.getByRole('button', { name: 'Route aktivieren' })).toHaveCount(0);
  await expect(routeRow.locator('span').getByText('Inaktiv', { exact: true })).toBeVisible(); // nichts wurde aktiv

  // Audit: Veröffentlichung und Routenanlage sind festgehalten.
  await page.goto('/platform/audit');
  await page.getByLabel('Ereignistyp').fill('PLATFORM_AI_ROUTE_CHANGED');
  await expect(page.getByText('Route angelegt (inaktiv)').first()).toBeVisible();
});
