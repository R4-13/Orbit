import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { TriggerWorkflowDto } from './dto/trigger-workflow.dto';
import { UpdateWorkflowDefinitionDto } from './dto/update-workflow-definition.dto';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowRunnerService } from './workflow-runner.service';

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3 — Definition (CRUD) und
 * Ausführung (trigger/runs) bewusst im selben Controller, anders als die
 * AgentDefinition/Policy-Trennung (Config vs. Enforcement) — hier gibt es
 * keinen "heißen Pfad", den ein Admin-Concern verunreinigen könnte: ein
 * Trigger ist selbst schon eine seltene, menschlich ausgelöste Aktion,
 * kein Tool-Aufruf mitten in einem Agent-Turn. Gated über dieselbe
 * AGENT_MANAGE-Permission wie Agenten-Konfiguration, um keine weitere,
 * kaum unterscheidbare Berechtigung einzuführen (siehe
 * docs/ASSUMPTIONS.md Phase 21).
 */
@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.AGENT_MANAGE)
@Controller({ path: 'workflow-definitions' })
export class WorkflowDefinitionsController {
  constructor(
    private readonly workflowDefinitions: WorkflowDefinitionsService,
    private readonly runner: WorkflowRunnerService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.workflowDefinitions.findAll(user.tenantId);
  }

  @Get(':key')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.workflowDefinitions.findOne(user.tenantId, key);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkflowDefinitionDto) {
    return this.workflowDefinitions.create(user.tenantId, user.id, dto);
  }

  @Patch(':key')
  update(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() dto: UpdateWorkflowDefinitionDto) {
    return this.workflowDefinitions.update(user.tenantId, user.id, key, dto);
  }

  @Post(':key/trigger')
  trigger(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() dto: TriggerWorkflowDto) {
    return this.runner.trigger(user.tenantId, user.id, key, dto.input);
  }

  @Get(':key/runs')
  listRuns(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string): ReturnType<WorkflowRunnerService['listRuns']> {
    return this.runner.listRuns(user.tenantId, key);
  }
}
