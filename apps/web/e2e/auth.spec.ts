import { expect, test } from '@playwright/test';
import { DEMO_USERS, loginViaUi } from './utils/login';

test.describe('Auth', () => {
  test('logs in with valid seeded credentials and reaches the dashboard', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.finance);
    // UI v2 GAP-08: eine freundliche Begrüßung, nie die technische E-Mail-Adresse als Überschrift.
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(/^Guten (Morgen|Tag|Abend)/);
    await expect(heading).not.toContainText('@');
  });

  test('shows a German error message for a wrong password and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail-Adresse').fill(DEMO_USERS.finance);
    await page.getByLabel('Passwort').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    // Scoped to a <p role="alert">: Next.js also renders its own hidden
    // route-announcer div with role="alert" on every page, which would
    // otherwise make this locator ambiguous.
    await expect(page.locator('p[role="alert"]')).toHaveText('E-Mail-Adresse oder Passwort ist nicht korrekt.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('redirects an unauthenticated visitor from a protected route to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/login');
  });

  test('die Sitzung liegt nur im Arbeitsspeicher und in einem httpOnly-Cookie – nie im Browser-Speicher; ein Neuladen stellt sie über das Cookie wieder her', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.admin);
    const visible = await page.evaluate(() => ({ local: Object.keys(window.localStorage).filter((k) => /auth|token/i.test(k)), session: Object.keys(window.sessionStorage).filter((k) => /auth|token/i.test(k)), readableCookie: document.cookie }));
    expect(visible).toEqual({ local: [], session: [], readableCookie: '' });
    const cookie = (await page.context().cookies()).find((c) => c.name === 'orbit_rt');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' });
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible(); // ohne erneute Anmeldung
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('logs out, clears the session and redirects to /login', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.admin);
    await page.getByRole('button', { name: 'Profilmenü' }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await page.waitForURL('**/login');

    // Es bleibt nichts zurück: kein Eintrag im Browser-Speicher, und das httpOnly-Cookie ist gelöscht.
    expect(await page.evaluate(() => window.localStorage.getItem('orbit.auth'))).toBeNull();
    expect((await page.context().cookies()).some((c) => c.name === 'orbit_rt')).toBe(false);

    // Redirect protection holds again after logout.
    await page.goto('/dashboard');
    await page.waitForURL('**/login');
  });

  test('does not expose the Lieferanten nav item to a user without SUPPLIER_MANAGE', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.finance);
    // Untergruppen sind beim Einstieg geschlossen; die aktive Route öffnet ihre Gruppe (UI v2 NAV-03).
    await page.goto('/finance/invoices');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByRole('link', { name: 'Rechnungen', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Lieferanten' })).not.toBeVisible();
  });
});
