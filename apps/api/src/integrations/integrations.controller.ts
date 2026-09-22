import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { IntegrationConnectorType } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { UpsertIntegrationCredentialsDto } from './dto/upsert-integration-credentials.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.INTEGRATION_CONFIGURE)
@Controller({ path: 'integrations' })
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.findAll(user.tenantId);
  }

  @Put(':connectorType/credentials')
  upsertCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
    @Body() dto: UpsertIntegrationCredentialsDto,
  ) {
    return this.integrationsService.upsertCredentials(user.tenantId, user.id, connectorType, dto.credentials, dto.config);
  }

  @Delete(':connectorType')
  disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
  ) {
    return this.integrationsService.disconnect(user.tenantId, user.id, connectorType);
  }
}
