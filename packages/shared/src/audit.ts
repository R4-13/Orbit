import { PLATFORM_AUDIT_EVENT_TYPES } from './platform';

/**
 * Canonical audit event type names (see §31 of the master spec). Every
 * significant state transition in the system emits one of these via
 * AuditModule. Keeping the list centralized prevents ad hoc, inconsistent
 * event names across modules.
 */
export const AUDIT_EVENT_TYPES = [
  'EMAIL_RECEIVED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_PARSED',
  'DOCUMENT_DELETED',
  'INVOICE_CREATED',
  'DUPLICATE_INVOICE_DETECTED',
  'BOOKING_PROPOSED',
  'APPROVAL_REQUESTED',
  'APPROVAL_GRANTED',
  'APPROVAL_REJECTED',
  'FINANCE_TRANSFER_STARTED',
  'FINANCE_TRANSFER_COMPLETED',
  'FINANCE_TRANSFER_FAILED',
  'SUPPLIER_CREATED',
  'SUPPLIER_BANK_DETAILS_CHANGED',
  'LEAD_CREATED',
  'OPPORTUNITY_CREATED',
  'OPPORTUNITY_UPDATED',
  'CRM_UPDATED',
  'CONTACT_CREATED',
  'COMPANY_CREATED',
  'EMAIL_SENT',
  'MEETING_PROPOSED',
  'MEETING_CREATED',
  'FOLLOW_UP_PROPOSED',
  'TASK_CREATED',
  'TASK_COMPLETED',
  'CASE_CREATED',
  'CASE_STATUS_CHANGED',
  'AGENT_RUN_STARTED',
  'AGENT_RUN_COMPLETED',
  'AGENT_RUN_FAILED',
  'TOOL_INVOKED',
  'POLICY_DECISION_MADE',
  'POLICY_CONFIG_UPDATED',
  'AGENT_DEFINITION_CREATED',
  'AGENT_DEFINITION_UPDATED',
  'AGENT_DEFINITION_ROLLED_BACK',
  'WORKFLOW_DEFINITION_CREATED',
  'WORKFLOW_DEFINITION_UPDATED',
  'WORKFLOW_RUN_STARTED',
  'WORKFLOW_RUN_COMPLETED',
  'WORKFLOW_RUN_FAILED',
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_CREATED',
  'USER_DEACTIVATED',
  'INTEGRATION_CONNECTED',
  'INTEGRATION_DISCONNECTED',
  /** Die Verbindung braucht eine neue Zustimmung der Person (Token endgültig abgelehnt) bzw. wurde automatisch wiederhergestellt. */
  'INTEGRATION_AUTH_REQUIRED',
  /** Einstellungen einer Verbindung geändert (z. B. welche Kalender für Terminvorschläge gelesen werden). */
  'INTEGRATION_CONFIG_UPDATED',
  /** Ein Schritt eines Vorgangs wurde automatisch wieder aufgenommen oder live wiederholt (Live-Abgleich). */
  'PROCESS_LIVE_UPGRADE',
  'TENANT_PROFILE_UPDATED',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_DEACTIVATED',
  /** Mitarbeiter per CSV oder Schnittstelle abgeglichen (Anzahl neu/geändert/unverändert, nie die Daten selbst). */
  'STAFF_IMPORTED',
  'INTEGRATION_RECOVERED',
  'INTEGRATION_TEST_FAILED',
  'WEBHOOK_RECEIVED',
  /** docs/CHANNEL_EVENT_RUNTIME_PLAN.md — WebhookIdempotencyService.recordIfNew() used for a polling-sourced (not push/webhook-delivered) event; keeps the audit trail honest about which delivery mechanism actually occurred. */
  'CHANNEL_EVENT_RECEIVED',
  /** Amendment 02 §24.3 — an earlier, provably wrong terminal status was corrected; payload carries the old/new state, reason and executor. */
  'STATUS_CORRECTED',
  /** Amendment 02 §17.2 / §19.3 — a reviewer overrode an exclusion ("Als geschäftsrelevant prüfen"); payload carries the previous relevance and the note. */
  'INTAKE_DECISION_OVERRIDDEN',
  'TENANT_DATA_EXPORTED',
  'TENANT_DELETE_REQUESTED',
  'TENANT_DELETE_COMPLETED',
  'RETENTION_POLICY_UPDATED',
  'RETENTION_APPLIED',
  'AGENT_EVALUATION_CASE_CREATED',
  'AGENT_EVALUATION_CASE_DELETED',
  'AI_PROVIDER_CONNECTED',
  'AI_PROVIDER_DISCONNECTED',
  'AI_PROVIDER_TEST_FAILED',
  'TENANT_BRANDING_UPDATED',
  'TENANT_BRANDING_RESET',
  'COPILOT_CONVERSATION_STARTED',
  'COPILOT_CONVERSATION_DELETED',
  /** Amendment 02 §8.2 — Blueprint-Lebenszyklus (Import, Statuswechsel, Mandantenaktivierung); Payload: Schlüssel, Version, Hash, alter/neuer Status. */
  'PROCESS_BLUEPRINT_IMPORTED',
  'PROCESS_BLUEPRINT_TRANSITIONED',
  'PROCESS_BLUEPRINT_ACTIVATED',
  'PROCESS_BLUEPRINT_DEACTIVATED',
  /** Amendment 02 §11/§15 — Planrevision angelegt/aktiviert/ersetzt; externe Wirkung vorbereitet/bestätigt/ungewiss. */
  'PROCESS_PLAN_CREATED',
  'PROCESS_PLAN_ACTIVATED',
  'PROCESS_ACTION_PREPARED',
  'PROCESS_ACTION_CONFIRMED',
  'PROCESS_ACTION_OUTCOME_UNKNOWN',
  /** Amendment 02 §14.5 — ein Command wurde ausgeführt, abgewiesen oder als Konflikt erkannt. */
  'CASE_COMMAND_EXECUTED',
  /** UI v2 §18.2 — ein Nutzer hat ein nicht unterstütztes System als Anfrage erfasst (kein erfundener Connector). */
  'CONNECTOR_REQUESTED',
  /** Amendment 03 §19 — Ereignisse der Plattform-Domäne (`AuditLog.domain = PLATFORM`, ohne Mandant). */
  ...PLATFORM_AUDIT_EVENT_TYPES,
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
