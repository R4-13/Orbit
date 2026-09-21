import { Test } from '@nestjs/testing';
import { DEFAULT_POLICY_CONFIG, DEFAULT_ROLE_PERMISSIONS, POLICY_ACTIONS, ROLES } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from './tenants.service';

describe('TenantsService.bootstrapTenant', () => {
  let service: TenantsService;
  let tx: {
    tenant: { create: jest.Mock };
    role: { create: jest.Mock };
    rolePermission: { createMany: jest.Mock };
    policyConfig: { createMany: jest.Mock };
    user: { create: jest.Mock };
    userRole: { create: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    tx = {
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
    prisma = { $transaction: jest.fn().mockImplementation((callback) => callback(tx)) };

    const moduleRef = await Test.createTestingModule({
      providers: [TenantsService, { provide: PrismaService, useValue: prisma }],
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
});
