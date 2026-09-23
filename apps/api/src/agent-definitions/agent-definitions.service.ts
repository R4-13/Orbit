import { Inject, Injectable } from '@nestjs/common';
import type { ToolRegistry } from '@orbit/agent-core';
import type { AgentDefinition, AgentDefinitionVersion } from '@orbit/domain';
import { Prisma } from '@orbit/domain';
import { NotFoundError, ValidationFailedError } from '@orbit/shared';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AgentBaseTypeDto } from './dto/create-agent-definition.dto';
import type { AgentDefinitionStatusDto } from './dto/update-agent-definition.dto';

/** Postgres unique-violation error code — see webhook-idempotency.service.ts for the same pattern. */
const UNIQUE_VIOLATION = 'P2002';

export interface CreateAgentDefinitionInput {
  key: string;
  name: string;
  description?: string;
  baseType: AgentBaseTypeDto;
  systemPrompt: string;
  allowedTools: string[];
}

export interface UpdateAgentDefinitionInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  status?: AgentDefinitionStatusDto;
  changeNote?: string;
}

/**
 * Admin CRUD for AgentDefinition (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1)
 * — deliberately separate from AgentDefinitionResolverService (the
 * runtime lookup IntakeService uses), same split already established
 * between PolicyConfigService (admin CRUD) and PolicyEnforcementService
 * (runtime hot path) in ../policy/.
 */
@Injectable()
export class AgentDefinitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(TOOL_REGISTRY) private readonly toolRegistry: ToolRegistry,
  ) {}

  /** Catalog of every tool an AgentDefinition could be granted — backs the Studio's tool-selection UI. */
  listTools(): ReturnType<ToolRegistry['describe']> {
    return this.toolRegistry.describe();
  }

  findAll(tenantId: string): Promise<AgentDefinition[]> {
    return this.prisma.forTenantId(tenantId).agentDefinition.findMany({ orderBy: { key: 'asc' } });
  }

  async findOne(tenantId: string, key: string): Promise<AgentDefinition> {
    const found = await this.prisma
      .forTenantId(tenantId)
      .agentDefinition.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!found) {
      throw new NotFoundError('Agent definition not found.', { key });
    }
    return found;
  }

  listVersions(tenantId: string, agentDefinitionId: string): Promise<AgentDefinitionVersion[]> {
    return this.prisma
      .forTenantId(tenantId)
      .agentDefinitionVersion.findMany({ where: { agentDefinitionId }, orderBy: { version: 'desc' } });
  }

  /** Fails fast (before ever hitting the DB) on a tool name the registry doesn't actually know. */
  private assertKnownTools(toolNames: string[]): void {
    const known = new Set(this.toolRegistry.list().map((t) => t.name));
    const unknown = toolNames.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new ValidationFailedError('allowedTools contains unknown tool names.', { unknown });
    }
  }

  async create(tenantId: string, actorUserId: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    this.assertKnownTools(input.allowedTools);

    let created: AgentDefinition;
    try {
      created = await this.prisma.forTenantId(tenantId).agentDefinition.create({
        data: {
          tenantId,
          key: input.key,
          name: input.name,
          description: input.description,
          baseType: input.baseType,
          systemPrompt: input.systemPrompt,
          allowedTools: input.allowedTools,
          status: 'DRAFT',
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        throw new ValidationFailedError('An agent definition with this key already exists.', { key: input.key });
      }
      throw error;
    }

    await this.prisma.forTenantId(tenantId).agentDefinitionVersion.create({
      data: {
        tenantId,
        agentDefinitionId: created.id,
        version: 1,
        systemPrompt: created.systemPrompt,
        allowedTools: created.allowedTools,
        changeNote: 'Initiale Version.',
        changedByUserId: actorUserId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'AGENT_DEFINITION_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'AgentDefinition',
      entityId: created.id,
      payload: { key: created.key, baseType: created.baseType },
    });

    return created;
  }

  /**
   * Any change to prompt/tools/status increments `version` and appends a
   * new AgentDefinitionVersion row rather than updating in place — same
   * append-only audit pattern as PolicyConfigService, so a prompt change
   * can always be rolled back and diffed later.
   */
  async update(
    tenantId: string,
    actorUserId: string,
    key: string,
    input: UpdateAgentDefinitionInput,
  ): Promise<AgentDefinition> {
    const existing = await this.findOne(tenantId, key);

    if (input.allowedTools) {
      this.assertKnownTools(input.allowedTools);
    }

    const nextVersion = existing.version + 1;
    const updated = await this.prisma.forTenantId(tenantId).agentDefinition.update({
      where: { tenantId_key: { tenantId, key } },
      data: {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        systemPrompt: input.systemPrompt ?? existing.systemPrompt,
        allowedTools: input.allowedTools ?? existing.allowedTools,
        status: input.status ?? existing.status,
        version: nextVersion,
        updatedByUserId: actorUserId,
      },
    });

    await this.prisma.forTenantId(tenantId).agentDefinitionVersion.create({
      data: {
        tenantId,
        agentDefinitionId: existing.id,
        version: nextVersion,
        systemPrompt: updated.systemPrompt,
        allowedTools: updated.allowedTools,
        changeNote: input.changeNote,
        changedByUserId: actorUserId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'AGENT_DEFINITION_UPDATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'AgentDefinition',
      entityId: updated.id,
      payload: { key: updated.key, version: nextVersion },
    });

    return updated;
  }

  /**
   * Restores a previous version's prompt/tools as a *new* current version
   * (never deletes or rewrites history) — same "rollback is itself a new,
   * auditable change" principle as the rest of this admin surface.
   */
  async rollback(tenantId: string, actorUserId: string, key: string, targetVersion: number): Promise<AgentDefinition> {
    const existing = await this.findOne(tenantId, key);
    const target = await this.prisma.forTenantId(tenantId).agentDefinitionVersion.findFirst({
      where: { agentDefinitionId: existing.id, version: targetVersion },
    });
    if (!target) {
      throw new NotFoundError('Agent definition version not found.', { key, version: targetVersion });
    }

    const nextVersion = existing.version + 1;
    const updated = await this.prisma.forTenantId(tenantId).agentDefinition.update({
      where: { tenantId_key: { tenantId, key } },
      data: {
        systemPrompt: target.systemPrompt,
        allowedTools: target.allowedTools,
        version: nextVersion,
        updatedByUserId: actorUserId,
      },
    });

    await this.prisma.forTenantId(tenantId).agentDefinitionVersion.create({
      data: {
        tenantId,
        agentDefinitionId: existing.id,
        version: nextVersion,
        systemPrompt: target.systemPrompt,
        allowedTools: target.allowedTools,
        changeNote: `Rollback auf Version ${targetVersion}.`,
        changedByUserId: actorUserId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'AGENT_DEFINITION_ROLLED_BACK',
      actorType: 'USER',
      actorUserId,
      entityType: 'AgentDefinition',
      entityId: updated.id,
      payload: { key: updated.key, restoredFromVersion: targetVersion, newVersion: nextVersion },
    });

    return updated;
  }
}
