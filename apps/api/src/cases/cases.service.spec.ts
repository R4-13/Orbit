import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CasesService } from './cases.service';

describe('CasesService', () => {
  let service: CasesService;
  let scoped: {
    case: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      case: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CasesService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(CasesService);
  });

  it('create() writes the case and a CASE_CREATED audit event', async () => {
    scoped.case.create.mockResolvedValue({
      id: 'case_1',
      type: 'FINANCE',
      title: 'Rechnung Muster GmbH',
    });

    const result = await service.create('tenant_1', 'user_1', {
      type: 'FINANCE',
      title: 'Rechnung Muster GmbH',
    });

    expect(result.id).toBe('case_1');
    expect(scoped.case.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant_1', type: 'FINANCE', title: 'Rechnung Muster GmbH', description: undefined },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CASE_CREATED', entityId: 'case_1' }),
    );
  });

  it('findOne() throws NotFoundError when the case does not exist in this tenant', async () => {
    scoped.case.findUnique.mockResolvedValue(null);

    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('NOT_FOUND');
  });

  it('updateStatus() updates the case and records the from/to transition', async () => {
    scoped.case.findUnique.mockResolvedValue({ id: 'case_1', status: 'OPEN' });
    scoped.case.update.mockResolvedValue({ id: 'case_1', status: 'IN_PROGRESS' });

    const result = await service.updateStatus('tenant_1', 'case_1', 'user_1', 'IN_PROGRESS');

    expect(result.status).toBe('IN_PROGRESS');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CASE_STATUS_CHANGED',
        payload: { from: 'OPEN', to: 'IN_PROGRESS' },
      }),
    );
  });
});
