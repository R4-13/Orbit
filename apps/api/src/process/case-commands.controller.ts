import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CaseCommandsService, type CommandResult } from './case-commands.service';

/**
 * `POST /cases/:id/commands` — the only way a person changes the course of a case (Amendment 02 §21.2).
 * The body IS the command envelope (`commandId`, `type`, `expectedCaseRevision`, `payload`); tenant and user come from
 * the authenticated token, never from the body. Per-command permissions are enforced in the service.
 */
@ApiTags('case-commands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CASE_READ)
@Controller({ path: 'cases' })
export class CaseCommandsController {
  constructor(private readonly commands: CaseCommandsService) {}

  @Post(':id/commands')
  @HttpCode(HttpStatus.OK)
  execute(@CurrentUser() user: AuthenticatedUser, @Param('id') caseId: string, @Body() body: Record<string, unknown>): Promise<CommandResult> {
    return this.commands.execute({ id: user.id, tenantId: user.tenantId, permissions: user.permissions }, caseId, body);
  }
}
