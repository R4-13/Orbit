import { BadRequestException, Controller, DefaultValuePipe, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type ApprovalDetail, type ApprovalQueueItem } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ApprovalPresenterService } from './approval-presenter.service';
import { ApprovalsService } from './approvals.service';
import { QueryApprovalsDto } from './dto/query-approvals.dto';

@ApiTags('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.APPROVAL_READ)
@Controller({ path: 'approvals' })
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly presenter: ApprovalPresenterService,
  ) {}

  /** UI v2 §14.1: „Meine offenen Freigaben“ (Standard) bzw. Team/alle zugänglichen, angereichert um Aktion, Objekt, Betrag und Risiko. */
  @Get('queue')
  queue(@CurrentUser() user: AuthenticatedUser, @Query('scope', new DefaultValuePipe('MINE')) scope: string): Promise<ApprovalQueueItem[]> {
    if (scope !== 'MINE' && scope !== 'TEAM') throw new BadRequestException('scope muss MINE oder TEAM sein.');
    return this.presenter.queue(user.tenantId, user.permissions, scope);
  }

  /** UI v2 §14.2: Entscheidungsdetail – was, für wen, mit welchen Daten, in welches System, warum, was danach. */
  @Get(':id/detail')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ApprovalDetail> {
    return this.presenter.detail(user.tenantId, user.permissions, id);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryApprovalsDto) {
    return this.approvalsService.findAll(user.tenantId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.approvalsService.findOne(user.tenantId, id);
  }
}
