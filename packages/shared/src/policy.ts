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
};
