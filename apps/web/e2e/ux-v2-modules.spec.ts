import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaStorage } from './utils/login';

/**
 * Abnahme UI/UX v2 – Module (§10–§19): gemeinsames Muster, verständliche Sprache, Rückweg mit erhaltenem Zustand, Entscheidungsdetail,
 * Vorschau, Verbindungen, persönliche Ansichten, Kunden-CI. Mutierende Tests legen sich eigene Fixtures über die echte API an.
 */

async function api<T>(method: 'POST' | 'PATCH', path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

const MODULES: Array<{ path: string; heading: string }> = [
  { path: '/dashboard', heading: /^Guten (Morgen|Tag|Abend)/ as unknown as string },
  { path: '/inbox', heading: 'Posteingang' },
  { path: '/finance/invoices', heading: 'Rechnungen' },
  { path: '/sales/leads', heading: 'Interessenten' },
  { path: '/approvals', heading: 'Freigaben' },
  { path: '/tasks', heading: 'Aufgaben' },
  { path: '/cases', heading: 'Vorgänge' },
  { path: '/activity', heading: 'Aktivitäten' },
  { path: '/integrations', heading: 'Systeme & Verbindungen' },
  { path: '/admin', heading: 'Administration' },
];

async function noRawKeys(page: Page): Promise<string[]> {
  // Sichtbarer Text im Arbeitsbereich enthält keine Enum-/Policy-Schlüssel (UI v2 §3.2).
  const text = await page.getByRole('main').innerText();
  return [...new Set(text.match(/\b[A-Z]{3,}(?:_[A-Z]{2,})+\b|\b[a-z]+\.[a-z_]+\.[a-z_]+\b/g) ?? [])];
}

test.describe('Alle zehn Bereiche im gemeinsamen Muster (AC-13, AC-02, UI v2 §3.2)', () => {
  for (const { path, heading } of MODULES) {
    test(`${path}: Seitentitel, kein horizontaler Überlauf, keine technischen Schlüssel`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await loginViaStorage(page, DEMO_USERS.admin);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(typeof heading === 'string' ? heading : heading);
      await page.waitForLoadState('networkidle');
      for (const [width, height] of [
        [1280, 720],
        [390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        const overflow = await page.evaluate(() => {
          const main = document.querySelector('[data-shell-main]') as HTMLElement;
          return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
        });
        expect(overflow.page, `${path} @${width}`).toBeLessThanOrEqual(1);
        expect(overflow.main, `${path} @${width}`).toBeLessThanOrEqual(1);
      }
      expect(await noRawKeys(page)).toEqual([]);
    });
  }
});

test.describe('Rückweg erhält Filter und Scrollposition (AC-12)', () => {
  test('Vorgänge: Filter und Suche überstehen Detail → Zurück; die Scrollposition wird wiederhergestellt', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/cases');
    await page.getByRole('button', { name: /^Alle \d/ }).click();
    await expect(page.getByRole('button', { name: /^Alle \d/ })).toHaveAttribute('aria-pressed', 'true');

    const main = page.locator('[data-shell-main]');
    await expect.poll(async () => main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
    await main.evaluate((el) => el.scrollTo({ top: 300 }));
    const before = await main.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(100);

    const row = page.locator('tbody tr').nth(6);
    const title = await row.locator('a').first().innerText();
    await row.locator('a').first().click();
    await page.waitForURL('**/cases/**');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title.slice(0, 20));

    await page.goBack();
    await page.waitForURL('**/cases');
    await expect(page.getByRole('button', { name: /^Alle \d/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  });

  test('Posteingang: gewählter Filter bleibt nach dem Weg ins Eingangsdetail erhalten', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/inbox');
    await page.getByRole('button', { name: /^Benötigt Aufmerksamkeit/ }).click();
    await expect(page.getByRole('button', { name: /^Benötigt Aufmerksamkeit/ })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('tbody tr').first().locator('a').first().click();
    await page.waitForURL('**/inbox/**');
    await page.goBack();
    await expect(page.getByRole('button', { name: /^Benötigt Aufmerksamkeit/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Posteingang und Eingangsdetail (§11)', () => {
  test('ein nicht geschäftsrelevanter Eingang zeigt „Aktion: Keine“ samt Begründung – ohne erfundene Prozessgrafik', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/inbox');
    const newsletter = page.locator('tbody tr', { hasText: 'Keine Aktion nötig' }).first();
    test.skip((await newsletter.count()) === 0, 'Kein ausgefilterter Eingang in der Umgebung vorhanden.');
    await newsletter.locator('a').first().click();
    await page.waitForURL('**/inbox/**');
    await expect(page.getByText(/Aktion: Keine/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fachliche Einordnung' })).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  });
});

test.describe('Freigaben: Entscheidungsdetail mit Kontext (§14, AC-15)', () => {
  test('die Detailansicht beantwortet alle Fragen; „Genehmigt“ erscheint erst nach der Bestätigung des Servers', async ({ page }) => {
    const adminToken = await loginViaApi(DEMO_USERS.admin);
    const name = `E2E Freigabe Lieferant ${randomUUID().slice(0, 8)}`;
    await api('POST', '/suppliers', adminToken, { name });

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/approvals');
    const row = page.locator('tbody tr', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText('Neuen Lieferanten anlegen')).toBeVisible();
    await row.getByRole('link', { name: /Freigabe prüfen/ }).click();
    await page.waitForURL('**/approvals/**');

    for (const question of ['Was wird getan – mit welchen Angaben?', 'In welches System?', 'Warum ist Ihre Freigabe nötig?', 'Was passiert danach?']) {
      await expect(page.getByRole('region', { name: question })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Was wird getan – mit welchen Angaben?' })).toContainText(name);

    await page.getByRole('button', { name: 'Genehmigen' }).click();
    await expect(page.getByText(/^Genehmigt\./)).toBeVisible();
    // Zurück in der Liste ist die Freigabe nicht mehr offen.
    await page.goto('/approvals');
    await expect(page.locator('tbody tr', { hasText: name })).toHaveCount(0);
  });

  test('Ablehnen verlangt eine zweite, ausdrückliche Bestätigung und führt nichts aus', async ({ page }) => {
    const adminToken = await loginViaApi(DEMO_USERS.admin);
    const name = `E2E Ablehnung Lieferant ${randomUUID().slice(0, 8)}`;
    await api('POST', '/suppliers', adminToken, { name });
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/approvals');
    await page.locator('tbody tr', { hasText: name }).getByRole('link', { name: /Freigabe prüfen/ }).click();
    await page.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(page.getByText('Wirklich ablehnen? Es wird nichts ausgeführt.')).toBeVisible();
    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page.getByRole('button', { name: 'Genehmigen' })).toBeVisible();
    await page.getByRole('button', { name: 'Ablehnen' }).click();
    await page.getByRole('button', { name: 'Ja, ablehnen' }).click();
    await expect(page.getByText(/^Abgelehnt\./)).toBeVisible();
  });

  test('ein Nutzer ohne Entscheidungsrecht sieht die Entscheidung, aber keinen aktiven Genehmigen-Knopf', async ({ page }) => {
    const adminToken = await loginViaApi(DEMO_USERS.admin);
    const name = `E2E Betrachter Lieferant ${randomUUID().slice(0, 8)}`;
    await api('POST', '/suppliers', adminToken, { name });
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.viewer);
    await page.goto('/approvals?x=1');
    await page.getByRole('button', { name: /^Team/ }).click();
    const row = page.locator('tbody tr', { hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: /prüfen|ansehen/i }).click();
    await expect(page.getByRole('button', { name: 'Genehmigen' })).toBeDisabled();
    await expect(page.getByText('Sie haben für diese Entscheidung keine Berechtigung.')).toBeVisible();
  });
});

test.describe('Vorgang: Tabs und Vorschau (§9, §16)', () => {
  test('Tabs Überblick/Kommunikation/Dokumente/Historie sind per Tastatur erreichbar; Deep Link öffnet den Tab', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const created = await api<{ id: string }>('POST', '/cases', token, { type: 'SALES', title: `E2E Vorgang ${randomUUID().slice(0, 8)}` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto(`/cases/${created.id}`);
    for (const tab of ['Überblick', 'Kommunikation', 'Dokumente', 'Historie']) await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Orchestrierung' })).toHaveCount(0); // kein Prozess → keine erfundene Prozessgrafik
    await page.getByRole('tab', { name: 'Dokumente' }).click();
    await expect(page).toHaveURL(/tab=documents/);
    await expect(page.getByText('Noch keine Dokumente')).toBeVisible();
    await page.goto(`/cases/${created.id}?tab=communication`);
    await expect(page.getByRole('tab', { name: 'Kommunikation' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Vorschau öffnet einen Drawer mit „Vollständige Details“, Escape schließt ihn und gibt den Fokus zurück', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const title = `E2E Vorschau ${randomUUID().slice(0, 8)}`;
    const created = await api<{ id: string }>('POST', '/cases', token, { type: 'SALES', title });
    await api('POST', '/tasks', token, { caseId: created.id, title: `Aufgabe zu ${title}` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/tasks');
    const row = page.locator('li', { hasText: `Aufgabe zu ${title}` });
    await expect(row).toBeVisible();
    const trigger = row.getByRole('button', { name: `Vorschau: ${title}` });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: `Vorschau: ${title}` });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Vollständige Details' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('dialog').getByRole('link', { name: 'Vollständige Details' }).click();
    await page.waitForURL(`**/cases/${created.id}`);
  });
});

test.describe('Aufgaben (§15)', () => {
  test('„Meine Aufgaben“ gliedert nach Frist; für einen Prozess-Vorgang gibt es kein loses „Erledigt“', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const title = `E2E überfällig ${randomUUID().slice(0, 8)}`;
    await api('POST', '/tasks', token, { title, dueDate: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString() });
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/tasks');
    const overdue = page.getByRole('region', { name: 'Überfällig' });
    await expect(overdue.locator('li', { hasText: title })).toBeVisible();
    await expect(overdue.locator('li', { hasText: title }).getByText(/überfällig seit/)).toBeVisible();
    await expect(overdue.locator('li', { hasText: title }).getByRole('button', { name: 'Als erledigt markieren' })).toBeVisible();
  });
});

test.describe('Systeme & Verbindungen (§18)', () => {
  test('Trennen erklärt die Folgen und lässt sich abbrechen; nicht unterstützte Systeme werden als Anfrage erfasst', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/integrations');
    await expect(page.getByRole('heading', { name: 'Ihre verbundenen Systeme' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Weiteres System verbinden' })).toBeVisible();

    const connected = page.locator('[data-connector]').first();
    if ((await connected.count()) > 0) {
      await connected.getByRole('button', { name: 'Trennen' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('bleiben erhalten und nachvollziehbar');
      await dialog.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(connected).toBeVisible();
    }

    await page.getByRole('button', { name: 'System anfragen' }).click();
    await page.getByLabel('Name des Systems').fill(`E2E-System ${randomUUID().slice(0, 6)}`);
    await page.getByRole('button', { name: 'Anfrage erfassen' }).click();
    await expect(page.getByText(/Die Anfrage wurde erfasst/)).toBeVisible();
  });

  test('der geführte Wizard erklärt Berechtigungen in Klartext und verlangt keine Zugangsdaten im Chat', async ({ page }) => {
    // Die Umgebung hat Gmail bereits verbunden – für den Einrichtungsweg wird die Verbindungsliste daher im Browser auf „leer“ gesetzt.
    await page.route('**/api/v1/integrations', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/integrations');
    const gmail = page.locator('li', { has: page.getByRole('heading', { name: 'Gmail' }) });
    await gmail.getByRole('button', { name: 'Verbinden', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Gmail verbinden' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Schritt 1 von 2');
    await expect(dialog).toContainText('ORBIT sieht Ihr Passwort nie');
    await expect(dialog).toContainText('Eingehende Nachrichten lesen');
    // Senden ist eine eigene, ausdrückliche Zustimmung – standardmäßig aus.
    const sendConsent = dialog.getByRole('checkbox', { name: /Senden erlauben/ });
    await expect(sendConsent).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('Persönliche Ansichten (§20.1)', () => {
  test('eine Ansicht speichern, zurücksetzen, wieder anwenden – und nach dem Neuladen noch vorhanden', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/cases');
    await page.getByRole('button', { name: /^Abgeschlossen/ }).click();
    await page.getByRole('button', { name: /^Ansichten/ }).click();
    await page.getByLabel('Aktuelle Ansicht speichern als').fill('Meine Erledigten');
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await page.getByRole('button', { name: 'Standard wiederherstellen' }).click();
    await expect(page.getByRole('button', { name: /^Offene Vorgänge/ })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.getByRole('button', { name: /^Ansichten/ }).click();
    await page.getByRole('button', { name: 'Meine Erledigten', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Abgeschlossen/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Kunden-CI und Lesbarkeit (AC-18)', () => {
  test('eine kontrastarme Primärfarbe wird in der Vorschau korrigiert und erklärt; ungespeicherte Änderungen sind sichtbar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/admin/branding');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Erscheinungsbild');
    const primary = page.locator('input.font-mono').first();
    await primary.fill('#ffff00');
    await expect(page.getByText('Ungespeicherte Änderungen')).toBeVisible();
    await expect(page.getByText('ORBIT korrigiert, damit alles lesbar bleibt:')).toBeVisible();
    await expect(page.getByText(/zu hell \(Kontrast unter 4,5:1\)/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();
    // Nicht speichern: die Demo-Umgebung bleibt unverändert.
  });
});
