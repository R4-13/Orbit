import { expect, test } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaStorage } from './utils/login';

/**
 * Gmail mit Kalender-Verfügbarkeit (Terminvorschläge für Vor-Ort- und Telefontermine). Die Verbindung des Demo-Mandanten bleibt unberührt: die Antworten der
 * API sind vorgegeben, und die Weiterleitung zu Google wird abgefangen.
 */
const integration = (capabilities: string[], config: unknown = null) => [
  {
    id: 'i-gmail',
    tenantId: 't1',
    connectorType: 'GMAIL',
    status: 'CONNECTED',
    hasCredentials: true,
    grantedCapabilities: capabilities,
    config,
    externalAccountDisplayName: 'firma@example.com',
    lastSuccessAt: new Date().toISOString(),
    lastTestedAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

test.describe('Integrationen: Kalender-Verfügbarkeit', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
  });

  test('ohne Kalender-Berechtigung: Schaltfläche mit Erklärung; die Zustimmung fordert nur den Kalender zusätzlich an', async ({ page }) => {
    await page.route('**/api/v1/integrations', (route) => route.fulfill({ json: integration(['email.read', 'email.send']) }));
    let connectUrl = '';
    await page.route('**/api/v1/integrations/GMAIL/connect**', (route) => {
      connectUrl = route.request().url();
      return route.fulfill({ json: { authorizationUrl: '/integrations?zurueck=1' } });
    });

    await page.goto('/integrations');
    const card = page.locator('[data-connector="GMAIL"]');
    await expect(card.getByRole('button', { name: 'Sendeberechtigung erteilen' })).toHaveCount(0); // bereits erteilt
    await expect(card.getByTestId('calendar-choice')).toHaveCount(0);
    await card.getByRole('button', { name: 'Kalender-Verfügbarkeit erlauben' }).click();
    await page.waitForURL('**/integrations?zurueck=1');
    expect(connectUrl).toContain('calendar=true');
    expect(connectUrl).not.toContain('send=true'); // bestehende Berechtigungen übernimmt das Backend selbst
  });

  test('mit Kalender-Berechtigung: Auswahl der Kalender (Hauptkalender und die der Monteure), Speichern sendet genau diese Liste', async ({ page }) => {
    await page.route('**/api/v1/integrations', (route) => route.fulfill({ json: integration(['email.read', 'email.send', 'calendar.freebusy'], { calendarIds: ['monteur1@example.com'] }) }));
    let saved: unknown;
    await page.route('**/api/v1/integrations/GMAIL/calendars', async (route) => {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: integration(['email.read', 'email.send', 'calendar.freebusy'], saved)[0] });
    });

    await page.goto('/integrations');
    const card = page.locator('[data-connector="GMAIL"]');
    await expect(card.getByRole('button', { name: 'Kalender-Verfügbarkeit erlauben' })).toHaveCount(0);
    const choice = card.getByTestId('calendar-choice');
    await expect(choice.getByLabel('Kalender für Terminvorschläge')).toHaveValue('monteur1@example.com');
    await expect(choice).toContainText('sobald mindestens einer der genannten Kalender frei ist');

    await choice.getByLabel('Kalender für Terminvorschläge').fill('primary, monteur1@example.com; monteur2@example.com');
    await choice.getByRole('button', { name: 'Speichern' }).click();
    await expect(choice.getByRole('status')).toContainText('Gespeichert: Terminvorschläge berücksichtigen diese 3 Kalender.');
    expect(saved).toEqual({ calendarIds: ['primary', 'monteur1@example.com', 'monteur2@example.com'] });

    await choice.getByLabel('Kalender für Terminvorschläge').fill('   ');
    await choice.getByRole('button', { name: 'Speichern' }).click();
    await expect(choice.getByRole('alert')).toContainText('Bitte mindestens einen Kalender angeben');
  });
});

test.describe('Vorgangsansicht: Ergebnis der Anfrageprüfung', () => {
  test('das Schrittdetail nennt in Worten, was die KI erkannt, was sie fragt und welchen nächsten Schritt sie gewählt hat (vorgegebene Antwort)', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const cases = (await (await fetch(`${API_BASE_URL}/api/v1/cases`, { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; blueprintKey: string | null }>;
    const processCase = cases.find((c) => c.blueprintKey);
    test.skip(!processCase, 'Kein Vorgang auf einem Prozess vorhanden – bitte zuerst eine Angebotsanfrage im Posteingang einspielen.');

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    // Das Detail des ersten Schritts wird mit einem Ergebnis in Worten beantwortet; alles andere ist echt.
    await page.route('**/api/v1/cases/*/orchestration/nodes/**', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...body, state: 'SUCCEEDED', resultLines: ['Anfrage erkannt als: Heizungstausch im Einfamilienhaus.', 'Gewählter nächster Schritt: Einen Vor-Ort-Termin vorschlagen. Grund: Aufstellfläche muss geprüft werden.', 'Wird erfragt (1): Wie ist das Gebäude gedämmt?'] },
      });
    });
    await page.goto(`/cases/${processCase!.id}?tab=orchestration`);
    await page.getByRole('button', { name: 'Liste' }).click();
    await page.getByRole('list', { name: 'Schritte des Vorgangs in Reihenfolge' }).getByRole('listitem').first().getByRole('button').click();
    const result = page.getByTestId('node-result');
    await expect(result).toContainText('Anfrage erkannt als: Heizungstausch im Einfamilienhaus.');
    await expect(result).toContainText('Gewählter nächster Schritt: Einen Vor-Ort-Termin vorschlagen.');
  });
});
