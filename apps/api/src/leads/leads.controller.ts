import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import type { Company, Contact, Lead, Opportunity } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateLeadDto } from './dto/create-lead.dto';
import { QueryLeadsDto } from './dto/query-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'leads' })
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CRM_LEAD_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_READ)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryLeadsDto) {
    return this.leadsService.findAll(user.tenantId, query.status);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_READ)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Lead & { contact: Contact; company: Company | null; opportunities: Opportunity[] }> {
    return this.leadsService.findOne(user.tenantId, id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CRM_OPPORTUNITY_MANAGE)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
  ) {
    return this.leadsService.updateStatus(user.tenantId, id, dto.status);
  }
}
