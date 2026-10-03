/**
 * §4 des Integration-Framework-Amendments (ORBIT_MASTER_SPECIFICATION_v3_
 * AMENDMENT_01_INTEGRATION_FRAMEWORK.md). `ConnectorId` ist bewusst ein
 * eigenständiger String-Literal-Typ, nicht `IntegrationConnectorType` aus
 * `@orbit/domain` — `packages/integration-core` hat bis hierhin keine
 * Abhängigkeit auf `@orbit/domain`/Prisma (bewusst framework-/ORM-
 * unabhängig gehalten, siehe die bestehenden Connector-Interfaces) und
 * soll das auch nicht durch die Registry bekommen. Die Werte sind
 * identisch zu `IntegrationConnectorType`s Enum-Werten — `apps/api`
 * verbindet beide 1:1, siehe `apps/api/src/integrations/registry.ts`.
 */
export type ConnectorId = 'DATEV' | 'LEXWARE' | 'MICROSOFT' | 'GMAIL' | 'GOOGLE_CALENDAR' | 'HUBSPOT' | 'TWILIO';

export type ConnectorCategory = 'finance' | 'mail' | 'calendar' | 'crm' | 'telephony';

export type ConnectorAuthType = 'oauth2' | 'api_key' | 'user_secret' | 'custom';

export type ConnectorSetupFieldType =
  | 'text'
  | 'secret'
  | 'url'
  | 'email'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'certificate_file'
  | 'oauth_action';

/** §8 "Dynamic Setup Engine" — one entry per form field the frontend should render for non-OAuth connectors. */
export interface ConnectorSetupField {
  key: string;
  label: string;
  type: ConnectorSetupFieldType;
  required: boolean;
  /** Only meaningful for `select`/`multiselect`. */
  options?: string[];
}

export type ConnectorSyncMode = 'webhook' | 'polling' | 'on_demand' | 'batch';

/**
 * §4 Mindestinformationen. `capabilities` sind bewusst nicht die
 * Amendment-Beispielstrings (die als "Beispiele" markiert sind, §4/§9) —
 * sie spiegeln exakt die real vorhandenen Methoden des jeweiligen
 * `*Connector`-Interfaces in `packages/integration-core/src/<kategorie>/
 * types.ts` wider (z. B. `email.read` nur, weil `MailConnector.
 * listNewMessages()` real existiert — keine erfundene `attachment.read`-
 * Capability, solange kein Interface eine eigene Anhang-Methode hat).
 */
export interface ConnectorMetadata {
  id: ConnectorId;
  name: string;
  provider: string;
  category: ConnectorCategory;
  description: string;
  /** A short, generic icon identifier the frontend maps to an actual icon component — never a hotlinked external image. */
  icon: string;
  /** Whether this connector has at least a working mock implementation registered (always true today — every one of the 7 does). */
  status: 'active' | 'planned';
  authentication: {
    type: ConnectorAuthType;
  };
  requiredFields: ConnectorSetupField[];
  optionalFields: ConnectorSetupField[];
  capabilities: string[];
  /** Provider-specific OAuth scope or permission strings — only populated where a real scope name is already documented (docs/*_INTEGRATION.md), never guessed (CLAUDE.md). */
  scopes: string[];
  setup: {
    mode: 'guided' | 'manual';
    sondeSupported: boolean;
  };
  testConnectionSupported: boolean;
  disconnectSupported: boolean;
  syncModes: ConnectorSyncMode[];
  webhookSupport: boolean;
  pollingSupport: boolean;
  documentationReference: string;
  /** Registry entry schema version, not the connector implementation's version — bumped if this metadata shape changes. */
  version: string;
}
