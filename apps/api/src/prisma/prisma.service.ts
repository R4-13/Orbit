import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, forTenant } from '@orbit/domain';

/**
 * Process-wide Prisma connection. Never query this directly for
 * tenant-scoped data from application code — call `forTenantId()` to get a
 * client that enforces tenant isolation (see @orbit/domain/tenant-scope).
 * Direct access is only appropriate for tenant-independent operations
 * (creating a new tenant itself, cross-tenant admin/reporting jobs).
 *
 * Deliberately does NOT eagerly $connect() in onModuleInit: Prisma connects
 * lazily on first query by default, so routes/tests that never touch the
 * database (e.g. the health check) can boot the app without a reachable
 * Postgres instance.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Returns a Prisma Client bound to a single tenant (see forTenant() in @orbit/domain). */
  forTenantId(tenantId: string) {
    return forTenant(this, tenantId);
  }
}
