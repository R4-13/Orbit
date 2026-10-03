import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  DEFAULT_AGENT_DEFINITIONS,
  DEFAULT_POLICY_CONFIG,
  DEFAULT_ROLE_PERMISSIONS,
  NotFoundError,
  PolicyViolationError,
  ROLES,
} from '@orbit/shared';
import type {
  AgentRun,
  Approval,
  AuditLog,
  BookingProposal,
  Case,
  Company,
  Contact,
  Document,
  EmailMessage,
  FinanceTransfer,
  Integration,
  Invoice,
  Lead,
  Meeting,
  Opportunity,
  Supplier,
  Task,
  Tenant,
  ToolInvocation,
  User,
} from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantDataExport {
  exportedAt: string;
  tenant: Tenant;
  users: Array<Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'status' | 'lastLoginAt' | 'createdAt'>>;
  cases: Case[];
  tasks: Task[];
  documents: Document[];
  emailMessages: EmailMessage[];
  suppliers: Supplier[];
  invoices: Invoice[];
  bookingProposals: BookingProposal[];
  financeTransfers: FinanceTransfer[];
  approvals: Approval[];
  companies: Company[];
  contacts: Contact[];
  leads: Lead[];
  opportunities: Opportunity[];
  meetings: Meeting[];
  integrations: Array<
    Pick<Integration, 'id' | 'connectorType' | 'status' | 'config' | 'lastTestedAt' | 'lastTestStatus' | 'createdAt'>
  >;
  agentRuns: AgentRun[];
  toolInvocations: ToolInvocation[];
  auditLogs: AuditLog[];
}

const USER_EXPORT_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

const INTEGRATION_EXPORT_SELECT = {
  id: true,
  connectorType: true,
  status: true,
  config: true,
  lastTestedAt: true,
  lastTestStatus: true,
  createdAt: true,
} as const;

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
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async bootstrapTenant(input: BootstrapTenantInput): Promise<BootstrapTenantResult> {
    return this.prisma.$transaction(async (tx) => {
      // A brand-new tenant/role/user genuinely can't be scoped to a
      // tenantId that doesn't exist yet — the one legitimate use of the
      // Postgres RLS bypass GUC here (see PrismaService.withRlsBypass;
      // this method predates that helper by using its own $transaction()
      // for the whole bootstrap, so the bypass is set inline instead).
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

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

      // Agenten-Konfiguration (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1):
      // seeds the three built-in agents as ACTIVE, editable rows —
      // IntakeService resolves them by `key` at runtime instead of using
      // literal prompt strings. A loop (not createMany) because each row
      // also needs its own first AgentDefinitionVersion for the rollback
      // history, which needs the generated id back.
      for (const def of DEFAULT_AGENT_DEFINITIONS) {
        const agentDefinition = await tx.agentDefinition.create({
          data: {
            tenantId: tenant.id,
            key: def.key,
            name: def.name,
            description: def.description,
            baseType: def.baseType,
            systemPrompt: def.systemPrompt,
            allowedTools: [...def.allowedTools],
            status: 'ACTIVE',
          },
        });
        await tx.agentDefinitionVersion.create({
          data: {
            tenantId: tenant.id,
            agentDefinitionId: agentDefinition.id,
            version: 1,
            systemPrompt: def.systemPrompt,
            allowedTools: [...def.allowedTools],
            changeNote: 'Initiale Konfiguration bei Tenant-Bootstrap.',
          },
        });
      }

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

  /** Lightweight tenant self-view for /admin/settings — avoids pulling the full §52 export bundle (and its audit event) just to render a name/locale. */
  async getOwnTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.prisma.forTenantId(tenantId).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundError('Tenant not found.', { id: tenantId });
    }
    return tenant;
  }

  /**
   * §52 Datenexport: a single JSON bundle of everything this tenant owns,
   * for the "right to data portability" — every collection queried through
   * forTenantId() (never the raw client), so this can never leak another
   * tenant's rows even if called with a forged id. Deliberately excludes
   * secrets that were never the tenant's own "data" to export in the first
   * place: password hashes, refresh token hashes, and connector
   * credentials (Integration.credentialReference only points at a vault
   * row — see CredentialVaultService — never exported either way).
   */
  async exportTenantData(tenantId: string, actorUserId: string): Promise<TenantDataExport> {
    const scoped = this.prisma.forTenantId(tenantId);

    const [
      tenant,
      users,
      cases,
      tasks,
      documents,
      emailMessages,
      suppliers,
      invoices,
      bookingProposals,
      financeTransfers,
      approvals,
      companies,
      contacts,
      leads,
      opportunities,
      meetings,
      integrations,
      agentRuns,
      toolInvocations,
      auditLogs,
    ] = await Promise.all([
      scoped.tenant.findUnique({ where: { id: tenantId } }),
      scoped.user.findMany({ select: USER_EXPORT_SELECT, orderBy: { createdAt: 'asc' } }),
      scoped.case.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.task.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.document.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.emailMessage.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.supplier.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.invoice.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.bookingProposal.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.financeTransfer.findMany({ orderBy: { startedAt: 'asc' } }),
      scoped.approval.findMany({ orderBy: { requestedAt: 'asc' } }),
      scoped.company.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.contact.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.lead.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.opportunity.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.meeting.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.integration.findMany({ select: INTEGRATION_EXPORT_SELECT, orderBy: { createdAt: 'asc' } }),
      scoped.agentRun.findMany({ orderBy: { startedAt: 'asc' } }),
      scoped.toolInvocation.findMany({ orderBy: { createdAt: 'asc' } }),
      scoped.auditLog.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);

    if (!tenant) {
      throw new NotFoundError('Tenant not found.', { id: tenantId });
    }

    await this.audit.record({
      tenantId,
      eventType: 'TENANT_DATA_EXPORTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Tenant',
      entityId: tenantId,
    });

    return {
      exportedAt: new Date().toISOString(),
      tenant,
      users,
      cases,
      tasks,
      documents,
      emailMessages,
      suppliers,
      invoices,
      bookingProposals,
      financeTransfers,
      approvals,
      companies,
      contacts,
      leads,
      opportunities,
      meetings,
      integrations,
      agentRuns,
      toolInvocations,
      auditLogs,
    };
  }

  /** §52 Tenant-Löschungsworkflow, Schritt 1: records intent, does not delete anything yet. */
  async requestDeletion(tenantId: string, actorUserId: string): Promise<Tenant> {
    const updated = await this.prisma.forTenantId(tenantId).tenant.update({
      where: { id: tenantId },
      data: { deletionRequestedAt: new Date(), deletionRequestedByUserId: actorUserId },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TENANT_DELETE_REQUESTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Tenant',
      entityId: tenantId,
    });

    return updated;
  }

  /** Undoes a pending deletion request — the workflow's escape hatch before the irreversible step. */
  async cancelDeletionRequest(tenantId: string, actorUserId: string): Promise<Tenant> {
    const tenant = await this.prisma.forTenantId(tenantId).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.deletionRequestedAt) {
      throw new PolicyViolationError('No pending deletion request for this tenant.', { id: tenantId });
    }

    const updated = await this.prisma.forTenantId(tenantId).tenant.update({
      where: { id: tenantId },
      data: { deletionRequestedAt: null, deletionRequestedByUserId: null },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TENANT_DELETE_REQUESTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Tenant',
      entityId: tenantId,
      payload: { cancelled: true },
    });

    return updated;
  }

  /**
   * §52 Tenant-Löschungsworkflow, Schritt 2: the irreversible step.
   * Requires a prior requestDeletion() call — a second, separately
   * authenticated call is the deliberate safety hurdle here, not a
   * confirmation dialog (there is no UI concept at this layer).
   *
   * Deleting the Tenant row cascades (`onDelete: Cascade`, see every
   * relation in schema.prisma) through every one of its ~19 tenant-scoped
   * child tables in one operation — including its own AuditLog rows. That
   * means the TENANT_DELETE_COMPLETED fact cannot itself be written to
   * this tenant's audit trail (it wouldn't survive the delete it
   * describes), so it goes to the structured application logger instead —
   * a durable, platform-level audit trail outside any single tenant's
   * scope doesn't exist in this schema and would be a separate feature
   * (see docs/ASSUMPTIONS.md Phase 19f).
   */
  async confirmDeletion(tenantId: string, actorUserId: string): Promise<{ tenantId: string; deletedAt: string }> {
    const tenant = await this.prisma.forTenantId(tenantId).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.deletionRequestedAt) {
      throw new PolicyViolationError('Tenant deletion must be requested first.', { id: tenantId });
    }

    await this.prisma.forTenantId(tenantId).tenant.delete({ where: { id: tenantId } });

    const deletedAt = new Date().toISOString();
    this.logger.warn(
      `Tenant ${tenantId} (${tenant.name}) permanently deleted (§52 DSGVO), requested by ${tenant.deletionRequestedByUserId}, confirmed by ${actorUserId}, at ${deletedAt}.`,
    );

    return { tenantId, deletedAt };
  }
}
