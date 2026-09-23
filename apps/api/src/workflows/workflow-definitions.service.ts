import { Injectable } from '@nestjs/common';
import type { AgentRunTriggerType, WorkflowDefinition, WorkflowDefinitionStatus, WorkflowStepDefinition } from '@orbit/domain';
import { NotFoundError, ValidationFailedError } from '@orbit/shared';
import { Prisma } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { WorkflowStepDto } from './dto/workflow-step.dto';

/** Postgres unique-violation error code — same pattern as AgentDefinitionsService/WebhookIdempotencyService. */
const UNIQUE_VIOLATION = 'P2002';

export type WorkflowDefinitionWithSteps = WorkflowDefinition & { steps: WorkflowStepDefinition[] };

export interface CreateWorkflowDefinitionInput {
  key: string;
  name: string;
  description?: string;
  triggerType: AgentRunTriggerType;
  steps: WorkflowStepDto[];
}

export interface UpdateWorkflowDefinitionInput {
  name?: string;
  description?: string;
  steps?: WorkflowStepDto[];
  status?: WorkflowDefinitionStatus;
}

/**
 * Admin CRUD for WorkflowDefinition/WorkflowStepDefinition
 * (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3) — the definition side, not
 * execution (see WorkflowRunnerService for that). No version history here
 * unlike AgentDefinitionsService: the concept doc only proposed
 * versioning for agent prompts/tools, not for workflow step lists — an
 * edit here simply replaces the step list (delete + recreate inside one
 * transaction, since steps have no independent identity worth preserving
 * across edits).
 */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string): Promise<WorkflowDefinitionWithSteps[]> {
    return this.prisma.forTenantId(tenantId).workflowDefinition.findMany({
      orderBy: { key: 'asc' },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async findOne(tenantId: string, key: string): Promise<WorkflowDefinitionWithSteps> {
    const found = await this.prisma.forTenantId(tenantId).workflowDefinition.findUnique({
      where: { tenantId_key: { tenantId, key } },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!found) {
      throw new NotFoundError('Workflow definition not found.', { key });
    }
    return found;
  }

  /** `order` must be unique and gap-free (1..N) — no structural reason for gaps, and it keeps step references in inputMapping/condition paths ("$.steps[N]...") predictable. */
  private assertValidStepOrders(steps: WorkflowStepDto[]): void {
    const orders = steps.map((s) => s.order).sort((a, b) => a - b);
    const expected = Array.from({ length: steps.length }, (_, i) => i + 1);
    if (JSON.stringify(orders) !== JSON.stringify(expected)) {
      throw new ValidationFailedError('Step orders must be exactly 1..N with no gaps or duplicates.', { orders });
    }
  }

  async create(tenantId: string, actorUserId: string, input: CreateWorkflowDefinitionInput): Promise<WorkflowDefinitionWithSteps> {
    this.assertValidStepOrders(input.steps);

    let created: WorkflowDefinition;
    try {
      created = await this.prisma.forTenantId(tenantId).workflowDefinition.create({
        data: {
          tenantId,
          key: input.key,
          name: input.name,
          description: input.description,
          triggerType: input.triggerType,
          status: 'DRAFT',
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          steps: {
            create: input.steps.map((step) => ({
              tenantId,
              order: step.order,
              agentDefinitionKey: step.agentDefinitionKey,
              inputMapping: step.inputMapping as Prisma.InputJsonValue | undefined,
              condition: step.condition as Prisma.InputJsonValue | undefined,
            })),
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        throw new ValidationFailedError('A workflow definition with this key already exists.', { key: input.key });
      }
      throw error;
    }

    await this.audit.record({
      tenantId,
      eventType: 'WORKFLOW_DEFINITION_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'WorkflowDefinition',
      entityId: created.id,
      payload: { key: created.key, steps: input.steps.length },
    });

    return this.findOne(tenantId, created.key);
  }

  /**
   * Deliberately sequential `forTenantId()` calls, not wrapped in a raw
   * `this.prisma.$transaction()` — `forTenant()`'s extension
   * (packages/domain/src/tenant-scope.ts) sets the Postgres RLS
   * `app.tenant_id` GUC inside its *own* per-operation transaction; a
   * caller-controlled `$transaction()` around several `tx.<model>.*`
   * calls would run against the raw, unscoped client with no GUC set at
   * all, silently no-op'ing the delete and failing the insert's `WITH
   * CHECK` policy. Same reasoning as every other multi-step write in this
   * codebase (e.g. AgentDefinitionsService.update()) — the tradeoff is
   * losing cross-call atomicity (a crash between delete and recreate
   * would leave zero steps), accepted here as consistent with the rest
   * of the app rather than a special case for this one service.
   */
  async update(tenantId: string, actorUserId: string, key: string, input: UpdateWorkflowDefinitionInput): Promise<WorkflowDefinitionWithSteps> {
    const existing = await this.findOne(tenantId, key);

    if (input.steps) {
      this.assertValidStepOrders(input.steps);
    }

    await this.prisma.forTenantId(tenantId).workflowDefinition.update({
      where: { tenantId_key: { tenantId, key } },
      data: {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        updatedByUserId: actorUserId,
      },
    });

    if (input.steps) {
      await this.prisma.forTenantId(tenantId).workflowStepDefinition.deleteMany({
        where: { workflowDefinitionId: existing.id },
      });
      await this.prisma.forTenantId(tenantId).workflowStepDefinition.createMany({
        data: input.steps.map((step) => ({
          tenantId,
          workflowDefinitionId: existing.id,
          order: step.order,
          agentDefinitionKey: step.agentDefinitionKey,
          inputMapping: step.inputMapping as Prisma.InputJsonValue | undefined,
          condition: step.condition as Prisma.InputJsonValue | undefined,
        })),
      });
    }

    await this.audit.record({
      tenantId,
      eventType: 'WORKFLOW_DEFINITION_UPDATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'WorkflowDefinition',
      entityId: existing.id,
      payload: { key },
    });

    return this.findOne(tenantId, key);
  }
}
