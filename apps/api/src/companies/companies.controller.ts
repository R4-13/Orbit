import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CompaniesService } from './companies.service';
import { UpsertCompanyDto } from './dto/upsert-company.dto';

/**
 * No dedicated "company.*" permission exists in PERMISSIONS (@orbit/shared)
 * — companies are part of the same CRM domain as contacts, so this reuses
 * CRM_CONTACT_CREATE/CRM_CONTACT_READ rather than inventing a new one.
 */
@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'companies' })
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertCompanyDto) {
    return this.companiesService.upsert(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_READ)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.findAll(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.companiesService.findOne(user.tenantId, id);
  }
}
