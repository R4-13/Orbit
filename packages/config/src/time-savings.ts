/**
 * Default effort estimates (in minutes) used by the Dashboard to compute
 * "geschätzte eingesparte Zeit" (estimated time saved). These are
 * approximations, not measurements, and must be presented as such in the
 * UI. Tenant admins can override them per-tenant (see AdminModule /
 * PolicyModule); these are only the system defaults.
 */
export const DEFAULT_TIME_SAVINGS_MINUTES = {
  email_classification: 3,
  invoice_capture: 12,
  crm_activity: 5,
  meeting_coordination: 10,
  lead_qualification: 8,
  duplicate_check: 4,
  booking_proposal: 6,
} as const;

export type TimeSavingsActivity = keyof typeof DEFAULT_TIME_SAVINGS_MINUTES;
