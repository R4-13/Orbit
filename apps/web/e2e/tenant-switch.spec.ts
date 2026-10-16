import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaUi } from './utils/login';

/**
 * UX-01 / AC-18: Mandantenwechsel A/B im selben Browser. Ein zweiter, frischer Betrieb B (vom Skript `apps/api/scripts/e2e-tenant.ts` angelegt und am Ende gelöscht) bekommt eine
 * andere Primärfarbe. Nach dem Wechsel dürfen weder Farbe noch Daten des Betriebs A sichtbar sein, und beim Zurückwechseln gilt wieder A. Der Demo-Betrieb A wird nicht verändert.
 *
 * Voraussetzung: die Umgebung (`set -a && source .env && set +a`), damit das Skript die Datenbank erreicht; läuft sonst nicht und wird übersprungen.
 */
const REPO_ROOT = join(__dirname, '../../..');
const B_COLOR = '#b91c1c';
const B_CHANNELS = '185 28 28';

interface TenantB {
  tenantId: string;
  email: string;
  password: string;
}

function runScript(args: string[]): string {
  const output = execFileSync('pnpm', ['--filter', '@orbit/api', 'exec', 'ts-node', 'scripts/e2e-tenant.ts', ...args], { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000 });
  return output.trim().split('\n').at(-1) ?? '';
}

async function brandPrimary(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim());
}

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Profilmenü' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await page.waitForURL('**/login');
}

test.skip(!process.env.DATABASE_URL, 'DATABASE_URL nicht gesetzt (Umgebung aus .env laden), der zweite Betrieb kann nicht angelegt werden');

test('Mandantenwechsel A/B: Farbe und Daten des einen Betriebs sind im anderen nie zu sehen', async ({ page }) => {
  test.setTimeout(240_000);
  const b = JSON.parse(runScript(['create'])) as TenantB;
  try {
    // B bekommt eine eigene Farbe (über die API des Betriebs B).
    const login = await fetch(`${API_BASE_URL}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: b.email, password: b.password }) });
    expect(login.ok).toBe(true);
    const tokenB = ((await login.json()) as { accessToken: string }).accessToken;
    const saved = await fetch(`${API_BASE_URL}/api/v1/tenant/branding`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` }, body: JSON.stringify({ primaryColor: B_COLOR, primaryForeground: '#ffffff' }) });
    expect(saved.ok).toBe(true);

    // A (Demo-Betrieb): Farbe und eine Vorgangsliste mit Inhalt merken.
    await loginViaUi(page, DEMO_USERS.admin);
    await expect(page.getByRole('button', { name: 'Profilmenü' })).toBeVisible();
    const colorA = await brandPrimary(page);
    // Ein Vorgang des Demo-Betriebs, der in A sichtbar ist (Titel über die API gelesen).
    const casesResponse = await fetch(`${API_BASE_URL}/api/v1/cases`, { headers: { Authorization: `Bearer ${await loginViaApi(DEMO_USERS.admin)}` } });
    const caseTitle = ((await casesResponse.json()) as Array<{ title: string }>).map((c) => c.title).find((t) => t.length > 12);
    expect(caseTitle).toBeTruthy();
    await page.goto('/cases');
    await expect(page.getByText(caseTitle as string).first()).toBeVisible();

    // Wechsel zu B im selben Browser.
    await logout(page);
    await loginViaUi(page, b.email, b.password);
    await expect(page.getByRole('button', { name: 'Profilmenü' })).toBeVisible();
    await expect.poll(() => brandPrimary(page), { timeout: 15_000 }).toBe(B_CHANNELS);
    expect(await brandPrimary(page)).not.toBe(colorA);
    await page.goto('/cases');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(caseTitle as string)).toHaveCount(0); // kein Vorgang von A in B
    // Der zwischengespeicherte Farbwert gehört je Betrieb zu genau einem Schlüssel.
    const cacheKeys = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('orbit.theme.')));
    expect(new Set(cacheKeys).size).toBe(cacheKeys.length);
    expect(cacheKeys.some((k) => k.endsWith(b.tenantId))).toBe(true);

    // Zurück zu A: wieder A, nichts von B.
    await logout(page);
    expect(await brandPrimary(page)).not.toBe(B_CHANNELS); // auf der Anmeldeseite ist die Farbe von B weg
    await loginViaUi(page, DEMO_USERS.admin);
    await expect(page.getByRole('button', { name: 'Profilmenü' })).toBeVisible();
    await expect.poll(() => brandPrimary(page), { timeout: 15_000 }).toBe(colorA);
    expect(await brandPrimary(page)).not.toBe(B_CHANNELS);
  } finally {
    runScript(['delete', b.tenantId]);
  }
});
