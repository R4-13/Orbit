import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { CRM_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from './companies.service';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let scoped: { company: { findFirst: jest.Mock; create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock } };
  let audit: { record: jest.Mock };
  let crmConnector: { upsertCompany: jest.Mock };

  beforeEach(async () => {
    scoped = {
      company: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    crmConnector = { upsertCompany: jest.fn().mockResolvedValue({ externalId: 'mock-company-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
        { provide: CRM_CONNECTOR, useValue: crmConnector },
      ],
    }).compile();

    service = moduleRef.get(CompaniesService);
  });

  it('upsert() returns the existing company by domain without creating anything', async () => {
    scoped.company.findFirst.mockResolvedValue({ id: 'co_1', domain: 'muster.example' });

    const result = await service.upsert('tenant_1', 'user_1', { name: 'Muster GmbH', domain: 'muster.example' });

    expect(result).toEqual({ id: 'co_1', domain: 'muster.example' });
    expect(scoped.company.create).not.toHaveBeenCalled();
  });

  it('upsert() creates a new company and syncs it with the CRM connector', async () => {
    scoped.company.create.mockResolvedValue({ id: 'co_new', name: 'Neu GmbH' });

    const result = await service.upsert('tenant_1', 'user_1', { name: 'Neu GmbH', domain: 'neu.example' });

    expect(crmConnector.upsertCompany).toHaveBeenCalledWith({ name: 'Neu GmbH', domain: 'neu.example' });
    expect(scoped.company.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ crmExternalId: 'mock-company-1' }),
    });
    expect(result.id).toBe('co_new');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'COMPANY_CREATED' }));
  });

  it('findOne() throws NotFoundError for a missing company', async () => {
    scoped.company.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
  });
});
