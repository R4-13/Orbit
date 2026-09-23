import { Test } from '@nestjs/testing';
import { Prisma } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
}

describe('WorkflowDefinitionsService', () => {
  let service: WorkflowDefinitionsService;
  let scoped: {
    workflowDefinition: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    workflowStepDefinition: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      workflowDefinition: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      workflowStepDefinition: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowDefinitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(WorkflowDefinitionsService);
  });

  describe('findOne', () => {
    it('throws NotFoundError when no row matches', async () => {
      scoped.workflowDefinition.findUnique.mockResolvedValue(null);
      await expect(service.findOne('tenant_1', 'does-not-exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('create', () => {
    const validSteps = [
      { order: 1, agentDefinitionKey: 'communication-intake' },
      { order: 2, agentDefinitionKey: 'sales-intake', condition: { field: '$.steps[1].output.classify_message.category', equals: 'SALES' } },
    ];

    it('rejects step orders with a gap', async () => {
      await expect(
        service.create('tenant_1', 'user_1', {
          key: 'wf-1',
          name: 'WF',
          triggerType: 'MANUAL',
          steps: [{ order: 1, agentDefinitionKey: 'a' }, { order: 3, agentDefinitionKey: 'b' }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(scoped.workflowDefinition.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate step orders', async () => {
      await expect(
        service.create('tenant_1', 'user_1', {
          key: 'wf-1',
          name: 'WF',
          triggerType: 'MANUAL',
          steps: [{ order: 1, agentDefinitionKey: 'a' }, { order: 1, agentDefinitionKey: 'b' }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('creates the definition as DRAFT with nested steps and records WORKFLOW_DEFINITION_CREATED', async () => {
      scoped.workflowDefinition.create.mockResolvedValue({ id: 'wfd_1', key: 'wf-1' });
      scoped.workflowDefinition.findUnique.mockResolvedValue({ id: 'wfd_1', key: 'wf-1', steps: validSteps });

      const result = await service.create('tenant_1', 'user_1', { key: 'wf-1', name: 'WF', triggerType: 'MANUAL', steps: validSteps });

      expect(scoped.workflowDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant_1',
            key: 'wf-1',
            status: 'DRAFT',
            steps: { create: expect.arrayContaining([expect.objectContaining({ tenantId: 'tenant_1', order: 1 })]) },
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'WORKFLOW_DEFINITION_CREATED' }));
      expect(result.key).toBe('wf-1');
    });

    it('translates a duplicate key into ValidationFailedError', async () => {
      scoped.workflowDefinition.create.mockRejectedValue(uniqueViolation());
      await expect(
        service.create('tenant_1', 'user_1', { key: 'wf-1', name: 'WF', triggerType: 'MANUAL', steps: validSteps }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('update', () => {
    it('replaces the step list via sequential forTenantId() calls (deleteMany then createMany), not a raw $transaction', async () => {
      scoped.workflowDefinition.findUnique.mockResolvedValueOnce({ id: 'wfd_1', key: 'wf-1', name: 'WF', description: null, status: 'DRAFT' });
      scoped.workflowDefinition.findUnique.mockResolvedValueOnce({ id: 'wfd_1', key: 'wf-1', steps: [] });

      await service.update('tenant_1', 'user_1', 'wf-1', {
        steps: [{ order: 1, agentDefinitionKey: 'communication-intake' }],
      });

      expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
      expect(scoped.workflowStepDefinition.deleteMany).toHaveBeenCalledWith({ where: { workflowDefinitionId: 'wfd_1' } });
      expect(scoped.workflowStepDefinition.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ tenantId: 'tenant_1', workflowDefinitionId: 'wfd_1', order: 1 })],
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'WORKFLOW_DEFINITION_UPDATED' }));
    });

    it('does not touch steps when none are provided', async () => {
      scoped.workflowDefinition.findUnique.mockResolvedValueOnce({ id: 'wfd_1', key: 'wf-1', name: 'WF', description: null, status: 'DRAFT' });
      scoped.workflowDefinition.findUnique.mockResolvedValueOnce({ id: 'wfd_1', key: 'wf-1', steps: [] });

      await service.update('tenant_1', 'user_1', 'wf-1', { status: 'ACTIVE' });

      expect(scoped.workflowStepDefinition.deleteMany).not.toHaveBeenCalled();
      expect(scoped.workflowStepDefinition.createMany).not.toHaveBeenCalled();
      expect(scoped.workflowDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
      );
    });
  });
});
