import { Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { FollowUpResumeService } from './follow-up-resume.service';

/**
 * The "owning entity" endpoint for `entityType: 'FOLLOW_UP'` approvals
 * (docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md, "Durable Workflow +
 * Approval Resume") — same pattern as `SuppliersController`'s/
 * `InvoicesController`'s own `:id/approve` routes. `APPROVAL_DECIDE`
 * (packages/shared/src/permissions.ts) existed since Phase 3 but was
 * never actually used to gate any endpoint until now.
 */
@ApiTags('follow-ups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.APPROVAL_DECIDE)
@Controller({ path: 'follow-ups' })
export class FollowUpsController {
  constructor(private readonly resumeService: FollowUpResumeService) {}

  @Patch(':approvalId/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('approvalId') approvalId: string) {
    return this.resumeService.approve(user.tenantId, user.id, approvalId);
  }

  @Patch(':approvalId/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('approvalId') approvalId: string) {
    return this.resumeService.reject(user.tenantId, user.id, approvalId);
  }
}
