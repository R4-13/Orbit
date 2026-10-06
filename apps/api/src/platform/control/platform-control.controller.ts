import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PLATFORM_SCOPES, PermissionDeniedError, type PlatformPrincipal } from '@orbit/shared';
import { PlatformControlAdminService } from '../../platform-control/platform-control-admin.service';
import { CurrentPlatformPrincipal, PlatformAuthGuard, PlatformScopeGuard, RequirePlatformScope, RequireStepUp } from '../auth/platform-guards';
import { ConnectorLifecycleDto, CreateFlagDto, KillSwitchDto, TenantLifecycleChangeDto, TenantLifecycleQueryDto, UpdateFlagDto } from './platform-control.dto';

/** Feature Flags (Amendment 03 §14): Global/Umgebung/Kohorte/Mandant, mit Owner, Ablauf, Vorschau und optimistischem Sperren. */
@Controller({ path: 'platform/features' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
export class PlatformFeaturesController {
  constructor(private readonly admin: PlatformControlAdminService) {}

  @Get()
  @RequirePlatformScope(PLATFORM_SCOPES.FEATURES_READ)
  list() {
    return this.admin.listFlags();
  }

  @Post()
  @RequirePlatformScope(PLATFORM_SCOPES.FEATURES_WRITE)
  @RequireStepUp()
  create(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Body() dto: CreateFlagDto) {
    const { key, ...rest } = dto;
    return this.admin.createFlag(actor, key, rest);
  }

  @Get(':key/preview')
  @RequirePlatformScope(PLATFORM_SCOPES.FEATURES_READ)
  preview(@Param('key') key: string) {
    return this.admin.previewFlag(key);
  }

  @Patch(':key')
  @RequirePlatformScope(PLATFORM_SCOPES.FEATURES_WRITE)
  @RequireStepUp()
  update(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('key') key: string, @Body() dto: UpdateFlagDto) {
    return this.admin.updateFlag(actor, key, dto);
  }
}

/** Kill Switches (Amendment 03 §15): serverseitig, sofort wirksam für neue Aktionen, ohne Löschung von Historie, auditiert. */
@Controller({ path: 'platform/kill-switches' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
export class PlatformKillSwitchController {
  constructor(private readonly admin: PlatformControlAdminService) {}

  @Get()
  @RequirePlatformScope(PLATFORM_SCOPES.FEATURES_READ)
  list() {
    return this.admin.listKillSwitches();
  }

  @Post(':key/engage')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.KILLSWITCH_WRITE)
  @RequireStepUp()
  engage(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('key') key: string, @Body() dto: KillSwitchDto) {
    return this.admin.setKillSwitch(actor, key, { engaged: true, reason: dto.reason, expectedVersion: dto.expectedVersion });
  }

  @Post(':key/release')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.KILLSWITCH_WRITE)
  @RequireStepUp()
  release(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('key') key: string, @Body() dto: KillSwitchDto) {
    return this.admin.setKillSwitch(actor, key, { engaged: false, reason: dto.reason, expectedVersion: dto.expectedVersion });
  }
}

/** Connector-Governance (Amendment 03 §13): Lifecycle auf dem EINEN Katalog; Mandanten verwalten nur ihre eigenen Verbindungen. */
@Controller({ path: 'platform/connectors' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
export class PlatformConnectorsController {
  constructor(private readonly admin: PlatformControlAdminService) {}

  @Get()
  @RequirePlatformScope(PLATFORM_SCOPES.CONNECTORS_READ)
  list() {
    return this.admin.listConnectors();
  }

  @Get(':key/impact')
  @RequirePlatformScope(PLATFORM_SCOPES.CONNECTORS_READ)
  impact(@Param('key') key: string) {
    return this.admin.connectorImpact(key);
  }

  /** Sperren/Veralten darf auch Security (`connectors.suspend`); alle anderen Übergänge verlangen `connectors.write`. */
  @Post(':key/lifecycle')
  @HttpCode(HttpStatus.OK)
  @RequireStepUp()
  lifecycle(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('key') key: string, @Body() dto: ConnectorLifecycleDto) {
    const restrictive = ['SUSPENDED', 'DEPRECATED', 'RETIRED'].includes(dto.to);
    const allowed = actor.platformScopes.includes(PLATFORM_SCOPES.CONNECTORS_WRITE) || (restrictive && actor.platformScopes.includes(PLATFORM_SCOPES.CONNECTORS_SUSPEND));
    if (!allowed) throw new PermissionDeniedError('Missing required platform scope(s).', { missing: [restrictive ? PLATFORM_SCOPES.CONNECTORS_SUSPEND : PLATFORM_SCOPES.CONNECTORS_WRITE] });
    return this.admin.setConnectorLifecycle(actor, key, dto);
  }
}

/** Mandantenlebenszyklus (Amendment 03 §6): Vorschau mit beschriebener Wirkung, Änderung nur mit daran gebundener Bestätigung. */
@Controller({ path: 'platform/tenants' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
export class PlatformTenantLifecycleController {
  constructor(private readonly admin: PlatformControlAdminService) {}

  @Get(':id/lifecycle-preview')
  @RequirePlatformScope(PLATFORM_SCOPES.TENANTS_LIFECYCLE_WRITE)
  preview(@Param('id') id: string, @Query() query: TenantLifecycleQueryDto) {
    const list = (value?: string) => (value === undefined ? undefined : value.split(',').map((v) => v.trim()).filter(Boolean));
    return this.admin.previewTenantLifecycle(id, { status: query.status, suspensionScopes: list(query.suspensionScopes), featureCohorts: list(query.featureCohorts) });
  }

  @Patch(':id/lifecycle')
  @RequirePlatformScope(PLATFORM_SCOPES.TENANTS_LIFECYCLE_WRITE)
  @RequireStepUp()
  change(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: TenantLifecycleChangeDto) {
    return this.admin.applyTenantLifecycle(actor, id, dto);
  }
}
