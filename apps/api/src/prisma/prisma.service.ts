import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { Prisma, PrismaClient, forTenant } from '@orbit/domain';
import { ORBIT_ENV } from '../config/env.token';

/**
 * Process-wide Prisma connection. Never query this directly for
 * tenant-scoped data from application code — call `forTenantId()` to get a
 * client that enforces tenant isolation (see @orbit/domain/tenant-scope).
 * Direct access is only appropriate for tenant-independent operations
 * (creating a new tenant itself, cross-tenant admin/reporting jobs) — those
 * must explicitly enable the Postgres RLS bypass GUC for their transaction
 * (see AuthService/TenantsService), since this connects as the restricted
 * "orbit_app" role, not the migration-owning superuser (docs/ASSUMPTIONS.md
 * Phase 15) — connecting via DATABASE_URL_APP rather than the schema's own
 * DATABASE_URL (which only the Prisma CLI/migrations use) is exactly what
 * makes Row-Level Security apply at all: Postgres superusers (the role that
 * owns/migrates the schema) unconditionally bypass RLS regardless of policy.
 *
 * Deliberately does NOT eagerly $connect() in onModuleInit: Prisma connects
 * lazily on first query by default, so routes/tests that never touch the
 * database (e.g. the health check) can boot the app without a reachable
 * Postgres instance.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ORBIT_ENV) env: OrbitEnv) {
    super({ datasourceUrl: env.DATABASE_URL_APP });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Returns a Prisma Client bound to a single tenant (see forTenant() in @orbit/domain). */
  forTenantId(tenantId: string) {
    return forTenant(this, tenantId);
  }

  /**
   * Runs several operations atomically for ONE tenant: the transaction carries `app.tenant_id`, so Postgres
   * Row-Level Security (role orbit_app) confines every statement to that tenant. Used where state and an event must be
   * persisted together (Amendment 02 §12.3). The `tx` client is deliberately not wrapped by the application-layer
   * scope — callers must still put `tenantId` into their `where`/`data`; RLS is the hard guarantee.
   */
  async inTenantTransaction<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!tenantId) throw new Error('inTenantTransaction() requires a non-empty tenantId.');
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Runs `fn` inside a transaction with the Postgres RLS bypass GUC
   * (`app.bypass_rls`) enabled for that transaction only — for the small,
   * explicit set of genuinely cross-tenant operations that must run before
   * an authenticated tenantId exists: tenant bootstrap
   * (TenantsService.bootstrapTenant), login/refresh/logout (AuthService,
   * which must look up a user/refresh token by a tenant-independent key
   * before it knows the tenant), and the demo-data seed script. Never call
   * this from request-handling code that already has an authenticated
   * tenantId — use `forTenantId()` instead. See docs/ASSUMPTIONS.md Phase 15.
   */
  async withRlsBypass<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    });
  }
}
