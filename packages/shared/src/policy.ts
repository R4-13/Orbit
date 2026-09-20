/**
 * Policy Engine core types — shared between the API (PolicyModule), the
 * agent runtime, and the frontend (which renders the current mode per
 * action in /admin/policies).
 */

export const POLICY_MODES = ['DISABLED', 'SUGGEST_ONLY', 'REQUIRE_APPROVAL', 'AUTONOMOUS'] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

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
};
