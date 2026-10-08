import { expect, test } from '@playwright/test';
import { API_BASE_URL, DEMO_PASSWORD, DEMO_USERS } from './utils/login';
import { installPlatformSession, platformApiLogin } from './utils/platform-session';

/**
 * Kosten-Leitplanken in der Plattform-Oberfläche (Amendment 03 §12.3): Limit anlegen (Vorab-Prüfung der Schwellen), ändern (Version), entfernen – mit Begründung und
 * Passwortbestätigung. Das Limit gilt für den Demo-Mandanten ohne Durchsetzung (nur Meldung), wird am Ende in jedem Fall entfernt und berührt keinen KI-Aufruf.
 */
const EMAIL = process.env.E2E_PLATFORM_EMAIL;
const PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD nicht gesetzt');

const api = (path: string) => `${API_BASE_URL}/api/v1/platform${path}`;

test('Kostenlimit: anlegen mit Vorab-Prüfung, ändern, entfernen; Zustand und Messwerte stehen daneben', async ({ page }) => {
  const login = await platformApiLogin(EMAIL as string, PASSWORD as string);
  const auth = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };
  const tenantLogin = (await (await fetch(`${API_BASE_URL}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEMO_USERS.admin, password: DEMO_PASSWORD }) })).json()) as { user: { tenantId: string } };
  const tenants = (await (await fetch(api('/tenants'), { headers: auth })).json()) as Array<{ tenantId: string; slug: string; displayName: string }>;
  const demo = tenants.find((t) => t.tenantId === tenantLogin.user.tenantId)!;
  // Ein früherer abgebrochener Lauf darf nichts hinterlassen haben.
  const leftovers = (await (await fetch(api('/ai/cost-limits'), { headers: auth })).json()) as Array<{ id: string; scope: string; targetTenantId: string | null; version: number }>;
  await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: PASSWORD }) });
  for (const old of leftovers.filter((l) => l.scope === 'TENANT' && l.targetTenantId === demo.tenantId)) await fetch(api(`/ai/cost-limits/${old.id}/remove`), { method: 'POST', headers: auth, body: JSON.stringify({ expectedVersion: old.version, reason: 'UI-Test: Aufräumen' }) });

  try {
    await installPlatformSession(page.context(), login);
    await page.goto('/platform/ai');
    await expect(page.getByRole('heading', { name: 'Kosten und Limits' })).toBeVisible();
    await page.getByRole('button', { name: 'Neues Limit' }).click();
    const form = page.getByRole('form', { name: 'Kostenlimit anlegen' });
    await expect(form.getByRole('button', { name: 'Limit anlegen' })).toBeDisabled(); // Begründung fehlt
    await form.locator('#cl-tenant').selectOption(demo.tenantId);
    await form.locator('#cl-warn').fill('10');
    await form.locator('#cl-soft').fill('10'); // nicht aufsteigend
    await form.locator('#cl-hard').fill('20');
    await form.getByLabel(/Begründung/).fill('UI-Test: Kostenlimit setzen');
    const confirmWithPassword = async () => {
      const dialog = page.getByRole('dialog', { name: 'Aktion bestätigen' });
      if (await dialog.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
        await dialog.getByLabel('Passwort').fill(PASSWORD as string);
        await dialog.getByRole('button', { name: 'Bestätigen' }).click();
      }
    };
    await form.getByRole('button', { name: 'Limit anlegen' }).click();
    await confirmWithPassword();
    await expect(form.getByRole('alert')).toContainText('Die Schwellen müssen aufsteigen'); // der Server nennt den Grund einzeln
    await form.locator('#cl-warn').fill('5');
    await form.locator('#cl-soft').fill('10');
    await form.getByRole('button', { name: 'Limit anlegen' }).click();
    await confirmWithPassword();

    const row = page.getByRole('listitem').filter({ hasText: `Mandant ${demo.displayName}` }).filter({ hasText: 'Hard 20 USD' }).first();
    await expect(row.getByText('nur Meldung')).toBeVisible();
    await expect(row.getByText(/Bisher in diesem Monat/)).toBeVisible();
    await expect(row.locator('span').getByText(/Im Rahmen|Warnschwelle|Soft-Limit|Hard-Limit/).first()).toBeVisible();

    // Ändern (Version wird mitgesendet), danach entfernen.
    await row.getByRole('button', { name: /Limit für Mandant .* ändern/ }).click();
    const edit = page.getByRole('form', { name: 'Kostenlimit ändern' });
    await edit.locator('#cl-soft').fill('12');
    await edit.getByLabel(/Begründung/).fill('UI-Test: Soft-Limit anheben');
    await edit.getByRole('button', { name: 'Limit ändern' }).click();
    await confirmWithPassword();
    await expect(page.getByRole('listitem').filter({ hasText: 'Soft 12 USD' }).first()).toBeVisible();

    const changed = page.getByRole('listitem').filter({ hasText: 'Soft 12 USD' }).first();
    await changed.getByRole('button', { name: /Limit für Mandant .* entfernen/ }).click();
    await changed.getByLabel(/Begründung/).fill('UI-Test: Limit entfernen');
    await changed.getByRole('button', { name: 'Limit entfernen' }).click();
    await confirmWithPassword();
    await expect(page.getByRole('listitem').filter({ hasText: 'Soft 12 USD' })).toHaveCount(0);

    await page.goto('/platform/audit');
    await page.getByLabel('Ereignistyp').fill('PLATFORM_AI_COST_LIMIT_CHANGED');
    await expect(page.getByText('UI-Test: Limit entfernen').first()).toBeVisible();
  } finally {
    const rest = (await (await fetch(api('/ai/cost-limits'), { headers: auth })).json()) as Array<{ id: string; scope: string; targetTenantId: string | null; version: number }>;
    await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: PASSWORD }) });
    for (const left of rest.filter((l) => l.scope === 'TENANT' && l.targetTenantId === demo.tenantId)) await fetch(api(`/ai/cost-limits/${left.id}/remove`), { method: 'POST', headers: auth, body: JSON.stringify({ expectedVersion: left.version, reason: 'UI-Test beendet' }) });
  }
});
