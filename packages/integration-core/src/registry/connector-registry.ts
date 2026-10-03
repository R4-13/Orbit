import type { ConnectorMetadata } from './types';

/**
 * §4 ("Connector Registry") des Integration-Framework-Amendments — eine
 * statische Liste, kein DB-Admin-UI: für Phase 1/2 ausreichend (§21.10
 * verlangt nur, dass neue Connectoren "ohne Änderung des Framework-Kerns"
 * ergänzbar sind — ein neuer Array-Eintrag erfüllt das; eine dynamische,
 * administrierbare Registry wäre Komplexität vor echtem Bedarf, siehe
 * `docs/INTEGRATION_FRAMEWORK_PHASE1_PLAN.md`).
 *
 * `capabilities` je Connector sind bewusst exakt die real vorhandenen
 * Methoden des jeweiligen `*Connector`-Interfaces (siehe
 * `packages/integration-core/src/<kategorie>/types.ts`) — nicht die
 * Amendment-Beispielstrings (§4/§9 kennzeichnen diese selbst als
 * "Beispiele"). `scopes` bleibt für jeden Connector bewusst leer: keiner
 * der projekteigenen Provider-Integrationsdokumente (docs/*_INTEGRATION.md,
 * docs/TELEPHONY.md) listet bereits verifizierte, exakte OAuth-Scope-
 * Strings — jeder nennt das ausdrücklich als offenen Punkt für die
 * tatsächliche App-Registrierung. Erst beim realen Connector (Increment C
 * für Gmail) werden Scopes gegen die offizielle Google-Dokumentation
 * verifiziert und eingetragen — nicht vorher geraten (CLAUDE.md: "Erfinde
 * niemals API-Endpunkte von Drittanbietern").
 *
 * `MICROSOFT` deckt laut `docs/MICROSOFT_INTEGRATION.md` zwar potenziell
 * Mail+Kalender über denselben OAuth-Client ab, hat aber nur eine einzige
 * `IntegrationConnectorType`-Zeile (kein separater `MICROSOFT_CALENDAR`-
 * Wert) — hier bewusst nur als Mail-Connector geführt, konsistent mit der
 * bereits bestehenden Frontend-Beschriftung ("Microsoft 365 (Mail)",
 * `apps/web/.../integrations/page.tsx`).
 */
export const CONNECTOR_REGISTRY: readonly ConnectorMetadata[] = [
  {
    id: 'DATEV',
    name: 'DATEV',
    provider: 'DATEV eG',
    category: 'finance',
    description: 'Lieferantenabgleich und Rechnungsübertragung an DATEV-Finanzbuchführung.',
    icon: 'receipt',
    status: 'active',
    authentication: { type: 'oauth2' },
    requiredFields: [],
    optionalFields: [],
    capabilities: ['finance.supplier.read', 'finance.supplier.write', 'finance.invoice.transfer'],
    scopes: [],
    setup: { mode: 'guided', sondeSupported: true },
    liveConnectSupported: false,
    testConnectionSupported: true,
    disconnectSupported: true,
    syncModes: ['on_demand'],
    webhookSupport: false,
    pollingSupport: false,
    documentationReference: 'docs/DATEV_INTEGRATION.md',
    version: '1.0.0',
  },
  {
    id: 'LEXWARE',
    name: 'Lexware Office',
    provider: 'Lexware',
    category: 'finance',
    description: 'Lieferantenabgleich und Rechnungsübertragung an Lexware Office.',
    icon: 'receipt',
    status: 'active',
    authentication: { type: 'oauth2' },
    requiredFields: [],
    optionalFields: [],
    capabilities: ['finance.supplier.read', 'finance.supplier.write', 'finance.invoice.transfer'],
    scopes: [],
    setup: { mode: 'guided', sondeSupported: true },
    liveConnectSupported: false,
    testConnectionSupported: true,
    disconnectSupported: true,
    syncModes: ['on_demand'],
    webhookSupport: false,
    pollingSupport: false,
    documentationReference: 'docs/INTEGRATIONS.md',
    version: '1.0.0',
  },
  {
    id: 'MICROSOFT',
    name: 'Microsoft 365',
    provider: 'Microsoft',
    category: 'mail',
    description: 'E-Mail lesen und senden über Microsoft Graph (Outlook/Exchange Online).',
    icon: 'mail',
    status: 'active',
    authentication: { type: 'oauth2' },
    requiredFields: [],
    optionalFields: [],
    capabilities: ['email.read', 'email.send'],
    scopes: [],
    setup: { mode: 'guided', sondeSupported: true },
    liveConnectSupported: false,
    testConnectionSupported: true,
    disconnectSupported: true,
    syncModes: ['polling', 'on_demand'],
    webhookSupport: false,
    pollingSupport: true,
    documentationReference: 'docs/MICROSOFT_INTEGRATION.md',
    version: '1.0.0',
  },
  {
    id: 'GMAIL',
    name: 'Gmail',
    provider: 'Google',
    category: 'mail',
    description: 'E-Mail lesen und senden über ein verbundenes Gmail- oder Google-Workspace-Konto.',
    icon: 'mail',
    status: 'active',
    authentication: { type: 'oauth2' },
    requiredFields: [],
    optionalFields: [],
    capabilities: ['email.read', 'email.send'],
    scopes: [],
    setup: { mode: 'guided', sondeSupported: true },
    liveConnectSupported: true,
    testConnectionSupported: true,
    disconnectSupported: true,
    syncModes: ['polling', 'on_demand'],
    webhookSupport: false,
    pollingSupport: true,
    documentationReference: 'docs/GOOGLE_INTEGRATION.md',
    version: '1.0.0',
  },
  {
    id: 'GOOGLE_CALENDAR',
    name: 'Google Calendar',
    provider: 'Google',
    category: 'calendar',
    description: 'Verfügbarkeiten prüfen und Termine im verbundenen Google-Kalender anlegen.',
    icon: 'calendar',
    status: 'active',
    authentication: { type: 'oauth2' },
    requiredFields: [],
    optionalFields: [],
    capabilities: ['calendar.availability.read', 'calendar.meeting.create'],
    scopes: [],
    setup: { mode: 'guided', sondeSupported: true },
    liveConnectSupported: false,
    testConnectionSupported: true,
    disconnectSupported: true,
    syncModes: ['on_demand'],
    webhookSupport: false,
    pollingSupport: false,
    documentationReference: 'docs/GOOGLE_INTEGRATION.md',
    version: '1.0.0',
  },
  {
    id: 'HUBSPOT',
    name: 'HubSpot',
    provider: 'HubSpot',
    category: 'crm',
    description: 'Kontakte, Unternehmen und Leads mit HubSpot CRM synchronisieren.',
    icon: 'users',
    status: 'active',
    authentication: { type: 'oauth2' },
    requiredFields: [],
    optionalFields: [],
    capabilities: ['crm.contact.write', 'crm.company.write', 'crm.lead.create', 'crm.activity.log'],
    scopes: [],
    setup: { mode: 'guided', sondeSupported: true },
    liveConnectSupported: false,
    testConnectionSupported: true,
    disconnectSupported: true,
    syncModes: ['on_demand'],
    webhookSupport: false,
    pollingSupport: false,
    documentationReference: 'docs/HUBSPOT_INTEGRATION.md',
    version: '1.0.0',
  },
  {
    id: 'TWILIO',
    name: 'Twilio',
    provider: 'Twilio',
    category: 'telephony',
    description: 'Kürzlich geführte Anrufe für die Telefonie-Anbindung abrufen.',
    icon: 'phone',
    status: 'active',
    authentication: { type: 'api_key' },
    // §5.2 — ein strukturiertes API-Key-Paar statt des Auth-Tokens, siehe docs/TELEPHONY.md ("empfohlen gegenüber dem Auth-Token").
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
      { key: 'apiSecret', label: 'API Secret', type: 'secret', required: true },
    ],
    optionalFields: [],
    capabilities: ['telephony.calls.read'],
    scopes: [],
    setup: { mode: 'guided', sondeSupported: true },
    liveConnectSupported: false,
    testConnectionSupported: true,
    disconnectSupported: true,
    syncModes: ['on_demand'],
    webhookSupport: false,
    pollingSupport: false,
    documentationReference: 'docs/TELEPHONY.md',
    version: '1.0.0',
  },
] as const;

export function getConnectorMetadata(id: string): ConnectorMetadata | undefined {
  return CONNECTOR_REGISTRY.find((connector) => connector.id === id);
}
