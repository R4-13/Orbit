import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { API_BASE_URL, DEMO_PASSWORD, DEMO_USERS } from './utils/login';
import { installPlatformSession } from './utils/platform-session';

/**
 * Support-Sitzungen in der Plattform-Oberfläche (Amendment 03 §18): Anforderung durch die Support-Rolle, Vier-Augen-Freigabe durch eine andere Person,
 * Einblick in den Mandantenkontext, Widerruf. Braucht einen Owner-Zugang (E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD); die zweite Person (Support) legt der
 * Test selbst an und deaktiviert sie am Ende wieder. Ohne Zugangsdaten wird übersprungen.
 */
const OWNER_EMAIL = process.env.E2E_PLATFORM_EMAIL;
const OWNER_PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, 'E2E_PLATFORM_EMAIL/E2E_PLATFORM_PASSWORD nicht gesetzt');

const api = (path: string) => `${API_BASE_URL}/api/v1/platform${path}`;
const json = { 'Content-Type': 'application/json' };

async function login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string; principal: unknown }> {
  const response = await fetch(api('/auth/login'), { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
  expect(response.ok, `Plattform-Login ${email}: ${response.status}`).toBe(true);
  return (await response.json()) as { accessToken: string; refreshToken: string; principal: unknown };
}

async function pageFor(browser: Browser, session: { accessToken: string; refreshToken: string; principal: unknown }): Promise<Page> {
  const context = await browser.newContext();
  await installPlatformSession(context, session);
  return context.newPage();
}

const RUN = randomBytes(3).toString('hex');
const MARKER = `UI-Test ${RUN}: Support-Sitzung mit Vier-Augen-Freigabe`;

test('Support-Sitzung: Anforderung → Vier-Augen-Freigabe → Kontext → Widerruf; die anfordernde Person kann nicht selbst freigeben', async ({ browser }) => {
  const owner = await login(OWNER_EMAIL as string, OWNER_PASSWORD as string);
  const auth = { Authorization: `Bearer ${owner.accessToken}`, ...json };

  // Zweite Person mit Support-Rolle (nur anfordern, nicht freigeben).
  const supportEmail = `ui-support-${randomBytes(4).toString('hex')}@orbit.local`;
  const supportPassword = `Sp${randomBytes(12).toString('base64url')}#1x`;
  expect((await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: OWNER_PASSWORD }) })).ok).toBe(true);
  const created = await fetch(api('/identities'), { method: 'POST', headers: auth, body: JSON.stringify({ email: supportEmail, displayName: 'UI Support', password: supportPassword, roles: ['PLATFORM_SUPPORT'] }) });
  expect(created.ok, `Support-Identität anlegen: ${created.status}`).toBe(true);
  const supportIdentity = (await created.json()) as { id: string };

  try {
    const tenantLogin = (await (await fetch(`${API_BASE_URL}/api/v1/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: DEMO_USERS.admin, password: DEMO_PASSWORD }) })).json()) as { user: { tenantId: string } };
    const tenants = (await (await fetch(api('/tenants'), { headers: auth })).json()) as Array<{ tenantId: string; slug: string; displayName: string }>;
    const demo = tenants.find((t) => t.tenantId === tenantLogin.user.tenantId)!;
    expect(demo).toBeTruthy();

    // 1. Support fordert eine Sitzung mit Zugriff auf Konfiguration und Inhalte an.
    const supportPage = await pageFor(browser, await login(supportEmail, supportPassword));
    await supportPage.goto('/platform/support');
    await expect(supportPage.getByRole('heading', { name: 'Support-Sitzungen' })).toBeVisible();
    await supportPage.getByRole('button', { name: 'Sitzung anfordern' }).click();
    const form = supportPage.getByRole('form', { name: 'Support-Session anfordern' });
    await form.getByLabel('Mandant').selectOption(demo.tenantId);
    await form.getByLabel('Zugriffsart').selectOption('READ_TENANT_CONTEXT');
    await form.getByLabel('Konfiguration des Mandanten').check();
    await form.getByLabel(/Inhalte von Vorgängen/).check();
    await expect(form.getByText(/zweite Person die Sitzung freigeben/)).toBeVisible();
    await expect(form.getByRole('button', { name: 'Sitzung anfordern' })).toBeDisabled(); // Begründung fehlt
    await form.getByLabel(/Begründung/).fill(MARKER);
    await form.getByRole('button', { name: 'Sitzung anfordern' }).click();
    const row = supportPage.getByRole('row').filter({ hasText: MARKER });
    await expect(row.locator('span').getByText('Angefordert', { exact: true })).toBeVisible();
    await expect(row.getByText('wartet auf Freigabe einer zweiten Person')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Freigeben' })).toHaveCount(0); // Support darf nicht freigeben
    await expect(row.getByRole('button', { name: 'Kontext' })).toHaveCount(0); // und sieht vor der Freigabe nichts

    // 2. Der Owner (andere Person) gibt frei – mit Begründung und erneuter Passwortprüfung.
    const ownerPage = await pageFor(browser, owner);
    await ownerPage.goto('/platform/support');
    const ownerRow = ownerPage.getByRole('row').filter({ hasText: MARKER });
    await ownerRow.getByRole('button', { name: 'Freigeben' }).click();
    await ownerRow.locator('xpath=following-sibling::tr[1]').getByLabel(/Begründung/).fill('UI-Test: Freigabe nach Prüfung');
    await ownerPage.getByRole('button', { name: 'Freigabe bestätigen' }).click();
    const dialog = ownerPage.getByRole('dialog', { name: 'Aktion bestätigen' });
    if (await dialog.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
      await dialog.getByLabel('Passwort').fill(OWNER_PASSWORD as string);
      await dialog.getByRole('button', { name: 'Bestätigen' }).click();
    }
    await expect(ownerRow.locator('span').getByText('Aktiv', { exact: true })).toBeVisible();

    // 3. Nutzen darf die Sitzung nur die anfordernde Person – die freigebende sieht keinen Kontext-Zugang. Der Einblick enthält keine Geschäftsinhalte.
    await expect(ownerRow.getByRole('button', { name: 'Mandantenkontext ansehen' })).toHaveCount(0);
    await supportPage.reload();
    const activeSupportRow = supportPage.getByRole('row').filter({ hasText: MARKER });
    await activeSupportRow.getByRole('button', { name: 'Mandantenkontext ansehen' }).click();
    await expect(supportPage.getByText('Freigabe-Richtlinien')).toBeVisible();

    // 4. Widerruf wirkt sofort.
    await ownerRow.getByRole('button', { name: 'Widerrufen' }).click();
    await ownerRow.locator('xpath=following-sibling::tr[1]').getByLabel(/Begründung/).fill('UI-Test: Sitzung wieder entziehen');
    await ownerPage.getByRole('button', { name: 'Widerruf bestätigen' }).click();
    await expect(ownerRow.locator('span').getByText('Widerrufen', { exact: true })).toBeVisible();
    await supportPage.reload();
    await expect(supportPage.getByRole('row').filter({ hasText: MARKER }).locator('span').getByText('Widerrufen', { exact: true })).toBeVisible();
  } finally {
    // Aufräumen: offene Test-Sitzungen werden widerrufen, die Test-Identität wird deaktiviert.
    await fetch(api('/auth/step-up'), { method: 'POST', headers: auth, body: JSON.stringify({ password: OWNER_PASSWORD }) });
    const all = (await (await fetch(api('/support-sessions'), { headers: auth })).json()) as Array<{ id: string; status: string; freeTextReason: string }>;
    for (const session of all.filter((x) => x.freeTextReason.startsWith('UI-Test') && ['REQUESTED', 'ACTIVE'].includes(x.status))) {
      await fetch(api(`/support-sessions/${session.id}/revoke`), { method: 'POST', headers: auth, body: JSON.stringify({ reason: 'UI-Test beendet' }) });
    }
    await fetch(api(`/identities/${supportIdentity.id}/disable`), { method: 'POST', headers: auth, body: JSON.stringify({ reason: 'UI-Test beendet' }) });
  }
});
