import { expect, test } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaUi } from './utils/login';

/**
 * UI acceptance of the interactive case orchestration (Amendment 02 §25.4). The tests read real cases that run on a
 * blueprint — they never fabricate a graph — and skip with a clear reason when the environment holds none
 * (create one in the inbox first; see docs/CASE_ORCHESTRATION_UI.md).
 */
async function findProcessCase(token: string): Promise<{ id: string; title: string } | undefined> {
  const response = await fetch(`${API_BASE_URL}/api/v1/cases`, { headers: { Authorization: `Bearer ${token}` } });
  const cases = (await response.json()) as Array<{ id: string; title: string; blueprintKey: string | null }>;
  return cases.find((c) => c.blueprintKey);
}

test.describe('Case orchestration', () => {
  test('shows the process case with tabs, a step list with labelled states, and node details', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const processCase = await findProcessCase(token);
    test.skip(!processCase, 'Kein Vorgang auf einem Prozess vorhanden – bitte zuerst eine Angebotsanfrage im Posteingang einspielen.');

    await loginViaUi(page, DEMO_USERS.admin);
    await page.goto(`/cases/${processCase!.id}`);

    await expect(page.getByRole('tab', { name: 'Orchestrierung' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Historie' })).toBeVisible();
    // No manual status switch on a case that a process steers.
    await expect(page.locator('select')).toHaveCount(0);

    // The linear alternative is always available and complete: every step has a business label for its state.
    await page.getByRole('button', { name: 'Liste' }).click();
    const steps = page.getByRole('list', { name: 'Schritte des Vorgangs in Reihenfolge' }).getByRole('listitem');
    await expect(steps.first()).toBeVisible();
    expect(await steps.count()).toBeGreaterThan(5);
    await expect(page.getByRole('list', { name: 'Schritte des Vorgangs in Reihenfolge' })).toContainText(/Erledigt|Wartet|Freigabe erforderlich|Geplant/);

    // Selecting a step opens its details with the explanation of the state.
    await steps.first().getByRole('button').click();
    await expect(page.getByRole('complementary', { name: 'Details zum ausgewählten Schritt' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Details zum ausgewählten Schritt' })).toContainText(/Dieser Schritt|Die Ausführung|Es ist ungewiss/);

    // The graph renders the same projection, and the definition layer shows only planned steps.
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Prozessgraph des Vorgangs' })).toBeVisible();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await page.getByRole('button', { name: 'Prozessdefinition' }).click();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    // The history is the ordered event log.
    await page.getByRole('tab', { name: 'Historie' }).click();
    await expect(page.getByRole('list', { name: 'Ereignisse des Vorgangs' }).getByRole('listitem').first()).toBeVisible();
  });

  test('a read-only user sees the process but no action buttons (server-computed actions)', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const processCase = await findProcessCase(token);
    test.skip(!processCase, 'Kein Vorgang auf einem Prozess vorhanden.');

    await loginViaUi(page, DEMO_USERS.viewer);
    await page.goto(`/cases/${processCase!.id}`);
    await expect(page.getByRole('tab', { name: 'Orchestrierung' })).toBeVisible();
    await page.getByRole('button', { name: 'Liste' }).click();
    await expect(page.getByRole('list', { name: 'Schritte des Vorgangs in Reihenfolge' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Anhalten|Neu planen|Vorgang abbrechen|freigeben & senden/ })).toHaveCount(0);
  });

  test('uses the linear list by default on a phone-sized screen', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const processCase = await findProcessCase(token);
    test.skip(!processCase, 'Kein Vorgang auf einem Prozess vorhanden.');

    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaUi(page, DEMO_USERS.admin);
    await page.goto(`/cases/${processCase!.id}`);
    await expect(page.getByRole('list', { name: 'Schritte des Vorgangs in Reihenfolge' })).toBeVisible();
    // No horizontal page scroll on mobile.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the inbox links to the orchestration instead of an assigned agent, and offers the excluded-intake view', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.admin);
    await page.goto('/dashboard');
    // Home zeigt eine Vorschau (keine breite Tabelle): jede Zeile führt in die Orchestrierung bzw. die Entscheidung (UI v2 §6.6).
    await expect(page.getByRole('heading', { name: 'Neu im Posteingang' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Orchestrierung anzeigen|Entscheidung ansehen|Vorgang ansehen/ }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Zugewiesener Agent' })).toHaveCount(0);

    await page.goto('/inbox');
    await expect(page.getByRole('button', { name: /Kein Geschäftsprozess ausgelöst/ })).toBeVisible();
  });

  test('process definitions: the admin sees blueprints and which capabilities can really run', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.admin);
    await page.goto('/admin/processes');
    await expect(page.getByRole('heading', { name: 'Prozessdefinitionen' })).toBeVisible();
    await expect(page.getByText('Fähigkeiten dieses Mandanten')).toBeVisible();
    await expect(page.getByText(/Ausführbar|Nicht ausführbar/).first()).toBeVisible();
  });
});
