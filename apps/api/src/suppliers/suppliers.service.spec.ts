import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { FINANCE_CONNECTOR } from '../connectors/connectors.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let scoped: {
    supplier: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let policy: { decide: jest.Mock };
  let financeConnector: { createSupplier: jest.Mock };

  beforeEach(async () => {
    scoped = {
      supplier: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    policy = { decide: jest.fn() };
    financeConnector = { createSupplier: jest.fn().mockResolvedValue({ externalId: 'mock-supplier-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
        { provide: PolicyEnforcementService, useValue: policy },
        { provide: FINANCE_CONNECTOR, useValue: financeConnector },
      ],
    }).compile();

    service = moduleRef.get(SuppliersService);
  });

  it('findOrCreate() returns the existing supplier by taxId without creating anything', async () => {
    scoped.supplier.findFirst.mockResolvedValueOnce({ id: 'sup_1', name: 'Muster GmbH' });

    const result = await service.findOrCreate('tenant_1', 'user_1', {
      name: 'Muster GmbH',
      taxId: 'DE123',
    });

    expect(result).toEqual({ supplier: { id: 'sup_1', name: 'Muster GmbH' }, created: false });
    expect(scoped.supplier.create).not.toHaveBeenCalled();
  });

  it('findOrCreate() with policy DENY throws PolicyViolationError and creates nothing', async () => {
    policy.decide.mockResolvedValue('DENY');

    let caught: unknown;
    try {
      await service.findOrCreate('tenant_1', 'user_1', { name: 'Neu GmbH' });
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('POLICY_VIOLATION');
    expect(scoped.supplier.create).not.toHaveBeenCalled();
  });

  it('findOrCreate() with policy ALLOW creates an ACTIVE supplier and registers it with the FiBu connector', async () => {
    policy.decide.mockResolvedValue('ALLOW');
    scoped.supplier.create.mockResolvedValue({ id: 'sup_new', name: 'Neu GmbH', status: 'ACTIVE' });

    const result = await service.findOrCreate('tenant_1', 'user_1', { name: 'Neu GmbH' });

    expect(financeConnector.createSupplier).toHaveBeenCalled();
    expect(scoped.supplier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'ACTIVE', externalFinanceId: 'mock-supplier-1' }),
    });
    expect(result.created).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SUPPLIER_CREATED' }));
  });

  it('findOrCreate() with policy REQUIRE_APPROVAL creates a PENDING_APPROVAL supplier without calling the connector', async () => {
    policy.decide.mockResolvedValue('REQUIRE_APPROVAL');
    scoped.supplier.create.mockResolvedValue({ id: 'sup_pending', name: 'Neu GmbH', status: 'PENDING_APPROVAL' });

    const result = await service.findOrCreate('tenant_1', 'user_1', { name: 'Neu GmbH' });

    expect(financeConnector.createSupplier).not.toHaveBeenCalled();
    expect(scoped.supplier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PENDING_APPROVAL' }),
    });
    expect(result.created).toBe(true);
  });

  it('approve() rejects a supplier that is not PENDING_APPROVAL', async () => {
    scoped.supplier.findUnique.mockResolvedValue({ id: 'sup_1', status: 'ACTIVE' });

    await expect(service.approve('tenant_1', 'sup_1', 'user_1')).rejects.toMatchObject({
      code: 'POLICY_VIOLATION',
    });
  });

  it('approve() activates a pending supplier and registers it with the FiBu connector', async () => {
    scoped.supplier.findUnique.mockResolvedValue({
      id: 'sup_1',
      name: 'Neu GmbH',
      status: 'PENDING_APPROVAL',
      taxId: null,
      vatId: null,
      iban: null,
      bic: null,
      email: null,
    });
    scoped.supplier.update.mockResolvedValue({ id: 'sup_1', status: 'ACTIVE' });

    const result = await service.approve('tenant_1', 'sup_1', 'user_1');

    expect(financeConnector.createSupplier).toHaveBeenCalled();
    expect(result.status).toBe('ACTIVE');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'APPROVAL_GRANTED' }));
  });

  it('reject() blocks a pending supplier without calling the connector', async () => {
    scoped.supplier.findUnique.mockResolvedValue({ id: 'sup_1', status: 'PENDING_APPROVAL' });
    scoped.supplier.update.mockResolvedValue({ id: 'sup_1', status: 'BLOCKED' });

    const result = await service.reject('tenant_1', 'sup_1', 'user_1');

    expect(financeConnector.createSupplier).not.toHaveBeenCalled();
    expect(result.status).toBe('BLOCKED');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'APPROVAL_REJECTED' }));
  });
});
