import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Task, TaskSource, TaskStatus } from '@orbit/domain';
import { AuditService, type AuditActorType } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateTaskInput {
  caseId?: string;
  title: string;
  description?: string;
  dueDate?: string;
}

export interface QueryTasksInput {
  status?: TaskStatus;
  caseId?: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string | undefined,
    input: CreateTaskInput,
    actorType: AuditActorType = 'USER',
    source: TaskSource = 'USER',
  ): Promise<Task> {
    const created = await this.prisma.forTenantId(tenantId).task.create({
      data: {
        tenantId,
        caseId: input.caseId,
        title: input.title,
        description: input.description,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        source,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TASK_CREATED',
      actorType,
      actorUserId,
      entityType: 'Task',
      entityId: created.id,
      payload: { title: created.title, caseId: created.caseId },
    });

    return created;
  }

  findAll(tenantId: string, query: QueryTasksInput): Promise<Task[]> {
    return this.prisma.forTenantId(tenantId).task.findMany({
      where: { status: query.status, caseId: query.caseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Task> {
    const found = await this.prisma.forTenantId(tenantId).task.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Task not found.', { id });
    }
    return found;
  }

  async complete(tenantId: string, id: string, actorUserId: string): Promise<Task> {
    await this.findOne(tenantId, id);

    const updated = await this.prisma.forTenantId(tenantId).task.update({
      where: { id },
      data: { status: 'DONE' },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TASK_COMPLETED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Task',
      entityId: id,
    });

    return updated;
  }
}
