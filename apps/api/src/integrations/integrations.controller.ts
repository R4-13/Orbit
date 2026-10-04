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
import { ConnectorStatusService } from './connector-status.service';
import { UpsertIntegrationCredentialsDto } from './dto/upsert-integration-credentials.dto';
import { GmailConnectorService } from './gmail-connector.service';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.INTEGRATION_CONFIGURE)
@Controller({ path: 'integrations' })
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly gmailConnector: GmailConnectorService,
    private readonly connectorStatus: ConnectorStatusService,
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

  /** docs/CHANNEL_EVENT_RUNTIME_PLAN.md §8 (Increment H) — the 5-level operational status, computed from real evidence, not from `Integration.status` alone. */
  @Get(':connectorType/operational-status')
  getOperationalStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
  ) {
    return this.connectorStatus.getStatus(user.tenantId, connectorType);
  }

  /** Single source of truth for "is this connector really callable today" is the registry's `liveConnectSupported` flag (currently only GMAIL) — not a second, separately-maintained list here. */
  private assertOAuthCapable(connectorType: IntegrationConnectorType, action: string): void {
    if (!getConnectorMetadata(connectorType)?.liveConnectSupported) {
      throw new BadRequestException(`${action} wird für "${connectorType}" noch nicht unterstützt — siehe docs/INTEGRATIONS.md.`);
    }
  }
}
