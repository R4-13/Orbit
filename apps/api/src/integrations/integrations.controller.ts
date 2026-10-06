import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseEnumPipe, Post, Put, UseGuards, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IntegrationUnavailableError, PERMISSIONS } from '@orbit/shared';
import { IntegrationConnectorType } from '@orbit/domain';
import { CONNECTOR_REGISTRY, getConnectorMetadata } from '@orbit/integration-core';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { AuditService } from '../audit/audit.service';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { TasksService } from '../tasks/tasks.service';
import { ConnectorRequestDto } from './dto/connector-request.dto';
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
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
    private readonly platformControl: PlatformControlService,
  ) {}

  /** Plattformsperre eines Connectors (Amendment 03 §13.3): keine neuen Verbindungen, mit verständlicher Meldung. */
  private async assertConnectorOpen(connectorType: IntegrationConnectorType): Promise<void> {
    const blocked = await this.platformControl.connectorBlocked(connectorType);
    if (blocked.blocked) {
      throw new IntegrationUnavailableError(`Dieser Connector ist derzeit plattformweit gesperrt${blocked.reason ? `: ${blocked.reason}` : ''}. Neue Verbindungen sind vorübergehend nicht möglich; bestehende Daten bleiben erhalten.`, { connectorType });
    }
  }

  /**
   * UI v2 §18.2: ein System, das ORBIT nicht unterstützt, wird als Anfrage erfasst – nicht als erfundener Connector angeboten.
   * Die Anfrage wird auditiert und als Aufgabe für die Administration sichtbar.
   */
  @Post('requests')
  async requestSystem(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConnectorRequestDto): Promise<{ recorded: true }> {
    await this.audit.record({ tenantId: user.tenantId, eventType: 'CONNECTOR_REQUESTED', actorType: 'USER', actorUserId: user.id, payload: { systemName: dto.systemName, note: dto.note ?? null } });
    await this.tasks.create(user.tenantId, user.id, { title: `Systemanbindung prüfen: ${dto.systemName}`, description: dto.note ?? 'Ein Nutzer wünscht die Anbindung dieses Systems.' });
    return { recorded: true };
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.findAll(user.tenantId);
  }

  /** §4/§13 des Integration-Framework-Amendments — der statische Connector-Katalog, unabhängig vom Verbindungsstatus dieses Tenants. */
  @Get('connectors')
  async listConnectors() {
    // Derselbe statische Katalog, ergänzt um den Plattformzustand (ohne Eintrag: ACTIVE) – keine zweite Registry.
    return Promise.all(CONNECTOR_REGISTRY.map(async (metadata) => ({ ...metadata, platformStatus: (await this.platformControl.connectorGovernance(metadata.id)).lifecycle })));
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
  async upsertCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
    @Body() dto: UpsertIntegrationCredentialsDto,
  ) {
    await this.assertConnectorOpen(connectorType);
    return this.integrationsService.upsertCredentials(user.tenantId, user.id, connectorType, dto.credentials, dto.config);
  }

  /** §5.1/§7.3 — startet den OAuth-Flow und liefert die Google-Autorisierungs-URL, zu der das Frontend weiterleitet. */
  @Post(':connectorType/connect')
  async startConnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
    @Query('send') send?: string,
  ) {
    this.assertOAuthCapable(connectorType, 'OAuth-Connect');
    await this.assertConnectorOpen(connectorType);
    // `?send=true` additionally requests the gmail.send scope (explicit, minimal-permission opt-in).
    return this.gmailConnector.startConnection(user.tenantId, user.id, { includeSend: send === 'true' });
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
