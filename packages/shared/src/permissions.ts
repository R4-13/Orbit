/**
 * Canonical permission strings used throughout the platform. RBAC (role ->
 * permission set) is configured in @orbit/domain; this is the single source
 * of truth for permission *names* so they can't drift between modules.
 */
export const PERMISSIONS = {
  // Invoices / Finance
  INVOICE_READ: 'invoice.read',
  INVOICE_APPROVE: 'invoice.approve',
  INVOICE_TRANSFER: 'invoice.transfer',
  BOOKING_CREATE: 'booking.create',
  BOOKING_READ: 'booking.read',
  SUPPLIER_MANAGE: 'supplier.manage',

  // Sales / CRM
  CRM_CONTACT_CREATE: 'crm.contact.create',
  CRM_CONTACT_READ: 'crm.contact.read',
  CRM_LEAD_CREATE: 'crm.lead.create',
  CRM_OPPORTUNITY_MANAGE: 'crm.opportunity.manage',

  // Communication
  EMAIL_SEND: 'email.send',
  EMAIL_READ: 'email.read',
  MEETING_CREATE: 'meeting.create',

  // Cases / Tasks
  CASE_READ: 'case.read',
  CASE_MANAGE: 'case.manage',
  TASK_READ: 'task.read',
  TASK_MANAGE: 'task.manage',

  // Approvals
  APPROVAL_READ: 'approval.read',
  APPROVAL_DECIDE: 'approval.decide',

  // Integrations / Admin
  INTEGRATION_CONFIGURE: 'integration.configure',
  POLICY_MANAGE: 'policy.manage',
  USER_MANAGE: 'user.manage',
  TENANT_MANAGE: 'tenant.manage',
  AUDIT_READ: 'audit.read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLES = {
  TENANT_ADMIN: 'TENANT_ADMIN',
  FINANCE_USER: 'FINANCE_USER',
  SALES_USER: 'SALES_USER',
  APPROVER: 'APPROVER',
  VIEWER: 'VIEWER',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

/**
 * Default permission grants per role. Seeded into the Role/Permission
 * tables at tenant bootstrap; tenant admins may customize from there via
 * AdminModule — this is only the out-of-the-box mapping.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SYSTEM_ADMIN: Object.values(PERMISSIONS),
  TENANT_ADMIN: Object.values(PERMISSIONS).filter((p) => p !== PERMISSIONS.TENANT_MANAGE),
  FINANCE_USER: [
    PERMISSIONS.INVOICE_READ,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_READ,
    PERMISSIONS.CASE_READ,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_MANAGE,
    PERMISSIONS.APPROVAL_READ,
  ],
  SALES_USER: [
    PERMISSIONS.CRM_CONTACT_CREATE,
    PERMISSIONS.CRM_CONTACT_READ,
    PERMISSIONS.CRM_LEAD_CREATE,
    PERMISSIONS.CRM_OPPORTUNITY_MANAGE,
    PERMISSIONS.EMAIL_READ,
    PERMISSIONS.MEETING_CREATE,
    PERMISSIONS.CASE_READ,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_MANAGE,
  ],
  APPROVER: [
    PERMISSIONS.APPROVAL_READ,
    PERMISSIONS.APPROVAL_DECIDE,
    PERMISSIONS.INVOICE_READ,
    PERMISSIONS.INVOICE_APPROVE,
    PERMISSIONS.INVOICE_TRANSFER,
    PERMISSIONS.SUPPLIER_MANAGE,
    PERMISSIONS.CASE_READ,
  ],
  VIEWER: [
    PERMISSIONS.INVOICE_READ,
    PERMISSIONS.CRM_CONTACT_READ,
    PERMISSIONS.CASE_READ,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.APPROVAL_READ,
  ],
};
