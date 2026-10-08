import { expect, test } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaStorage } from './utils/login';

/**
 * Übersichten mit Datum und Sortierung, Absprung aus der Suche auf genau den Treffer, Hinweis bei unterbrochener Verbindung und der Automatisierungsgrad.
 * Was Daten des Demo-Mandanten verändern würde (Regeln, Verbindungen), wird mit vorgegebenen Antworten geprüft – die Umgebung bleibt unberührt.
 */
test.describe('Übersichten: Datum und Sortierung', () => {
  test.beforeEach(async ({ page }) => {
    // Breit genug, dass der Arbeitsbereich neben Navigation und Sonde über 900 px bleibt (darunter wechseln die Tabellen in die kompakte Darstellung).
    await page.setViewportSize({ width: 1920, height: 1080 });
    await loginViaStorage(page, DEMO_USERS.admin);
  });

  test('Vorgänge: Eingang und Aktualisierung als Spalten; ein Klick auf die Spalte sortiert serverseitig (erst neueste zuerst, dann umgekehrt)', async ({ page }) => {
    await page.goto('/cases');
    await expect(page.getByRole('columnheader', { name: /Eingegangen/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Aktualisiert/ })).toBeVisible();

    const first = page.waitForRequest((r) => r.url().includes('/v1/cases/overview') && r.url().includes('sort=createdAt') && r.url().includes('dir=desc'));
    await page.getByRole('button', { name: /Eingegangen/ }).click();
    await first;
    await expect(page.getByRole('columnheader', { name: /Eingegangen/ })).toHaveAttribute('aria-sort', 'descending');

    const second = page.waitForRequest((r) => r.url().includes('/v1/cases/overview') && r.url().includes('sort=createdAt') && r.url().includes('dir=asc'));
    await page.getByRole('button', { name: /Eingegangen/ }).click();
    await second;
    await expect(page.getByRole('columnheader', { name: /Eingegangen/ })).toHaveAttribute('aria-sort', 'ascending');

    // Ein Datum mit Jahr, nicht nur „08:12“ oder „04.10.“
    await expect(page.locator('tbody tr td').filter({ hasText: /Heute, \d{2}:\d{2}|\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/ }).first()).toBeVisible();
  });

  test('Posteingang: Spalte „Eingegangen“ mit vollem Datum; Sortierung nach Eingang und Betreff', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('columnheader', { name: /Eingegangen/ })).toBeVisible();
    const bySubject = page.waitForRequest((r) => r.url().includes('/v1/inbox/items') && r.url().includes('sort=subject') && r.url().includes('dir=asc'));
    await page.getByRole('button', { name: /Betreff und Absender/ }).click();
    await bySubject;
    await expect(page.getByRole('columnheader', { name: /Betreff und Absender/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  test('Rechnungen, Interessenten, Freigaben, Kontakte: Datumsspalte und sortierbare Köpfe', async ({ page }) => {
    await page.goto('/finance/invoices');
    await expect(page.getByRole('columnheader', { name: /Eingegangen/ })).toBeVisible();
    await page.getByRole('button', { name: /^Betrag/ }).click();
    await expect(page.getByRole('columnheader', { name: /^Betrag/ })).toHaveAttribute('aria-sort', 'ascending');

    await page.goto('/sales/leads');
    await expect(page.getByRole('columnheader', { name: /Eingegangen/ })).toBeVisible();
    await page.goto('/approvals');
    await expect(page.getByRole('columnheader', { name: /Angefragt am/ })).toBeVisible();
    await page.goto('/sales/contacts');
    await expect(page.getByRole('columnheader', { name: /Angelegt am/ })).toBeVisible();
    await page.goto('/finance/suppliers');
    await expect(page.getByRole('columnheader', { name: /Angelegt am/ })).toBeVisible();
  });

  test('Aufgaben: Anlagedatum in der Zeile, Sortierung wählbar (simulierte Antwort)', async ({ page }) => {
    const task = (id: string, title: string, createdAt: string) => ({ id, title, status: 'OPEN', section: 'NO_DUE_DATE', createdAt, assignedToMe: true, fromAssistant: false, caseHasProcess: false, href: `/tasks?focus=${id}` });
    await page.route('**/v1/tasks/overview**', (route) =>
      route.fulfill({
        json: {
          items: [task('t1', 'Charlie anrufen', '2026-09-01T08:00:00.000Z'), task('t2', 'Alpha prüfen', '2026-10-01T08:00:00.000Z'), task('t3', 'Bravo senden', '2026-10-05T08:00:00.000Z')],
          total: 3,
          counts: { OVERDUE: 0, TODAY: 0, LATER: 0, NO_DUE_DATE: 3, DONE: 0 },
          generatedAt: new Date().toISOString(),
        },
      }),
    );
    await page.goto('/tasks');
    await expect(page.getByText(/angelegt 01\.09\.2026, \d{2}:\d{2}/)).toBeVisible();
    const titles = page.locator('li p.font-medium');

    await page.getByLabel('Sortieren nach').selectOption('title');
    await expect(titles).toHaveText(['Alpha prüfen', 'Bravo senden', 'Charlie anrufen']);
    await page.getByLabel('Sortieren nach').selectOption('newest');
    await expect(titles).toHaveText(['Bravo senden', 'Alpha prüfen', 'Charlie anrufen']);
    await page.getByLabel('Sortieren nach').selectOption('oldest');
    await expect(titles).toHaveText(['Charlie anrufen', 'Alpha prüfen', 'Bravo senden']);
  });
});

test.describe('Suche: Absprung auf genau den Treffer', () => {
  test('ein Kontakt aus der Suche öffnet die Kontakte beschränkt auf diesen einen Eintrag – mit dem Weg zurück zur ganzen Liste', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const unique = `Suchtreffer${Date.now().toString(36)}`;
    const created = await fetch(`${API_BASE_URL}/api/v1/contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ firstName: unique, lastName: 'Testkontakt' }) });
    expect(created.ok).toBe(true);
    const contact = (await created.json()) as { id: string };

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/dashboard');
    await page.getByRole('combobox', { name: 'In ORBIT suchen' }).fill(unique);
    const option = page.getByRole('option').filter({ hasText: `${unique} Testkontakt` });
    await expect(option).toBeVisible();
    await option.click();

    await expect(page).toHaveURL(new RegExp(`/sales/contacts\\?focus=${contact.id}`));
    await expect(page.getByText('Angezeigt wird nur der Treffer aus der Suche')).toBeVisible();
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`${unique} Testkontakt`);

    await page.getByRole('button', { name: 'Alle anzeigen' }).click();
    await expect(page).toHaveURL(/\/sales\/contacts$/);
    await expect(page.getByText('Angezeigt wird nur der Treffer aus der Suche')).toHaveCount(0);
    expect(await rows.count()).toBeGreaterThan(1);
  });
});

test.describe('Unterbrochene Verbindung', () => {
  const integration = (status: string) => [{ id: 'i1', tenantId: 't1', connectorType: 'GMAIL', status, hasCredentials: true, grantedCapabilities: ['email.read', 'email.send'], externalAccountDisplayName: 'me@example.com', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];

  test('Banner auf jeder Seite mit Handlungsweg, solange Gmail unterbrochen ist; bei bestehender Verbindung kein Banner (simulierte Antwort)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    let status = 'AUTH_REQUIRED';
    await page.route('**/api/v1/integrations', (route) => route.fulfill({ json: integration(status) }));

    await page.goto('/tasks');
    const banner = page.getByTestId('connection-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Die Verbindung zu');
    await expect(banner).toContainText('Freigaben bleiben dann offen');
    await banner.getByRole('link', { name: 'Jetzt erneuern' }).click();
    await expect(page).toHaveURL(/\/integrations$/);
    await expect(page.getByTestId('connection-banner')).toBeVisible(); // auch dort

    status = 'CONNECTED';
    await page.goto('/cases');
    await expect(page.getByRole('heading', { name: 'Vorgänge' })).toBeVisible();
    await expect(page.getByTestId('connection-banner')).toHaveCount(0);
  });
});

test.describe('Automatisierungsgrad', () => {
  test('drei Stufen mit Folgen; die Wahl sendet genau diese Stufe (simulierte Antworten – die Regeln des Demo-Mandanten bleiben unverändert)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    const overview = {
      current: 'CAUTIOUS',
      presets: [
        { key: 'CAUTIOUS', label: 'Vorsichtig', description: 'Alles braucht Freigabe.', changes: [] },
        { key: 'BALANCED', label: 'Ausgewogen (empfohlen)', description: 'Rückfragen gehen selbstständig hinaus.', changes: [{ action: 'email.send.clarification', from: 'REQUIRE_APPROVAL', to: 'AUTONOMOUS' }] },
        { key: 'HIGH', label: 'Hochautomatisiert', description: 'Fast alles läuft selbstständig.', changes: [{ action: 'followup.send', from: 'REQUIRE_APPROVAL', to: 'AUTONOMOUS' }] },
      ],
    };
    let posted: unknown;
    await page.route('**/api/v1/policies/automation', async (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { current: 'BALANCED', changed: 1 } });
      }
      return route.fulfill({ json: overview });
    });

    await page.goto('/admin/policies');
    const card = page.getByTestId('automation-level');
    await expect(card.getByText('Aktuell:')).toContainText('Vorsichtig');
    await expect(card.getByText('Rückfrage an den Absender senden: Freigabe erforderlich → Autonom')).toBeVisible();
    await card.getByRole('button', { name: /Stufe „Ausgewogen \(empfohlen\)“ wählen/ }).click();
    await expect(card.getByRole('status')).toContainText('Stufe „Ausgewogen (empfohlen)“ gesetzt (1 Regel geändert)');
    expect(posted).toEqual({ preset: 'BALANCED' });
  });
});
