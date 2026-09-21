import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CasesService } from './cases.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { QueryCasesDto } from './dto/query-cases.dto';
import { UpdateCaseStatusDto } from './dto/update-case-status.dto';

@ApiTags('cases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'cases' })
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCaseDto) {
    return this.casesService.create(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCasesDto) {
    return this.casesService.findAll(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.casesService.findOne(user.tenantId, id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCaseStatusDto,
  ) {
    return this.casesService.updateStatus(user.tenantId, id, user.id, dto.status);
  }
}
