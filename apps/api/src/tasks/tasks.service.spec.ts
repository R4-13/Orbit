import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;
  let scoped: {
    task: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      task: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(TasksService);
  });

  it('create() defaults source to USER and records TASK_CREATED', async () => {
    scoped.task.create.mockResolvedValue({ id: 'task_1', title: 'Rückruf vereinbaren', caseId: undefined });

    await service.create('tenant_1', 'user_1', { title: 'Rückruf vereinbaren' });

    expect(scoped.task.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant_1',
        caseId: undefined,
        title: 'Rückruf vereinbaren',
        description: undefined,
        dueDate: undefined,
        source: 'USER',
      },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'TASK_CREATED' }));
  });

  it('findOne() throws NotFoundError for a missing task', async () => {
    scoped.task.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
  });

  it('complete() sets status DONE and records TASK_COMPLETED', async () => {
    scoped.task.findUnique.mockResolvedValue({ id: 'task_1', status: 'OPEN' });
    scoped.task.update.mockResolvedValue({ id: 'task_1', status: 'DONE' });

    const result = await service.complete('tenant_1', 'task_1', 'user_1');

    expect(result.status).toBe('DONE');
    expect(scoped.task.update).toHaveBeenCalledWith({ where: { id: 'task_1' }, data: { status: 'DONE' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'TASK_COMPLETED' }));
  });
});
