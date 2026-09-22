import { Body, Controller, Get, Param, ParseEnumPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, POLICY_ACTIONS, type PolicyActionKey } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { UpdatePolicyModeDto } from './dto/update-policy-mode.dto';
import { PolicyConfigService } from './policy-config.service';

/** §17/§39 — `/admin/policies` backend: lets a tenant see and adjust how autonomously its agents may act, per action. */
@ApiTags('policy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.POLICY_MANAGE)
@Controller({ path: 'policies' })
export class PolicyController {
  constructor(private readonly policyConfigService: PolicyConfigService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.policyConfigService.findAll(user.tenantId);
  }

  @Patch(':action')
  updateMode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('action', new ParseEnumPipe(POLICY_ACTIONS)) action: PolicyActionKey,
    @Body() dto: UpdatePolicyModeDto,
  ) {
    return this.policyConfigService.updateMode(user.tenantId, user.id, action, dto.mode);
  }
}
