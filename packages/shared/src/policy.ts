/**
 * Policy Engine core types — shared between the API (PolicyModule), the
 * agent runtime, and the frontend (which renders the current mode per
 * action in /admin/policies).
 */

export const POLICY_MODES = ['DISABLED', 'SUGGEST_ONLY', 'REQUIRE_APPROVAL', 'AUTONOMOUS'] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

/**
 * Least-to-most autonomous, in that order (index in POLICY_MODES doubles
 * as its own rank). Used by the /admin/policies CRUD (PolicyConfigService,
 * apps/api) to enforce a `locked` action's autonomy ceiling: a locked
 * row can only be changed to a mode whose rank is <= the ceiling defined
 * in DEFAULT_POLICY_CONFIG for that action — e.g. PAYMENT_EXECUTE
 * (locked at DISABLED, rank 0) can never be changed to anything else,
 * while SUPPLIER_CREATE (locked at REQUIRE_APPROVAL, rank 2) can be
 * tightened to DISABLED/SUGGEST_ONLY but never relaxed to AUTONOMOUS.
 */
export function policyModeRank(mode: PolicyMode): number {
  return POLICY_MODES.indexOf(mode);
}

/**
 * Canonical action keys that the Policy Engine governs. Every tool in the
 * Tool Registry maps to exactly one of these (see @orbit/agent-core).
 */
export const POLICY_ACTIONS = {
  EMAIL_CLASSIFY: 'email.classify',
  LEAD_CREATE: 'lead.create',
  FOLLOW_UP_SEND: 'followup.send',
  BOOKING_PROPOSAL_CREATE: 'booking_proposal.create',
  INVOICE_TRANSFER_TO_FIBU: 'invoice.transfer_to_fibu',
  SUPPLIER_BANK_DETAILS_CHANGE: 'supplier.bank_details.change',
  SUPPLIER_CREATE: 'supplier.create',
  PAYMENT_EXECUTE: 'payment.execute',
  CRM_ACTIVITY_LOG: 'crm.activity.log',
  MEETING_PROPOSE: 'meeting.propose',
  MEETING_CREATE: 'meeting.create',
  /**
   * Added for Agent Runtime wiring (docs/ASSUMPTIONS.md Phase 18): the
   * §14 tool list needs a policy action for every tool, including the
   * ones §17 never named a default for. All four are routine,
   * low-risk data-entry/read steps — AUTONOMOUS by default, same
   * category as EMAIL_CLASSIFY/LEAD_CREATE.
   */
  INVOICE_INTAKE: 'invoice.intake',
  CONTACT_MANAGE: 'crm.contact.manage',
  TASK_CREATE: 'task.create',
  CALENDAR_READ: 'calendar.read',
  EMAIL_DRAFT: 'email.draft',
  /** §25-33 des Master-Dokuments ("Sonde") — deckt jeden reinen Lese-Tool-Aufruf des Copilots ab (§26 ASK-Modus). Kein Seiteneffekt, daher AUTONOMOUS-Default wie CALENDAR_READ. */
  COPILOT_READ: 'copilot.read',
  /** Channel Event Runtime — die Relevanz-/Triage-Einstufung (BUSINESS_ACTIONABLE/.../UNKNOWN_REQUIRES_REVIEW), die JEDEM eingehenden Intake-Event vorausgeht. Reine Klassifikation ohne Seiteneffekt, daher wie EMAIL_CLASSIFY AUTONOMOUS. */
  EMAIL_TRIAGE: 'email.triage',
  /** Business Process Framework (Amendment 02 §9): read-only context/requirement/price lookups and internal artifacts. */
  CONTEXT_LOOKUP: 'context.lookup',
  REQUIREMENTS_RESOLVE: 'requirements.resolve',
  PRICING_RESOLVE: 'pricing.resolve',
  QUOTE_CREATE: 'quote.create',
  QUOTE_RENDER: 'quote.render',
  /**
   * Outbound mail to a customer is split by purpose (§14.2): a question for missing information and the delivery of a
   * quote are different risks. Both default to REQUIRE_APPROVAL — the safe baseline of §14.2; a tenant explicitly
   * enables autonomy per purpose (a clarification may be autonomous, a quote delivery stays approval-bound until a
   * checked tenant policy says otherwise).
   */
  EMAIL_SEND_CLARIFICATION: 'email.send.clarification',
  EMAIL_SEND_QUOTE_DELIVERY: 'email.send.quote_delivery',
  /** Amendment 02 §11: der KI-Prozessplaner schlägt einen Plan vor (reine Planung ohne Wirkung; jede Aktion im Plan bleibt einzeln policy-pflichtig). */
  PROCESS_PLAN: 'process.plan',
  /**
   * Autonomie-Ausbau (Oktober 2026): ein von der KI frei geplanter Ablauf (ohne hinterlegten Prozess) darf **ohne vorherige Bestätigung des ganzen Plans** starten.
   * Jede Wirkung nach außen bleibt trotzdem einzeln durch ihre eigene Regel geschützt (Freigabe oder autonom). Vorsichtig: der Plan wartet auf eine Bestätigung.
   */
  PROCESS_PLAN_ACTIVATE: 'process.plan.activate',
  /** Eingangsbestätigung, Statusauskunft, Anforderung eines fehlenden Anhangs, Terminbestätigung: Mitteilungen ohne Zusage von Preis oder Leistung. */
  EMAIL_SEND_ACKNOWLEDGEMENT: 'email.send.acknowledgement',
  /** Auskunft aus dem Betriebswissen (Profil, freigegebene Antworten) an die Kundschaft – inhaltlich eine Zusage des Betriebs, daher strenger geführt. */
  EMAIL_SEND_INFORMATION: 'email.send.information',
  /** Interne Benachrichtigung einer Person des Betriebs (Meldung, Erinnerung, Eskalation) – kein Kundenkontakt. */
  STAFF_NOTIFY: 'staff.notify',
  /** Antwort aus dem Betriebswissen ermitteln (Lesen, keine Wirkung). */
  KNOWLEDGE_ANSWER: 'knowledge.answer',
} as const;

export type PolicyActionKey = (typeof POLICY_ACTIONS)[keyof typeof POLICY_ACTIONS];

/**
 * System defaults per §17 of the master spec. Tenants may override any of
 * these via PolicyModule, EXCEPT the two marked `locked`, which always
 * require human approval regardless of tenant configuration, and
 * PAYMENT_EXECUTE, which is hard-disabled for the MVP.
 */
export interface PolicyDefault {
  mode: PolicyMode;
  /** If true, a tenant admin cannot relax this below REQUIRE_APPROVAL. */
  locked?: boolean;
}

export const DEFAULT_POLICY_CONFIG: Record<PolicyActionKey, PolicyDefault> = {
  [POLICY_ACTIONS.EMAIL_CLASSIFY]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.LEAD_CREATE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.FOLLOW_UP_SEND]: { mode: 'REQUIRE_APPROVAL' },
  [POLICY_ACTIONS.BOOKING_PROPOSAL_CREATE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.INVOICE_TRANSFER_TO_FIBU]: { mode: 'REQUIRE_APPROVAL' },
  [POLICY_ACTIONS.SUPPLIER_BANK_DETAILS_CHANGE]: { mode: 'REQUIRE_APPROVAL', locked: true },
  [POLICY_ACTIONS.SUPPLIER_CREATE]: { mode: 'REQUIRE_APPROVAL', locked: true },
  [POLICY_ACTIONS.PAYMENT_EXECUTE]: { mode: 'DISABLED', locked: true },
  [POLICY_ACTIONS.CRM_ACTIVITY_LOG]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.MEETING_PROPOSE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.MEETING_CREATE]: { mode: 'REQUIRE_APPROVAL' },
  [POLICY_ACTIONS.INVOICE_INTAKE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.CONTACT_MANAGE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.TASK_CREATE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.CALENDAR_READ]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.EMAIL_DRAFT]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.COPILOT_READ]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.EMAIL_TRIAGE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.CONTEXT_LOOKUP]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.REQUIREMENTS_RESOLVE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.PRICING_RESOLVE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.QUOTE_CREATE]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.QUOTE_RENDER]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.EMAIL_SEND_CLARIFICATION]: { mode: 'REQUIRE_APPROVAL' },
  [POLICY_ACTIONS.EMAIL_SEND_QUOTE_DELIVERY]: { mode: 'REQUIRE_APPROVAL' },
  [POLICY_ACTIONS.PROCESS_PLAN]: { mode: 'AUTONOMOUS' },
  // Feste Vorgabe (Entscheidung D4, Addendum ADD-2.1): schreibende Wirkungen eines unbekannten Vorgangs brauchen die Planfreigabe – kein Autonomiegrad hebt das auf.
  [POLICY_ACTIONS.PROCESS_PLAN_ACTIVATE]: { mode: 'REQUIRE_APPROVAL', locked: true },
  [POLICY_ACTIONS.EMAIL_SEND_ACKNOWLEDGEMENT]: { mode: 'REQUIRE_APPROVAL' },
  [POLICY_ACTIONS.EMAIL_SEND_INFORMATION]: { mode: 'REQUIRE_APPROVAL' },
  [POLICY_ACTIONS.STAFF_NOTIFY]: { mode: 'AUTONOMOUS' },
  [POLICY_ACTIONS.KNOWLEDGE_ANSWER]: { mode: 'AUTONOMOUS' },
};
