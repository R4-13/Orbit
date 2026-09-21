import type { Page } from '@playwright/test';

/** Seeded "Musterwerk GmbH" demo tenant (Phase 13) — see docs/DEMO_DATA.md. */
export const DEMO_PASSWORD = 'Musterwerk#2026!';
export const DEMO_USERS = {
  admin: 'admin@musterwerk.example',
  finance: 'finance@musterwerk.example',
  sales: 'sales@musterwerk.example',
  approver: 'approval@musterwerk.example',
  viewer: 'viewer@musterwerk.example',
} as const;

export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:3001';

/** Fills and submits the login form, and waits for the dashboard redirect. */
export async function loginViaUi(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL('**/dashboard');
}

/** Logs in via the real API (no browser) — used to seed fixtures before a UI test. */
export async function loginViaApi(email: string, password = DEMO_PASSWORD): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`loginViaApi(${email}) failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}
