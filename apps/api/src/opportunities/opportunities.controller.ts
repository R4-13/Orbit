import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import type { Opportunity } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { QueryOpportunitiesDto } from './dto/query-opportunities.dto';
import { UpdateOpportunityStageDto } from './dto/update-opportunity-stage.dto';
import { OpportunitiesService } from './opportunities.service';

@ApiTags('opportunities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CRM_OPPORTUNITY_MANAGE)
@Controller({ path: 'opportunities' })
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOpportunityDto): Promise<Opportunity> {
    return this.opportunitiesService.create(user.tenantId, user.id, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryOpportunitiesDto,
  ): Promise<Opportunity[]> {
    return this.opportunitiesService.findAll(user.tenantId, query.stage);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Opportunity> {
    return this.opportunitiesService.findOne(user.tenantId, id);
  }

  @Patch(':id/stage')
  updateStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityStageDto,
  ): Promise<Opportunity> {
    return this.opportunitiesService.updateStage(user.tenantId, user.id, id, dto.stage);
  }
}
