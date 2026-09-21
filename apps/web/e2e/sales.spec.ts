import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaUi } from './utils/login';

async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

test.describe('Sales', () => {
  test('leads list shows the seeded Musterwerk fixtures', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.sales);
    await page.goto('/sales/leads');

    // Scoped per-row: repeated e2e/manual runs against this same dev DB
    // accumulate their own additional NEW/QUALIFIED leads over time (by
    // design — see the "creates a lead..." test below), so asserting a
    // status label is visible anywhere on the page would be ambiguous.
    const convertedRow = page.locator('tbody tr', {
      hasText: 'Anfrage über Kontaktformular, bereits als Kunde gewonnen.',
    });
    await expect(convertedRow.getByText('Konvertiert')).toBeVisible();

    const qualifiedRow = page.locator('tbody tr', {
      hasText: 'Interesse an Büroausstattung für neuen Standort.',
    });
    await expect(qualifiedRow.getByText('Qualifiziert')).toBeVisible();
  });

  test('creates a lead for a fresh contact, which auto-creates a follow-up task', async ({ page }) => {
    const runId = randomUUID();
    const salesToken = await loginViaApi(DEMO_USERS.sales);
    const company = await apiPost<{ id: string }>('/companies', salesToken, {
      name: `E2E Web Handel ${runId} GmbH`,
      domain: `e2e-web-${runId}.example`,
    });
    const firstName = 'Petra';
    const lastName = `Weberweb-${runId}`;
    await apiPost('/contacts', salesToken, {
      firstName,
      lastName,
      email: `petra.${runId}@e2e-web-${runId}.example`,
      companyId: company.id,
    });

    await loginViaUi(page, DEMO_USERS.sales);
    await page.goto('/sales/leads');

    await page.getByLabel('Kontakt').selectOption({ label: `${firstName} ${lastName}` });
    await page.getByLabel('Quelle').selectOption({ label: 'Telefon' });
    await page.getByRole('button', { name: 'Lead anlegen' }).click();

    const newLeadRow = page.locator('tbody tr', { hasText: 'Telefon' }).first();
    await expect(newLeadRow.getByText('Neu')).toBeVisible();

    await page.goto('/tasks');
    const expectedTaskTitle = `Neuen Lead kontaktieren: ${firstName} ${lastName}`;
    const taskRow = page.locator('tr', { hasText: expectedTaskTitle });
    await expect(taskRow).toBeVisible();
    await expect(taskRow.getByText('Offen')).toBeVisible();

    await taskRow.getByRole('button', { name: 'Erledigt' }).click();
    await expect(taskRow.getByText('Erledigt')).toBeVisible();
  });
});
