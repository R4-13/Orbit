import { Body, Controller, Get, Param, ParseIntPipe, Post, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { AgentDefinitionsService } from './agent-definitions.service';
import { CreateAgentDefinitionDto } from './dto/create-agent-definition.dto';
import { UpdateAgentDefinitionDto } from './dto/update-agent-definition.dto';

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1/2 — Agenten-Konfiguration und
 * Agent Studio share this one CRUD surface (creating a new agent is just
 * `POST` with `status` starting at DRAFT; there is no separate "Studio"
 * backend, see the concept doc's own reasoning). Gated on AGENT_MANAGE,
 * same TENANT_ADMIN-reachable sensitivity as POLICY_MANAGE.
 */
@ApiTags('agent-definitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.AGENT_MANAGE)
@Controller({ path: 'agent-definitions' })
export class AgentDefinitionsController {
  constructor(private readonly agentDefinitions: AgentDefinitionsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.agentDefinitions.findAll(user.tenantId);
  }

  @Get(':key')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.agentDefinitions.findOne(user.tenantId, key);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAgentDefinitionDto) {
    return this.agentDefinitions.create(user.tenantId, user.id, dto);
  }

  @Patch(':key')
  update(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() dto: UpdateAgentDefinitionDto) {
    return this.agentDefinitions.update(user.tenantId, user.id, key, dto);
  }

  @Get(':key/versions')
  async listVersions(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    const definition = await this.agentDefinitions.findOne(user.tenantId, key);
    return this.agentDefinitions.listVersions(user.tenantId, definition.id);
  }

  @Post(':key/rollback/:version')
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.agentDefinitions.rollback(user.tenantId, user.id, key, version);
  }
}

/** GET /tools — the capability catalog Agent Studio's tool-selection UI reads from. Same permission gate; not worth a separate controller/module. */
@ApiTags('agent-definitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.AGENT_MANAGE)
@Controller({ path: 'tools' })
export class ToolsController {
  constructor(private readonly agentDefinitions: AgentDefinitionsService) {}

  @Get()
  list() {
    return this.agentDefinitions.listTools();
  }
}
