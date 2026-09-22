import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import type { AgentRun, AgentType, ToolInvocation } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { AgentRunRecorderService } from './agent-run-recorder.service';

/**
 * Read-only view onto AgentRun/ToolInvocation (§10, §38 Activity-Feed) —
 * like DocumentsController, AgentRuns have no dedicated permission and
 * piggyback on CASE_READ since every run is either scoped to a Case or
 * inspectable by the same audience that can read Cases.
 */
@ApiTags('agent-runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'agent-runs' })
export class AgentRunsController {
  constructor(private readonly recorder: AgentRunRecorderService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('agentType') agentType?: AgentType,
    @Query('caseId') caseId?: string,
  ): Promise<Array<AgentRun & { toolInvocations: ToolInvocation[] }>> {
    return this.recorder.findAll(user.tenantId, { agentType, caseId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AgentRun & { toolInvocations: ToolInvocation[] }> {
    return this.recorder.findOne(user.tenantId, id);
  }
}
