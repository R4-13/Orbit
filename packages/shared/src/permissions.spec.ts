import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from './permissions';

describe('DEFAULT_ROLE_PERMISSIONS', () => {
  it('grants SYSTEM_ADMIN every known permission', () => {
    const allPermissions = Object.values(PERMISSIONS);
    expect(new Set(DEFAULT_ROLE_PERMISSIONS.SYSTEM_ADMIN)).toEqual(new Set(allPermissions));
  });

  it('never grants TENANT_MANAGE to TENANT_ADMIN (system-admin-only permission)', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.TENANT_ADMIN).not.toContain(PERMISSIONS.TENANT_MANAGE);
  });

  it('has an entry for every declared role and only known permission strings', () => {
    const allPermissions = new Set(Object.values(PERMISSIONS));

    for (const role of Object.values(ROLES)) {
      const grants = DEFAULT_ROLE_PERMISSIONS[role];
      expect(grants).toBeDefined();
      for (const permission of grants) {
        expect(allPermissions.has(permission)).toBe(true);
      }
    }
  });

  it('gives APPROVER the invoice-approval and transfer permissions VIEWER lacks', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.APPROVER).toContain(PERMISSIONS.INVOICE_APPROVE);
    expect(DEFAULT_ROLE_PERMISSIONS.VIEWER).not.toContain(PERMISSIONS.INVOICE_APPROVE);
  });
});
