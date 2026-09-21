import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DEFAULT_POLICY_CONFIG, DEFAULT_ROLE_PERMISSIONS, ROLES } from '@orbit/shared';
import type { Tenant, User } from '@orbit/domain';
import { PrismaService } from '../prisma/prisma.service';

export interface BootstrapTenantInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
}

export interface BootstrapTenantResult {
  tenant: Tenant;
  adminUser: User;
}

/**
 * Provisions a brand-new tenant: the Tenant row itself, the six default
 * roles (seeded from DEFAULT_ROLE_PERMISSIONS, @orbit/shared) with their
 * out-of-the-box permission grants, the default Policy Engine configuration
 * per tenant (DEFAULT_POLICY_CONFIG), and the tenant's first user (assigned
 * the TENANT_ADMIN role).
 *
 * Deliberately not exposed as a public, unauthenticated HTTP endpoint —
 * unlike every other tenant-scoped write, this one runs on the *unscoped*
 * PrismaService (forTenant() can't scope to a tenant that doesn't exist
 * yet). It's meant to be called from trusted contexts only: the demo-data
 * seed script (Phase 13) and, later, an internal ops/admin tool. Self-serve
 * tenant signup is out of scope for the MVP (see docs/PRODUCT_CONTEXT.md
 * "Nicht-Ziele des MVP") and was not implemented as a guess.
 */
@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrapTenant(input: BootstrapTenantInput): Promise<BootstrapTenantResult> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: input.name, slug: input.slug },
      });

      let tenantAdminRoleId: string | undefined;

      for (const roleName of Object.values(ROLES)) {
        const role = await tx.role.create({
          data: { tenantId: tenant.id, name: roleName, isSystemDefault: true },
        });

        const permissions = DEFAULT_ROLE_PERMISSIONS[roleName];
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({ roleId: role.id, permission })),
          });
        }

        if (roleName === ROLES.TENANT_ADMIN) {
          tenantAdminRoleId = role.id;
        }
      }

      if (!tenantAdminRoleId) {
        // Unreachable unless ROLES/DEFAULT_ROLE_PERMISSIONS in @orbit/shared
        // drop TENANT_ADMIN — guarded so a future refactor fails loudly.
        throw new Error('TENANT_ADMIN role was not seeded; cannot assign tenant admin.');
      }

      await tx.policyConfig.createMany({
        data: Object.entries(DEFAULT_POLICY_CONFIG).map(([action, config]) => ({
          tenantId: tenant.id,
          action,
          mode: config.mode,
          locked: config.locked ?? false,
        })),
      });

      const passwordHash = await argon2.hash(input.adminPassword);
      const adminUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.adminEmail,
          passwordHash,
          firstName: input.adminFirstName,
          lastName: input.adminLastName,
          status: 'ACTIVE',
        },
      });

      await tx.userRole.create({
        data: { userId: adminUser.id, roleId: tenantAdminRoleId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          eventType: 'USER_CREATED',
          actorType: 'SYSTEM',
          entityType: 'User',
          entityId: adminUser.id,
          payload: { email: adminUser.email, role: ROLES.TENANT_ADMIN, reason: 'tenant_bootstrap' },
        },
      });

      return { tenant, adminUser };
    });
  }
}
