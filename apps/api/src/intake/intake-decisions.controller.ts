import { Body, Controller, Inject, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { OrbitEnv } from '@orbit/config';
import { PERMISSIONS } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ReviewIntakeDecisionDto } from './dto/review-intake-decision.dto';
import { IntakeDecisionsService } from './intake-decisions.service';

const ViewEnum = { EXCLUDED: 'EXCLUDED', REVIEW: 'REVIEW', PENDING: 'PENDING', ALL: 'ALL' } as const;
type View = (typeof ViewEnum)[keyof typeof ViewEnum];

/** Amendment 02 §21.2: `GET /intake-decisions`, `POST /intake-decisions/{id}/review`. Reading needs `case.read`; correcting an exclusion needs `case.manage`. */
@ApiTags('intake-decisions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'intake-decisions' })
export class IntakeDecisionsController {
  constructor(
    private readonly decisions: IntakeDecisionsService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /** Whether the "Kein Geschäftsprozess ausgelöst" view is shown by default (test operation) or only as an explicit filter (production). */
  @Get('visibility')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  visibility(): { showExcludedByDefault: boolean; testOperation: boolean } {
    const configured = this.env.UI_SHOW_EXCLUDED_INTAKE;
    const showExcludedByDefault = configured ? configured === 'true' : process.env.NODE_ENV !== 'production';
    // Reply simulation (and similar test helpers) are offered only in test operation: simulated mail transport or an explicitly test-visible setup.
    return { showExcludedByDefault, testOperation: this.env.OUTBOUND_MAIL_MODE === 'simulated' || process.env.NODE_ENV !== 'production' };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CASE_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('view', new DefaultValuePipe('ALL'), new ParseEnumPipe(ViewEnum)) view: View,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.decisions.list(user.tenantId, view, limit);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.decisions.findOne(user.tenantId, id);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  review(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewIntakeDecisionDto) {
    return this.decisions.review(user.tenantId, user.id, id, dto.note);
  }
}
