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

interface ApiSession {
  accessToken: string;
  refreshToken: string;
  user: unknown;
}

/**
 * Die Anmelde-Drosselung der API (AUTH_RATE_LIMIT_MAX, Standard 60 je 5 Minuten) ist eine Sicherheitsfunktion und bleibt unverändert.
 * Damit eine große Suite sie nicht auslöst, wird die Sitzung je Konto im Testprozess kurz wiederverwendet; der Login selbst ist in
 * auth.spec.ts über die Oberfläche abgedeckt.
 */
const SESSION_TTL_MS = 5 * 60 * 1000;
const sessions = new Map<string, { at: number; session: ApiSession }>();

async function apiSession(email: string, password: string): Promise<ApiSession> {
  const cached = sessions.get(email);
  if (cached && Date.now() - cached.at < SESSION_TTL_MS) return cached.session;
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Login über die API für ${email} fehlgeschlagen: ${response.status} ${await response.text()}`);
  const session = (await response.json()) as ApiSession;
  sessions.set(email, { at: Date.now(), session });
  return session;
}

/** Logs in via the real API (no browser) — used to seed fixtures before a UI test. */
export async function loginViaApi(email: string, password = DEMO_PASSWORD): Promise<string> {
  return (await apiSession(email, password)).accessToken;
}

/**
 * Meldet über die echte API an und legt die Sitzung vor dem ersten Seitenaufruf in den localStorage – spart den UI-Login in
 * Tests, die viele Viewports durchlaufen (der Login selbst ist in auth.spec.ts abgedeckt).
 */
export async function loginViaStorage(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  const session = await apiSession(email, password);
  await page.addInitScript((value) => window.localStorage.setItem('orbit.auth', value), JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user }));
}
