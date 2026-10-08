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
    // Die Entwicklungsumgebung sammelt viele Testdaten an: die Demo-Einträge werden über die Suche gefunden, nicht über ihre Position in der Liste.
    await page.getByRole('searchbox', { name: /Interessenten/ }).fill('Julia');

    // UI v2 §13.1: Standard ist „Offene Anfragen“ – die qualifizierte Anfrage ist dort sichtbar, die bereits gewonnene erst unter
    // „Abgeschlossen“. Zeilen werden per Kontaktname gefunden (die Notizen stehen nicht mehr in der Liste).
    const qualifiedRow = page.locator('tbody tr', { hasText: 'Julia' }).first();
    await expect(qualifiedRow.getByText('Qualifiziert')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'Petra Klein' })).toHaveCount(0);

    await page.getByRole('searchbox', { name: /Interessenten/ }).fill('Petra Klein');
    await page.getByRole('button', { name: /^Abgeschlossen/ }).click();
    const convertedRow = page.locator('tbody tr', { hasText: 'Petra Klein' }).first();
    await expect(convertedRow.getByText('Konvertiert')).toBeVisible();
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

    await page.getByRole('button', { name: 'Interessent anlegen' }).click();
    await page.getByLabel('Kontakt').selectOption({ label: `${firstName} ${lastName}` });
    await page.getByLabel('Quelle').selectOption({ label: 'Telefon' });
    await page.getByRole('button', { name: 'Interessent speichern' }).click();

    const newLeadRow = page.locator('tbody tr', { hasText: `${firstName} ${lastName}` }).first();
    await expect(newLeadRow.getByText('Neu')).toBeVisible();

    await page.goto('/tasks');
    const expectedTaskTitle = `Neuen Lead kontaktieren: ${firstName} ${lastName}`;
    const taskRow = page.locator('li', { hasText: expectedTaskTitle });
    await expect(taskRow).toBeVisible();

    // UI v2 §15: Abschluss ist eine bewusste Aktion („Als erledigt markieren“), die Aufgabe verlässt die Liste der offenen Arbeit …
    await taskRow.getByRole('button', { name: 'Als erledigt markieren' }).click();
    await expect(taskRow).toHaveCount(0);
    // … und bleibt unter „Erledigte anzeigen“ nachvollziehbar.
    await page.getByLabel('Erledigte anzeigen').check();
    await expect(page.locator('li', { hasText: expectedTaskTitle }).getByText('Erledigt')).toBeVisible();
  });
});
