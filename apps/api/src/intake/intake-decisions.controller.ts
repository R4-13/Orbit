import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
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
  constructor(private readonly decisions: IntakeDecisionsService) {}

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
