import { expect, test } from '@playwright/test';
import { DEMO_USERS, loginViaStorage } from './utils/login';

/**
 * Konzept Flexible Autonomie §8.1a/§8.2/§8.3: Regeln in sechs Gruppen mit Aktionsklassen, und der BYOK-Teil von „KI & Modelle“ ist ohne Betreiberfreigabe
 * gesperrt. Die Antworten der API sind vorgegeben – Regeln und Verbindungen des Demo-Mandanten bleiben unverändert.
 */
const policy = (action: string, mode: string, locked = false) => ({ id: action, tenantId: 't', action, mode, locked, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' });

test.describe('Regeln & Freigaben in Gruppen', () => {
  test('sechs Gruppen, strengster Wert je Gruppe, abweichende Einzelregeln sichtbar; Zahlung als „Von der Plattform gesperrt“; Technik eingeklappt', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.route('**/api/v1/policies/automation', (route) =>
      route.fulfill({ json: { current: 'CUSTOM', presets: [{ key: 'CAUTIOUS', label: 'Vorsichtig', description: 'Alles braucht Freigabe.', changes: [] }] } }),
    );
    await page.route('**/api/v1/policies', (route) =>
      route.fulfill({
        json: [
          policy('email.send.clarification', 'AUTONOMOUS'),
          policy('email.send.acknowledgement', 'AUTONOMOUS'),
          policy('email.send.information', 'REQUIRE_APPROVAL'),
          policy('email.send.quote_delivery', 'REQUIRE_APPROVAL'),
          policy('followup.send', 'REQUIRE_APPROVAL'),
          policy('meeting.propose', 'AUTONOMOUS'),
          policy('meeting.create', 'REQUIRE_APPROVAL'),
          policy('booking_proposal.create', 'AUTONOMOUS'),
          policy('lead.create', 'AUTONOMOUS'),
          policy('crm.contact.manage', 'AUTONOMOUS'),
          policy('crm.activity.log', 'AUTONOMOUS'),
          policy('staff.notify', 'AUTONOMOUS'),
          policy('task.create', 'AUTONOMOUS'),
          policy('invoice.intake', 'AUTONOMOUS'),
          policy('invoice.transfer_to_fibu', 'REQUIRE_APPROVAL'),
          policy('supplier.create', 'REQUIRE_APPROVAL', true),
          policy('supplier.bank_details.change', 'REQUIRE_APPROVAL', true),
          policy('payment.execute', 'DISABLED', true),
          policy('process.plan.activate', 'AUTONOMOUS'),
          policy('email.classify', 'AUTONOMOUS'),
          policy('knowledge.answer', 'AUTONOMOUS'),
          policy('neue.faehigkeit.test', 'AUTONOMOUS'),
        ],
      }),
    );

    await page.goto('/admin/policies');
    for (const group of ['CUSTOMER_COMMUNICATION', 'APPOINTMENTS', 'CRM_CONTACTS', 'STAFF_NOTIFICATION', 'INVOICING', 'SUPPLIERS']) {
      await expect(page.getByTestId(`policy-group-${group}`)).toBeVisible();
    }
    // Kundenkommunikation: gemischt → strengste Regel, Abweichungen werden benannt.
    const communication = page.getByTestId('policy-group-CUSTOMER_COMMUNICATION');
    await expect(communication).toContainText('Strengste Regel: Freigabe erforderlich');
    await expect(communication).toContainText('Einzelregeln weichen ab (2)');
    // CRM: einheitlich autonom.
    await expect(page.getByTestId('policy-group-CRM_CONTACTS')).toContainText('Autonom');
    await expect(page.getByTestId('policy-group-CRM_CONTACTS')).not.toContainText('Einzelregeln weichen ab');
    // Drei Klassen werden erklärt.
    await expect(communication).toContainText('Nach Freigabe: wird erst nach Ihrer Freigabe ausgeführt');
    // Zahlung: von der Plattform gesperrt, nicht in einer Gruppe.
    await expect(page.getByTestId('policy-platform-blocked')).toContainText('Zahlung ausführen');
    await expect(page.getByTestId('policy-platform-blocked')).toContainText('Gesperrt: wird nicht ausgeführt – auch nicht nach Freigabe');
    // Eine neue, keiner Gruppe zugeordnete Aktion fällt auf „Sonstiges / neue Fähigkeiten“ mit der Standardregel Freigabe – sie ist sichtbar.
    await expect(page.getByTestId('policy-ungrouped')).toContainText('neue.faehigkeit.test');
    await expect(page.getByTestId('policy-ungrouped')).toContainText('Standard: Freigabe erforderlich');
    // Freie Planung gehört zum Autonomiegrad, nicht in eine Gruppe.
    await expect(page.getByTestId('policy-level-rules')).toContainText('Frei geplanten Ablauf ohne Bestätigung starten');
    // Technik ist eingeklappt.
    await expect(page.getByTestId('policy-technical')).not.toHaveAttribute('open', '');
  });
});

test.describe('KI & Modelle: eigener Schlüssel nur mit Betreiberfreigabe', () => {
  const status = (overrides: Record<string, unknown>) => ({
    mode: 'ORBIT_MANAGED',
    connection: null,
    byokEnabled: false,
    byokSuppressed: false,
    runtime: { provider: 'openai', model: 'gpt-x', executionMode: 'LIVE', health: { state: 'NOT_VERIFIED', checkedAt: null, detail: null } },
    ...overrides,
  });

  test('ohne Freigabe: Hinweis statt „Einrichten“; eine nicht benutzte Bestandsverbindung ist gekennzeichnet und lässt sich trennen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.route('**/api/v1/ai-providers/status', (route) => route.fulfill({ json: status({}) }));
    await page.goto('/admin/ai-providers');
    await expect(page.getByTestId('byok-not-enabled')).toContainText('Für Ihr Unternehmen nicht freigegeben');
    await expect(page.getByRole('button', { name: 'Einrichten' })).toHaveCount(0);

    await page.route('**/api/v1/ai-providers/status', (route) =>
      route.fulfill({
        json: status({
          byokSuppressed: true,
          connection: { id: 'c', tenantId: 't', providerKey: 'OPENAI', status: 'CONNECTED', model: 'gpt-4o', lastTestedAt: null, lastTestStatus: null, hasCredentials: true, byokActiveSince: '2026-10-01T00:00:00Z' },
        }),
      }),
    );
    await page.goto('/admin/ai-providers');
    await expect(page.getByTestId('byok-not-enabled')).toContainText('wird deshalb derzeit nicht benutzt');
    await expect(page.getByRole('button', { name: 'Trennen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verbindung testen' })).toHaveCount(0);
  });

  test('mit Freigabe: Einrichten ist möglich', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.route('**/api/v1/ai-providers/status', (route) => route.fulfill({ json: status({ byokEnabled: true }) }));
    await page.goto('/admin/ai-providers');
    await expect(page.getByTestId('byok-not-enabled')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Einrichten' })).toBeVisible();
  });
});
