import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseEnumPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { IntegrationConnectorType } from '@orbit/domain';
import { CONNECTOR_REGISTRY, getConnectorMetadata } from '@orbit/integration-core';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { UpsertIntegrationCredentialsDto } from './dto/upsert-integration-credentials.dto';
import { GmailConnectorService } from './gmail-connector.service';
import { IntegrationsService } from './integrations.service';

/** Connector types with a real, OAuth-capable connector service behind `connect`/`test`/revoke-on-disconnect — everything else still only supports the generic credentials PUT (§18: real connectors "folgen pro Connector in der jeweiligen Phase", see docs/INTEGRATIONS.md). */
const OAUTH_CAPABLE_CONNECTORS: readonly IntegrationConnectorType[] = ['GMAIL'];

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.INTEGRATION_CONFIGURE)
@Controller({ path: 'integrations' })
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly gmailConnector: GmailConnectorService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.findAll(user.tenantId);
  }

  /** §4/§13 des Integration-Framework-Amendments — der statische Connector-Katalog, unabhängig vom Verbindungsstatus dieses Tenants. */
  @Get('connectors')
  listConnectors() {
    return CONNECTOR_REGISTRY;
  }

  @Get('connectors/:connectorType')
  getConnector(@Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType) {
    const metadata = getConnectorMetadata(connectorType);
    if (!metadata) {
      throw new NotFoundException('Connector not found.');
    }
    return metadata;
  }

  @Put(':connectorType/credentials')
  upsertCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
    @Body() dto: UpsertIntegrationCredentialsDto,
  ) {
    return this.integrationsService.upsertCredentials(user.tenantId, user.id, connectorType, dto.credentials, dto.config);
  }

  /** §5.1/§7.3 — startet den OAuth-Flow und liefert die Google-Autorisierungs-URL, zu der das Frontend weiterleitet. */
  @Post(':connectorType/connect')
  startConnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
  ) {
    this.assertOAuthCapable(connectorType, 'OAuth-Connect');
    return this.gmailConnector.startConnection(user.tenantId, user.id);
  }

  @Post(':connectorType/test')
  async testConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
  ) {
    this.assertOAuthCapable(connectorType, 'Verbindungstest');
    const ok = await this.gmailConnector.testConnection(user.tenantId);
    return { ok };
  }

  @Delete(':connectorType')
  async disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
  ) {
    if (connectorType === 'GMAIL') {
      // Best-effort — Google's revoke endpoint may itself be unreachable/already-invalid; the
      // local disconnect (vault secret deletion, status change) below must proceed regardless.
      await this.gmailConnector.revokeAtProvider(user.tenantId).catch(() => undefined);
    }
    return this.integrationsService.disconnect(user.tenantId, user.id, connectorType);
  }

  private assertOAuthCapable(connectorType: IntegrationConnectorType, action: string): void {
    if (!OAUTH_CAPABLE_CONNECTORS.includes(connectorType)) {
      throw new BadRequestException(`${action} wird für "${connectorType}" noch nicht unterstützt — siehe docs/INTEGRATIONS.md.`);
    }
  }
}
