import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ROLES } from '@orbit/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TenantsService } from '../../src/tenants/tenants.service';

export const E2E_PASSWORD = 'Test#Password2026!';

export type E2eRole = 'admin' | 'finance' | 'sales' | 'approver' | 'viewer';

const ROLE_NAMES: Record<Exclude<E2eRole, 'admin'>, string> = {
  finance: ROLES.FINANCE_USER,
  sales: ROLES.SALES_USER,
  approver: ROLES.APPROVER,
  viewer: ROLES.VIEWER,
};

export interface E2eRoleTenant {
  tenantId: string;
  /** Zugangstoken je Rolle (`admin` immer, dazu die angeforderten). */
  tokens: Record<E2eRole, string>;
  /** Löscht den Betrieb samt allen Daten; mit `afterAll` aufrufen. */
  dispose: () => Promise<void>;
}

/**
 * Ein eigener, frischer Betrieb für einen Test, mit je einem Benutzer der gewünschten Rollen. Tests, die Lieferanten, Rechnungen, Vorgänge oder Freigaben anlegen, gehören
 * hierher und nicht in den Demo-Betrieb „Musterwerk“: dort bleiben sonst Testeinträge liegen (offene Freigaben, Lieferanten, Vorgänge), die echte Arbeit überdecken.
 */
export async function createRoleTenant(app: INestApplication, label: string, roles: readonly Exclude<E2eRole, 'admin'>[] = []): Promise<E2eRoleTenant> {
  const prisma = app.get(PrismaService);
  const suffix = randomUUID();
  const api = () => request(app.getHttpServer());
  const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({
    name: `E2E ${label} ${suffix.slice(0, 8)}`,
    slug: `e2e-${label}-${suffix}`,
    adminEmail: `admin-${suffix}@e2e-${label}.example`,
    adminPassword: E2E_PASSWORD,
    adminFirstName: 'E2E',
    adminLastName: 'Admin',
  });
  const login = async (email: string) => ((await api().post('/api/v1/auth/login').send({ email, password: E2E_PASSWORD }).expect(200)).body.accessToken as string);
  const tokens = { admin: await login(adminUser.email) } as Record<E2eRole, string>;
  for (const role of roles) {
    const roleRow = await prisma.forTenantId(tenant.id).role.findFirstOrThrow({ where: { name: ROLE_NAMES[role] } });
    const user = await prisma.forTenantId(tenant.id).user.create({
      data: { tenantId: tenant.id, email: `${role}-${suffix}@e2e-${label}.example`, passwordHash: await argon2.hash(E2E_PASSWORD), firstName: 'E2E', lastName: role, status: 'ACTIVE' },
    });
    await prisma.forTenantId(tenant.id).userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
    tokens[role] = await login(user.email);
  }
  return { tenantId: tenant.id, tokens, dispose: async () => void (await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenant.id } }))) };
}
