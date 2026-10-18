import { expect, test, type Page } from '@playwright/test';
import { DEMO_USERS, loginViaStorage } from './utils/login';

/**
 * Einrichtungsassistent: führt durch Profil, Mitarbeitende, Postfach, Kalender, CRM und Regeln und zeigt, was ORBIT damit übernimmt. Die Antworten der API sind vorgegeben,
 * damit der Demo-Mandant unberührt bleibt; geprüft wird die Führung (Reihenfolge, nächster Schritt, Rückweg), nicht die Berechnung (sie hat eigene Tests).
 */
const item = (label: string, done: boolean) => ({ label, done });
const step = (key: string, title: string, status: 'DONE' | 'PARTIAL' | 'OPEN', required: boolean, items: Array<[string, boolean]>, href: string, actionLabel: string) => ({
  key,
  title,
  why: `Warum ${title} wichtig ist.`,
  required,
  status,
  items: items.map(([label, done]) => item(label, done)),
  action: { label: actionLabel, href },
});
const task = (key: string, title: string, state: string, detail: string, unlock?: { label: string; stepKey: string }) => ({ key, title, state, detail, ...(unlock ? { unlock } : {}) });

const NEW_TENANT = {
  steps: [
    step('PROFILE', 'Ihr Betrieb', 'OPEN', true, [['Branche', false], ['Leistungen', false]], '/admin/company', 'Betriebsprofil bearbeiten'),
    step('STAFF', 'Ihre Mitarbeitenden', 'OPEN', true, [['Mitarbeitende erfasst', false]], '/admin/staff', 'Mitarbeitende erfassen'),
    step('MAIL', 'E-Mail (Gmail)', 'OPEN', true, [['Gmail verbunden', false]], '/integrations', 'Gmail verbinden'),
    step('CALENDAR', 'Kalender', 'OPEN', false, [['Freie und belegte Zeiten lesen', false]], '/integrations', 'Kalender erlauben'),
    step('CRM', 'CRM (HubSpot)', 'OPEN', false, [['HubSpot verbunden', false]], '/integrations', 'HubSpot verbinden'),
    step('RULES', 'Wie selbstständig ORBIT arbeitet', 'OPEN', true, [['Automatisierungsgrad gewählt', false]], '/admin/policies', 'Regeln wählen'),
  ],
  tasks: [
    task('READ_MAIL', 'Eingehende Mails lesen und einordnen', 'UNAVAILABLE', 'Ohne verbundenes Postfach nimmt ORBIT keine Anfragen entgegen.', { label: 'Gmail verbinden', stepKey: 'MAIL' }),
    task('PROPOSE_SLOTS', 'Termine aus Ihrem Kalender vorschlagen', 'BY_HAND', 'Ohne Kalender bittet ORBIT die Kundschaft um Terminwünsche.', { label: 'Kalender erlauben', stepKey: 'CALENDAR' }),
    task('HANDOFF', 'Anfragen an Ihr CRM übergeben', 'AUTOMATIC', 'Ohne CRM führt ORBIT Kontakt und Interessent in der eigenen Kundenverwaltung.'),
  ],
  requiredDone: 0,
  requiredTotal: 4,
  ready: false,
};

const READY = {
  ...NEW_TENANT,
  steps: NEW_TENANT.steps.map((s) => (s.required ? { ...s, status: 'DONE', items: s.items.map((i) => ({ ...i, done: true })) } : s)),
  tasks: [task('READ_MAIL', 'Eingehende Mails lesen und einordnen', 'AUTOMATIC', 'ORBIT liest das verbundene Postfach.'), task('BOOK', 'Gewählte Termine im Kalender buchen', 'WITH_APPROVAL', 'Vor der Ausführung geben Sie frei.')],
  requiredDone: 4,
  ready: true,
};

async function mockSetup(page: Page, body: unknown) {
  await page.route('**/api/v1/tenant/setup', (route) => route.fulfill({ json: body }));
}

test.describe('Einrichtungsassistent', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
  });

  test('ein neuer Betrieb: Fortschritt, nächster Pflichtschritt, Reihenfolge der Schritte und was ORBIT noch nicht übernimmt', async ({ page }) => {
    await mockSetup(page, NEW_TENANT);
    await page.goto('/admin/setup');
    await expect(page.getByRole('heading', { name: 'Einrichtungsassistent' })).toBeVisible();
    await expect(page.getByTestId('setup-progress')).toHaveText('0 von 4 Pflichtschritten erledigt');
    await expect(page.getByTestId('setup-next')).toContainText('Als Nächstes: Ihr Betrieb');
    await expect(page.getByTestId('setup-ready')).toHaveCount(0);
    const order = await page.locator('[data-testid^="setup-step-"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')));
    expect(order).toEqual(['setup-step-PROFILE', 'setup-step-STAFF', 'setup-step-MAIL', 'setup-step-CALENDAR', 'setup-step-CRM', 'setup-step-RULES']);
    await expect(page.getByTestId('setup-step-CALENDAR')).toContainText('optional');
    await expect(page.getByTestId('setup-task-READ_MAIL')).toHaveAttribute('data-state', 'UNAVAILABLE');
    await expect(page.getByTestId('setup-task-READ_MAIL')).toContainText('Noch nicht möglich');
    await expect(page.getByTestId('setup-task-PROPOSE_SLOTS')).toContainText('Von Hand');
    // Ein Hinweis in der Aufgabenliste führt zum Schritt, der sie freischaltet.
    await page.getByTestId('setup-task-READ_MAIL').getByRole('link', { name: 'Gmail verbinden' }).click();
    await expect(page).toHaveURL(/#step-MAIL$/);
  });

  test('ein Schritt führt zur passenden Seite; dort gibt es einen Rückweg zum Assistenten, auf anderen Seiten nicht', async ({ page }) => {
    await mockSetup(page, NEW_TENANT);
    await page.goto('/admin/setup');
    await page.getByTestId('setup-step-STAFF').getByRole('link', { name: 'Mitarbeitende erfassen' }).click();
    await expect(page).toHaveURL(/\/admin\/staff$/);
    const back = page.getByTestId('setup-return');
    await expect(back).toBeVisible();
    await back.getByRole('link', { name: 'Zurück zum Einrichtungsassistenten' }).click();
    await expect(page).toHaveURL(/\/admin\/setup$/);
    // Auf dem Assistenten selbst ist der Rückweg zurückgesetzt: wer später woanders hingeht, sieht ihn nicht mehr.
    await page.goto('/admin/staff');
    await expect(page.getByTestId('setup-return')).toHaveCount(0);
  });

  test('der Rückweg erscheint nicht auf Home und nicht auf fremden Seiten, auch wenn man aus dem Assistenten kam', async ({ page }) => {
    await mockSetup(page, NEW_TENANT);
    await page.goto('/admin/setup');
    await page.getByTestId('setup-step-RULES').getByRole('link', { name: 'Regeln wählen' }).click();
    await expect(page.getByTestId('setup-return')).toBeVisible();
    await page.goto('/dashboard');
    await expect(page.getByTestId('setup-return')).toHaveCount(0);
  });

  test('sind alle Pflichtschritte erledigt, ist ORBIT startklar; optionale Schritte bleiben als Erweiterung', async ({ page }) => {
    await mockSetup(page, READY);
    await page.goto('/admin/setup');
    await expect(page.getByTestId('setup-ready')).toContainText('ORBIT ist startklar');
    await expect(page.getByTestId('setup-next')).toHaveCount(0);
    await expect(page.getByTestId('setup-progress')).toHaveText('4 von 4 Pflichtschritten erledigt');
    await expect(page.getByTestId('setup-step-PROFILE')).toHaveAttribute('data-status', 'DONE');
    await expect(page.getByTestId('setup-step-PROFILE').getByRole('link', { name: 'Ändern' })).toBeVisible();
    await expect(page.getByTestId('setup-step-CRM').getByRole('link', { name: 'HubSpot verbinden' })).toBeVisible();
    await expect(page.getByTestId('setup-task-BOOK')).toContainText('Mit Ihrer Freigabe');
  });

  test('„Stand aktualisieren“ fragt erneut ab; ein Fehler wird mit Wiederholen angezeigt', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/v1/tenant/setup', (route) => {
      calls += 1;
      return calls <= 2 ? route.fulfill({ status: 500, json: { message: 'kaputt' } }) : route.fulfill({ json: NEW_TENANT });
    });
    await page.goto('/admin/setup');
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible({ timeout: 20_000 }); // die Abfrage wird einmal automatisch wiederholt (daher scheitern die ersten zwei Aufrufe)
    await page.getByRole('button', { name: 'Erneut versuchen' }).click();
    await expect(page.getByTestId('setup-progress')).toBeVisible();
    const before = calls;
    await page.getByRole('button', { name: 'Stand aktualisieren' }).click();
    await expect.poll(() => calls).toBeGreaterThan(before);
  });

  test('der Assistent steht im Menü unter Administration', async ({ page }) => {
    await mockSetup(page, NEW_TENANT);
    await page.goto('/admin');
    await page.getByRole('link', { name: 'Einrichtungsassistent' }).first().click();
    await expect(page).toHaveURL(/\/admin\/setup$/);
  });
});
