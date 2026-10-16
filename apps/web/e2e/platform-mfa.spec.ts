import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { base32Decode, totp } from '../../api/src/platform/auth/totp';

/**
 * PLT-02: zweiter Faktor in der Plattform-Oberfläche – einrichten (Passwort, Geheimnis, erster Code, Wiederherstellungscodes), danach verlangt die Anmeldung den Code
 * (Wiederherstellungscode geht sofort), abschalten, danach genügt wieder das Passwort. Der Zugang wird vom Skript `apps/api/scripts/e2e-platform-user.ts` angelegt und am Ende
 * gelöscht. Voraussetzung: die Umgebung aus `.env` (Datenbank) und eine konfigurierte Plattformdomäne (`PLATFORM_JWT_SECRET`); sonst wird übersprungen.
 */
const REPO_ROOT = join(__dirname, '../../..');

function runScript(args: string[]): string {
  const output = execFileSync('pnpm', ['--filter', '@orbit/api', 'exec', 'ts-node', 'scripts/e2e-platform-user.ts', ...args], { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000 });
  return output.trim().split('\n').at(-1) ?? '';
}

test.skip(!process.env.DATABASE_URL, 'DATABASE_URL nicht gesetzt (Umgebung aus .env laden), der Testzugang kann nicht angelegt werden');

test('Zweiter Faktor in der Plattform-Oberfläche: einrichten, anmelden mit Code, abschalten', async ({ page }) => {
  test.setTimeout(240_000);
  const user = JSON.parse(runScript(['create'])) as { id: string; email: string; password: string };
  try {
    const signIn = async (code?: string) => {
      await page.goto('/platform/login');
      await page.getByLabel('E-Mail-Adresse').fill(user.email);
      await page.getByLabel('Passwort').fill(user.password);
      await page.getByRole('button', { name: 'Anmelden' }).click();
      if (code !== undefined) {
        await expect(page.getByLabel('Code der Authenticator-App')).toBeVisible(); // das Passwort stimmt → nach dem Code fragen, keine Fehlermeldung
        await expect(page.locator('p[role="alert"]')).toHaveCount(0);
        await page.getByLabel('Code der Authenticator-App').fill(code);
        await page.getByRole('button', { name: 'Anmelden' }).click();
      }
      await page.waitForURL('**/platform');
    };
    const signOut = async () => {
      await page.getByRole('button', { name: 'Abmelden' }).click();
      await page.waitForURL('**/platform/login');
    };

    // 1. Einrichten
    await signIn();
    await page.goto('/platform/account');
    await expect(page.getByText('Nicht eingerichtet')).toBeVisible();
    await page.getByRole('button', { name: 'Einrichten' }).click();
    const setup = page.getByRole('form', { name: 'Zweiten Faktor einrichten' });
    await setup.getByLabel('Passwort').fill('falsch-falsch-falsch');
    await setup.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.locator('p[role="alert"]').filter({ hasText: 'nicht korrekt' })).toBeVisible();
    await setup.getByLabel('Passwort').fill(user.password);
    await setup.getByRole('button', { name: 'Weiter' }).click();

    const secretText = (await page.getByTestId('mfa-secret').innerText()).trim();
    expect(secretText).toMatch(/^[A-Z2-7]{32}$/);
    const confirm = page.getByRole('form', { name: 'Zweiten Faktor bestätigen' });
    await confirm.getByLabel('Code aus der App').fill('000000');
    await confirm.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('Code stimmt nicht');
    await confirm.getByLabel('Code aus der App').fill(totp(base32Decode(secretText), new Date()));
    await confirm.getByRole('button', { name: 'Bestätigen' }).click();

    await expect(page.getByText('Der zweite Faktor ist eingerichtet.')).toBeVisible();
    const recovery = (await page.getByTestId('mfa-recovery-codes').locator('li').allInnerTexts()).map((t) => t.trim());
    expect(recovery).toHaveLength(8);
    await page.getByRole('button', { name: 'Ich habe sie notiert' }).click();
    await expect(page.getByText('Eingerichtet: Anmeldung')).toBeVisible();

    // 2. Anmeldung braucht jetzt den Code; ein falscher wird abgewiesen, ein Wiederherstellungscode gilt genau einmal
    await signOut();
    await page.goto('/platform/login');
    await page.getByLabel('E-Mail-Adresse').fill(user.email);
    await page.getByLabel('Passwort').fill(user.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Code der Authenticator-App').fill('123456');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('Code ist nicht korrekt');
    await page.getByLabel('Code der Authenticator-App').fill(recovery[0] as string);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForURL('**/platform');

    // 3. Abschalten mit Passwort und (anderem) Wiederherstellungscode
    await page.goto('/platform/account');
    await expect(page.getByText('Eingerichtet: Anmeldung')).toBeVisible();
    await page.getByRole('button', { name: 'Abschalten' }).click();
    const off = page.getByRole('form', { name: 'Zweiten Faktor abschalten' });
    await off.getByLabel('Passwort').fill(user.password);
    await off.getByLabel(/Aktueller Code/).fill(recovery[1] as string);
    await off.getByRole('button', { name: 'Abschalten' }).click();
    await expect(page.getByText('Nicht eingerichtet')).toBeVisible();

    // 4. Danach genügt wieder das Passwort
    await signOut();
    await signIn();
  } finally {
    runScript(['delete', user.id]);
  }
});
