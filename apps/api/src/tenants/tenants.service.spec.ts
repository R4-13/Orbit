import { Test } from '@nestjs/testing';
import { DEFAULT_POLICY_CONFIG, DEFAULT_ROLE_PERMISSIONS, POLICY_ACTIONS, ROLES } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from './tenants.service';

describe('TenantsService', () => {
  let service: TenantsService;
  let tx: {
    $executeRaw: jest.Mock;
    tenant: { create: jest.Mock };
    role: { create: jest.Mock };
    rolePermission: { createMany: jest.Mock };
    policyConfig: { createMany: jest.Mock };
    user: { create: jest.Mock };
    userRole: { create: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let scoped: {
    tenant: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    user: { findMany: jest.Mock };
    case: { findMany: jest.Mock };
    task: { findMany: jest.Mock };
    document: { findMany: jest.Mock };
    emailMessage: { findMany: jest.Mock };
    supplier: { findMany: jest.Mock };
    invoice: { findMany: jest.Mock };
    bookingProposal: { findMany: jest.Mock };
    financeTransfer: { findMany: jest.Mock };
    approval: { findMany: jest.Mock };
    company: { findMany: jest.Mock };
    contact: { findMany: jest.Mock };
    lead: { findMany: jest.Mock };
    opportunity: { findMany: jest.Mock };
    meeting: { findMany: jest.Mock };
    integration: { findMany: jest.Mock };
    agentRun: { findMany: jest.Mock };
    toolInvocation: { findMany: jest.Mock };
    auditLog: { findMany: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock; forTenantId: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    tx = {
      // bootstrapTenant()'s first statement — sets the Postgres RLS bypass
      // GUC (Phase 15); the mock only needs to be callable as a tagged
      // template, same as the real Prisma `$executeRaw`.
      $executeRaw: jest.fn(),
      tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant_1', name: 'Musterwerk GmbH' }) },
      role: {
        create: jest.fn().mockImplementation(({ data }: { data: { name: string } }) =>
          Promise.resolve({ id: `role_${data.name}`, ...data }),
        ),
      },
      rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      policyConfig: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: {
        create: jest.fn().mockResolvedValue({ id: 'user_1', email: 'admin@musterwerk.example' }),
      },
      userRole: { create: jest.fn().mockResolvedValue({ id: 'user_role_1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit_1' }) },
    };
    scoped = {
      tenant: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      case: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      emailMessage: { findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      bookingProposal: { findMany: jest.fn().mockResolvedValue([]) },
      financeTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      approval: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      lead: { findMany: jest.fn().mockResolvedValue([]) },
      opportunity: { findMany: jest.fn().mockResolvedValue([]) },
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      integration: { findMany: jest.fn().mockResolvedValue([]) },
      agentRun: { findMany: jest.fn().mockResolvedValue([]) },
      toolInvocation: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma = {
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
      forTenantId: jest.fn().mockReturnValue(scoped),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(TenantsService);
  });

  it('creates the tenant and seeds all six default roles', async () => {
    await service.bootstrapTenant({
      name: 'Musterwerk GmbH',
      slug: 'musterwerk',
      adminEmail: 'admin@musterwerk.example',
      adminPassword: 'correct horse battery staple',
      adminFirstName: 'Admina',
      adminLastName: 'Musterfrau',
    });

    expect(tx.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Musterwerk GmbH', slug: 'musterwerk' },
    });
    expect(tx.role.create).toHaveBeenCalledTimes(Object.values(ROLES).length);
    for (const roleName of Object.values(ROLES)) {
      expect(tx.role.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant_1', name: roleName, isSystemDefault: true },
      });
    }
  });

  it('grants each role exactly its DEFAULT_ROLE_PERMISSIONS', async () => {
    await service.bootstrapTenant({
      name: 'Musterwerk GmbH',
      slug: 'musterwerk',
      adminEmail: 'admin@musterwerk.example',
      adminPassword: 'correct horse battery staple',
      adminFirstName: 'Admina',
      adminLastName: 'Musterfrau',
    });

    for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (permissions.length === 0) continue;
      expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
        data: permissions.map((permission) => ({ roleId: `role_${roleName}`, permission })),
      });
    }
  });

  it('seeds one PolicyConfig row per POLICY_ACTIONS entry with DEFAULT_POLICY_CONFIG values', async () => {
    await service.bootstrapTenant({
      name: 'Musterwerk GmbH',
      slug: 'musterwerk',
      adminEmail: 'admin@musterwerk.example',
      adminPassword: 'correct horse battery staple',
      adminFirstName: 'Admina',
      adminLastName: 'Musterfrau',
    });

    const call = tx.policyConfig.createMany.mock.calls[0][0];
    expect(call.data).toHaveLength(Object.values(POLICY_ACTIONS).length);
    expect(call.data).toContainEqual({
      tenantId: 'tenant_1',
      action: POLICY_ACTIONS.PAYMENT_EXECUTE,
      mode: DEFAULT_POLICY_CONFIG[POLICY_ACTIONS.PAYMENT_EXECUTE].mode,
      locked: true,
    });
  });

  it('hashes the admin password (never stores it in plaintext) and assigns the TENANT_ADMIN role', async () => {
    await service.bootstrapTenant({
      name: 'Musterwerk GmbH',
      slug: 'musterwerk',
      adminEmail: 'admin@musterwerk.example',
      adminPassword: 'correct horse battery staple',
      adminFirstName: 'Admina',
      adminLastName: 'Musterfrau',
    });

    const userCreateArgs = tx.user.create.mock.calls[0][0];
    expect(userCreateArgs.data.passwordHash).not.toBe('correct horse battery staple');
    expect(typeof userCreateArgs.data.passwordHash).toBe('string');
    expect(userCreateArgs.data.status).toBe('ACTIVE');

    expect(tx.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'user_1', roleId: `role_${ROLES.TENANT_ADMIN}` },
    });
  });

  it('writes a USER_CREATED audit log entry for the bootstrap admin', async () => {
    await service.bootstrapTenant({
      name: 'Musterwerk GmbH',
      slug: 'musterwerk',
      adminEmail: 'admin@musterwerk.example',
      adminPassword: 'correct horse battery staple',
      adminFirstName: 'Admina',
      adminLastName: 'Musterfrau',
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant_1',
        eventType: 'USER_CREATED',
        actorType: 'SYSTEM',
        entityId: 'user_1',
      }),
    });
  });

  describe('exportTenantData', () => {
    it('throws NotFoundError when the tenant does not exist', async () => {
      scoped.tenant.findUnique.mockResolvedValue(null);
      await expect(service.exportTenantData('tenant_1', 'user_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('gathers every tenant-scoped collection into a single export object and records TENANT_DATA_EXPORTED', async () => {
      scoped.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Musterwerk GmbH' });
      scoped.invoice.findMany.mockResolvedValue([{ id: 'inv_1' }]);

      const result = await service.exportTenantData('tenant_1', 'user_1');

      expect(result.tenant).toEqual({ id: 'tenant_1', name: 'Musterwerk GmbH' });
      expect(result.invoices).toEqual([{ id: 'inv_1' }]);
      expect(result.exportedAt).toEqual(expect.any(String));
      expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'TENANT_DATA_EXPORTED', tenantId: 'tenant_1', actorUserId: 'user_1' }),
      );
    });
  });

  describe('requestDeletion', () => {
    it('sets deletionRequestedAt/By and records TENANT_DELETE_REQUESTED', async () => {
      scoped.tenant.update.mockResolvedValue({ id: 'tenant_1', deletionRequestedAt: new Date() });

      await service.requestDeletion('tenant_1', 'user_1');

      expect(scoped.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant_1' },
        data: expect.objectContaining({ deletionRequestedByUserId: 'user_1' }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'TENANT_DELETE_REQUESTED', tenantId: 'tenant_1' }),
      );
    });
  });

  describe('cancelDeletionRequest', () => {
    it('rejects when there is no pending deletion request', async () => {
      scoped.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', deletionRequestedAt: null });
      await expect(service.cancelDeletionRequest('tenant_1', 'user_1')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
    });

    it('clears the deletion-request fields', async () => {
      scoped.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', deletionRequestedAt: new Date() });
      scoped.tenant.update.mockResolvedValue({ id: 'tenant_1', deletionRequestedAt: null });

      await service.cancelDeletionRequest('tenant_1', 'user_1');

      expect(scoped.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant_1' },
        data: { deletionRequestedAt: null, deletionRequestedByUserId: null },
      });
    });
  });

  describe('confirmDeletion', () => {
    it('rejects when there is no pending deletion request', async () => {
      scoped.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', deletionRequestedAt: null });
      await expect(service.confirmDeletion('tenant_1', 'user_1')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
      expect(scoped.tenant.delete).not.toHaveBeenCalled();
    });

    it('deletes the tenant row (cascading through every child table) when a request is pending', async () => {
      scoped.tenant.findUnique.mockResolvedValue({
        id: 'tenant_1',
        name: 'Musterwerk GmbH',
        deletionRequestedAt: new Date(),
        deletionRequestedByUserId: 'user_requester',
      });
      scoped.tenant.delete.mockResolvedValue({ id: 'tenant_1' });

      const result = await service.confirmDeletion('tenant_1', 'user_1');

      expect(scoped.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant_1' } });
      expect(result.tenantId).toBe('tenant_1');
      // The completion fact cannot be written to this tenant's own AuditLog
      // (it was just cascade-deleted) — see the service's own doc comment.
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'TENANT_DELETE_COMPLETED' }),
      );
    });
  });
});
