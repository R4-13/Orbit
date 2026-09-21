import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { OpportunitiesService } from './opportunities.service';

describe('OpportunitiesService', () => {
  let service: OpportunitiesService;
  let scoped: {
    opportunity: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      opportunity: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpportunitiesService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(OpportunitiesService);
  });

  it('create() defaults currency to EUR and records OPPORTUNITY_CREATED', async () => {
    scoped.opportunity.create.mockResolvedValue({ id: 'opp_1', name: 'Neuausstattung Büro' });

    await service.create('tenant_1', 'user_1', { name: 'Neuausstattung Büro' });

    expect(scoped.opportunity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Neuausstattung Büro', currency: 'EUR' }),
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'OPPORTUNITY_CREATED' }));
  });

  it('findOne() throws NotFoundError for a missing opportunity', async () => {
    scoped.opportunity.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
  });

  it('updateStage() records the from/to transition', async () => {
    scoped.opportunity.findUnique.mockResolvedValue({ id: 'opp_1', stage: 'NEW' });
    scoped.opportunity.update.mockResolvedValue({ id: 'opp_1', stage: 'QUALIFICATION' });

    const result = await service.updateStage('tenant_1', 'user_1', 'opp_1', 'QUALIFICATION');

    expect(result.stage).toBe('QUALIFICATION');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OPPORTUNITY_UPDATED', payload: { from: 'NEW', to: 'QUALIFICATION' } }),
    );
  });
});
