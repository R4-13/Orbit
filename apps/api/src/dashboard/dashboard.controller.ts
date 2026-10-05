import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { DashboardPeriod, DashboardSnapshot, DashboardView } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { isValidTimezone } from './dashboard-time';
import { DashboardService } from './dashboard.service';

const VIEWS: readonly DashboardView[] = ['MINE', 'TEAM'];
const PERIODS: readonly DashboardPeriod[] = ['TODAY', 'WEEK', 'MONTH'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * UI/UX v2 §26.2 — eine einzige, autorisierte Projektion für Home. Es gibt kein eigenes Berechtigungs-Gate: jede Kennzahl
 * und jeder Bereich wird im Dienst nur mit dem jeweiligen Leserecht berechnet, der Rest kommt als `null` zurück.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'dashboard' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('snapshot')
  snapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Query('view', new DefaultValuePipe('MINE')) view: string,
    @Query('period', new DefaultValuePipe('TODAY')) period: string,
    @Query('timezone', new DefaultValuePipe('Europe/Berlin')) timezone: string,
    @Query('attention', new DefaultValuePipe(5), ParseIntPipe) attention: number,
    @Query('inbox', new DefaultValuePipe(5), ParseIntPipe) inbox: number,
    @Query('tasks', new DefaultValuePipe(3), ParseIntPipe) tasks: number,
    @Query('completed', new DefaultValuePipe(3), ParseIntPipe) completed: number,
  ): Promise<DashboardSnapshot> {
    if (!VIEWS.includes(view as DashboardView)) throw new BadRequestException('view muss MINE oder TEAM sein.');
    if (!PERIODS.includes(period as DashboardPeriod)) throw new BadRequestException('period muss TODAY, WEEK oder MONTH sein.');
    if (!isValidTimezone(timezone)) throw new BadRequestException('timezone ist keine gültige IANA-Zeitzone.');
    return this.dashboard.snapshot(
      { tenantId: user.tenantId, userId: user.id, permissions: user.permissions },
      {
        view: view as DashboardView,
        period: period as DashboardPeriod,
        timezone,
        limits: { attention: clamp(attention, 1, 50), inbox: clamp(inbox, 1, 10), tasks: clamp(tasks, 1, 10), completed: clamp(completed, 1, 10) },
      },
    );
  }
}
