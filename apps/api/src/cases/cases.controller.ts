import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CASE_SORT_KEYS, PERMISSIONS, parseSortDirection, type CaseListFilter, type CaseListItem, type CaseListResponse, type CaseSortKey } from '@orbit/shared';
import type { Case } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CasesOverviewService } from './cases-overview.service';
import { CasesService } from './cases.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { QueryCasesDto } from './dto/query-cases.dto';
import { UpdateCaseStatusDto } from './dto/update-case-status.dto';

@ApiTags('cases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'cases' })
export class CasesController {
  constructor(
    private readonly casesService: CasesService,
    private readonly overview: CasesOverviewService,
  ) {}

  /** UI v2 §16.1: die Vorgangsübersicht (Standard „Offene Vorgänge“) – vor `:id`, damit der Pfad nicht als ID gelesen wird. */
  @Get('overview')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('filter', new DefaultValuePipe('OPEN')) filter: string,
    @Query('type') type: string | undefined,
    @Query('q', new DefaultValuePipe('')) q: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ): Promise<CaseListResponse> {
    if (!['OPEN', 'ATTENTION', 'DONE', 'ALL'].includes(filter)) throw new BadRequestException('Unbekannter Filter.');
    if (type !== undefined && type !== 'FINANCE' && type !== 'SALES') throw new BadRequestException('type muss FINANCE oder SALES sein.');
    if (sort !== undefined && !(CASE_SORT_KEYS as readonly string[]).includes(sort)) throw new BadRequestException(`sort muss einer von ${CASE_SORT_KEYS.join(', ')} sein.`);
    return this.overview.list(user.tenantId, { filter: filter as CaseListFilter, type: type as 'FINANCE' | 'SALES' | undefined, page, search: q, sort: sort as CaseSortKey | undefined, dir: parseSortDirection(dir) });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCaseDto): Promise<Case> {
    return this.casesService.create(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCasesDto): Promise<Case[]> {
    return this.casesService.findAll(user.tenantId, query);
  }

  /** Kurzfassung für die Vorschau (UI v2 §9.3): Status, nächster Schritt, Gegenüber, Verantwortlicher. */
  @Get(':id/summary')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  summary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CaseListItem> {
    return this.overview.summary(user.tenantId, id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Case> {
    return this.casesService.findOne(user.tenantId, id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCaseStatusDto,
  ): Promise<Case> {
    return this.casesService.updateStatus(user.tenantId, id, user.id, dto.status);
  }
}
