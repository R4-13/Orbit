import { BadRequestException, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type InboxDetail, type InboxFilter, type InboxListResponse } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { InboxService } from './inbox.service';

const FILTERS: readonly InboxFilter[] = ['ALL', 'ATTENTION', 'NEW', 'IN_PROGRESS', 'DONE', 'FINANCE', 'SALES'];

/** UI v2 §11: der Posteingang als Arbeitsliste. Lesen braucht `email.read`; die Sicht auf ausgefilterte Eingänge zusätzlich `case.read`. */
@ApiTags('inbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'inbox' })
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('items')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('filter', new DefaultValuePipe('ALL')) filter: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('q', new DefaultValuePipe('')) q: string,
    @Query('excluded') excluded?: string,
  ): Promise<InboxListResponse> {
    if (!FILTERS.includes(filter as InboxFilter)) throw new BadRequestException('Unbekannter Filter.');
    // Ausgefilterte Eingänge einzublenden ist eine Reviewer-/Admin-Sicht (§11.2).
    const canSeeExcluded = user.permissions.includes(PERMISSIONS.CASE_READ);
    const includeExcluded = excluded === 'true' ? canSeeExcluded : excluded === 'false' ? false : undefined;
    return this.inbox.list(user.tenantId, { filter: filter as InboxFilter, page, search: q, includeExcluded });
  }

  @Get('items/:id')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<InboxDetail> {
    return this.inbox.findOne(user.tenantId, id);
  }
}
