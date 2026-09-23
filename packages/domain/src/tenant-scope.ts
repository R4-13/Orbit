import { Prisma, type PrismaClient } from '@prisma/client';
import { TenantIsolationViolationError } from '@orbit/shared';

/**
 * Every Prisma model that carries a `tenantId` column. Kept as an explicit
 * list rather than derived from `Prisma.dmmf` at runtime: the generated
 * client in this Prisma version does not publicly export `dmmf`, and an
 * explicit list is easier to audit in review than reflection over generated
 * internals. Must be kept in sync with prisma/schema.prisma — a mismatch is
 * caught by tenant-scope.spec.ts, which cross-checks this list against every
 * model Prisma.ModelName defines.
 *
 * `RefreshToken`, `RolePermission`, `UserRole` are deliberately excluded:
 * none of the three has its own `tenant_id` column (they reach their tenant
 * only indirectly, via `User`/`Role`) and none has a Postgres RLS policy of
 * its own (docs/SECURITY.md §1) — the three excluded tables mentioned there.
 * Listing them here used to be a real, if dormant, bug: `applyTenantScope()`
 * would try to stamp a nonexistent `tenantId` column into their writes,
 * which Prisma rejects outright (`Unknown argument \`tenantId\``), and their
 * reads would come back empty under RLS with no GUC set — found live while
 * writing `tenant-admin.e2e-spec.ts` (Phase 19f), the first code path ever
 * to call `forTenantId().userRole.create()`. See docs/ASSUMPTIONS.md.
 */
export const TENANT_SCOPED_MODELS = [
  'User',
  'Role',
  'PolicyConfig',
  'AuditLog',
  'Case',
  'Task',
  'Document',
  'EmailMessage',
  'Supplier',
  'Invoice',
  'BookingProposal',
  'FinanceTransfer',
  'Approval',
  'Company',
  'Contact',
  'Lead',
  'Opportunity',
  'Meeting',
  'Integration',
  'AgentRun',
  'ToolInvocation',
  'WebhookEvent',
  'AgentDefinition',
  'AgentDefinitionVersion',
  'WorkflowDefinition',
  'WorkflowStepDefinition',
  'WorkflowRun',
  'WorkflowStepRun',
] as const satisfies readonly Prisma.ModelName[];

const TENANT_SCOPED_MODEL_SET: ReadonlySet<string> = new Set(TENANT_SCOPED_MODELS);

export function isTenantScopedModel(modelName: string): boolean {
  return TENANT_SCOPED_MODEL_SET.has(modelName);
}

const READ_AND_BULK_WRITE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
]);

type PlainArgs = Record<string, unknown>;

function assertNotCrossTenant(providedTenantId: unknown, tenantId: string): void {
  if (typeof providedTenantId === 'string' && providedTenantId !== tenantId) {
    throw new TenantIsolationViolationError(
      'Query/write attempted to target a different tenant than the active session.',
      { attempted: providedTenantId, expected: tenantId },
    );
  }
}

function mergeTenantIntoWhere(where: unknown, tenantId: string): PlainArgs {
  const nextWhere = { ...(where as PlainArgs | undefined) };
  assertNotCrossTenant(nextWhere.tenantId, tenantId);
  nextWhere.tenantId = tenantId;
  return nextWhere;
}

/**
 * Rewrites a Prisma operation's args so every read is filtered to `tenantId`
 * and every write is stamped with it — the application-layer defense line
 * against TenantIsolationViolationError described in prisma/schema.prisma's
 * header comment, complemented by Postgres Row-Level Security as a second,
 * DB-level line (see `forTenant()` below and
 * prisma/migrations/20260921124445_enable_row_level_security). Exported
 * standalone (rather than only inline in the `$extends` call) so it can be
 * unit-tested without a live database connection.
 */
export function applyTenantScope(operation: string, args: unknown, tenantId: string): PlainArgs {
  const nextArgs: PlainArgs = { ...(args as PlainArgs | undefined) };

  if (READ_AND_BULK_WRITE_OPERATIONS.has(operation)) {
    nextArgs.where = mergeTenantIntoWhere(nextArgs.where, tenantId);
  }

  if (operation === 'create') {
    const data = (nextArgs.data as PlainArgs | undefined) ?? {};
    assertNotCrossTenant(data.tenantId, tenantId);
    nextArgs.data = { ...data, tenantId };
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = nextArgs.data;
    if (Array.isArray(data)) {
      nextArgs.data = data.map((row: PlainArgs) => {
        assertNotCrossTenant(row.tenantId, tenantId);
        return { ...row, tenantId };
      });
    }
  }

  if (operation === 'upsert') {
    nextArgs.where = mergeTenantIntoWhere(nextArgs.where, tenantId);
    const create = (nextArgs.create as PlainArgs | undefined) ?? {};
    assertNotCrossTenant(create.tenantId, tenantId);
    nextArgs.create = { ...create, tenantId };
    const update = (nextArgs.update as PlainArgs | undefined) ?? {};
    assertNotCrossTenant(update.tenantId, tenantId);
    nextArgs.update = update;
  }

  return nextArgs;
}

/** Prisma's generated delegate property name for a model, e.g. "BookingProposal" -> "bookingProposal". */
function toDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

type AnyDelegate = Record<string, (args: unknown) => unknown>;

/**
 * Returns a Prisma Client bound to a single tenant: every query against a
 * tenant-scoped model is automatically filtered/stamped with `tenantId`, and
 * any attempt (by a bug, not a user) to read or write another tenant's row
 * throws TenantIsolationViolationError instead of silently leaking data.
 *
 * Each tenant-scoped operation also runs inside its own interactive
 * transaction that sets the `app.tenant_id` session GUC via
 * `SELECT set_config(..., true)` (i.e. `SET LOCAL` semantics — scoped to
 * that one transaction, automatically reset on commit/rollback, so it can
 * never leak onto a pooled connection's next query) before running the
 * real operation on that same transaction/connection. This is what makes
 * the Postgres Row-Level Security policies added in
 * prisma/migrations/20260921124445_enable_row_level_security actually see
 * the tenant context — RLS is the DB-level defense-in-depth line beneath
 * this application-layer one (see docs/ASSUMPTIONS.md Phase 15). The one
 * extra round-trip per query is an accepted MVP tradeoff for correctness.
 *
 * Usage: request-scoped, built once per request from the authenticated
 * user's tenantId (see AuthModule, Phase 3) — never share one instance
 * across tenants/requests.
 */
export function forTenant<T extends PrismaClient>(prisma: T, tenantId: string): T {
  if (!tenantId) {
    throw new TenantIsolationViolationError('forTenant() requires a non-empty tenantId.');
  }

  return prisma.$extends({
    name: 'orbit-tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !isTenantScopedModel(model)) {
            return query(args);
          }
          const scopedArgs = applyTenantScope(operation, args, tenantId);

          return prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
            const delegate = (tx as unknown as Record<string, AnyDelegate | undefined>)[toDelegateName(model)];
            const run = delegate?.[operation];
            if (typeof run !== 'function') {
              throw new Error(`Unknown Prisma operation "${operation}" on model "${model}".`);
            }
            return run.call(delegate, scopedArgs);
          });
        },
      },
    },
  }) as unknown as T;
}
