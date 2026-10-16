import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { InterventionsService, type InterventionReportResponse } from './interventions.service';

/** AUT-11: Auswertung „Wo greifen Menschen ein?“ – nur lesend, nur für Personen mit Leserecht auf das Protokoll. */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.AUDIT_READ)
@Controller({ path: 'reports' })
export class ReportsController {
  constructor(private readonly interventions: InterventionsService) {}

  @Get('interventions')
  report(@CurrentUser() user: AuthenticatedUser, @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number): Promise<InterventionReportResponse> {
    if (days < 1 || days > 365) throw new BadRequestException('days muss zwischen 1 und 365 liegen.');
    return this.interventions.report(user.tenantId, days);
  }
}
