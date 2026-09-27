import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { RetentionCategory } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { UpdateRetentionPolicyDto } from './dto/update-retention-policy.dto';
import { RetentionService } from './retention.service';

/**
 * Retention-Grundlage (Unified Evolution Concept) admin surface. Gated by
 * POLICY_MANAGE rather than the SYSTEM_ADMIN-only TENANT_MANAGE: this is a
 * tenant's own data-lifecycle configuration (same admin-reachable
 * sensitivity as agent autonomy policy in PolicyController), not a
 * platform-level tenant operation. See docs/ASSUMPTIONS.md.
 */
@ApiTags('retention')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.POLICY_MANAGE)
@Controller({ path: 'retention-policies' })
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.retentionService.findAll(user.tenantId);
  }

  @Put(':category')
  upsertPolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('category', new ParseEnumPipe(RetentionCategory)) category: RetentionCategory,
    @Body() dto: UpdateRetentionPolicyDto,
  ) {
    return this.retentionService.upsertPolicy(user.tenantId, user.id, category, dto.retentionDays);
  }

  @Get(':category/preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('category', new ParseEnumPipe(RetentionCategory)) category: RetentionCategory,
  ) {
    return this.retentionService.preview(user.tenantId, category);
  }

  @Post(':category/apply')
  @HttpCode(200)
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('category', new ParseEnumPipe(RetentionCategory)) category: RetentionCategory,
  ) {
    return this.retentionService.apply(user.tenantId, user.id, category);
  }
}
