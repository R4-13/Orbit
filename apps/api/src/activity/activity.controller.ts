import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type ActivityFeed } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ActivityService } from './activity.service';

const AREAS = ['ALL', 'FINANCE', 'SALES'] as const;

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CASE_READ)
@Controller({ path: 'activity' })
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('feed')
  feed(
    @CurrentUser() user: AuthenticatedUser,
    @Query('area', new DefaultValuePipe('ALL')) area: string,
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
    @Query('results', new DefaultValuePipe('true')) results: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('caseId') caseId?: string,
  ): Promise<ActivityFeed> {
    if (!(AREAS as readonly string[]).includes(area)) throw new BadRequestException('area muss ALL, FINANCE oder SALES sein.');
    return this.activity.feed(user.tenantId, {
      area: area as (typeof AREAS)[number],
      days: Math.min(90, Math.max(1, days)),
      resultsOnly: results !== 'false',
      page,
      caseId,
    });
  }
}
