import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { PLATFORM_SCOPES, type PlatformPrincipal } from '@orbit/shared';
import { AiAdapterRegistry } from '../../ai-governance/ai-adapter-registry.service';
import { AiRegistryAdminService } from '../../ai-governance/ai-registry-admin.service';
import { CurrentPlatformPrincipal, PlatformAuthGuard, PlatformScopeGuard, RequirePlatformScope, RequireStepUp } from '../auth/platform-guards';
import {
  ConnectionLifecycleDto,
  CreateConnectionDto,
  CreateModelDto,
  CreateProfileDraftDto,
  CreateProviderDto,
  CreateRouteDto,
  DisableProviderDto,
  PublishProfileDto,
  RecordEvaluationDto,
  RotateSecretDto,
  RouteChangeDto,
  TransitionModelDto,
  TransitionProviderDto,
  UsageQueryDto,
} from './platform-ai.dto';

/**
 * AI Platform (Amendment 03 §25.3): Anbieter, Modelle, Profile, Routen, Verbindungen, Health, Nutzung. Alle Routen liegen hinter den Plattform-Guards;
 * Änderungen mit weitreichender Wirkung verlangen Step-up und tragen Version + Begründung (optimistisches Sperren, Audit mit Vorher/Nachher).
 */
@Controller({ path: 'platform/ai' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
export class PlatformAiController {
  constructor(
    private readonly admin: AiRegistryAdminService,
    private readonly adapters: AiAdapterRegistry,
  ) {}

  @Get('overview')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  async overview() {
    const [providers, models, profiles, routes, connections, health] = await Promise.all([
      this.admin.listProviders(),
      this.admin.listModels(),
      this.admin.listProfiles(),
      this.admin.listRoutes(),
      this.admin.listConnections(),
      this.admin.listHealth(),
    ]);
    return { adapters: this.adapters.keys(), providers, models, profiles, routes, connections, health };
  }

  // Anbieter
  @Get('providers')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  providers() {
    return this.admin.listProviders();
  }

  @Post('providers')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  createProvider(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Body() dto: CreateProviderDto) {
    return this.admin.createProvider(actor, dto);
  }

  @Post('providers/:key/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  transitionProvider(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('key') key: string, @Body() dto: TransitionProviderDto) {
    return this.admin.transitionProvider(actor, key, dto);
  }

  /** Notbremse: einen Anbieter im Routing sofort sperren/freigeben (nur neue Aufrufe; Historie bleibt). */
  @Post('providers/:key/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  async disableProvider(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('key') key: string, @Body() dto: DisableProviderDto) {
    await this.admin.setProviderDisabled(actor, key, dto.disabled, dto.reason);
    return { providerKey: key, disabled: dto.disabled };
  }

  // Modelle
  @Get('models')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  models(@Query('providerKey') providerKey?: string) {
    return this.admin.listModels(providerKey);
  }

  @Post('models')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  createModel(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Body() dto: CreateModelDto) {
    return this.admin.createModel(actor, dto);
  }

  @Post('models/:id/evaluation')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  recordEvaluation(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: RecordEvaluationDto) {
    return this.admin.recordEvaluation(actor, id, dto);
  }

  @Post('models/:id/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  transitionModel(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: TransitionModelDto) {
    return this.admin.transitionModel(actor, id, dto);
  }

  // Profile
  @Get('model-profiles')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  profiles() {
    return this.admin.listProfiles();
  }

  @Post('model-profiles')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  createProfileDraft(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Body() dto: CreateProfileDraftDto) {
    return this.admin.createProfileDraft(actor, dto);
  }

  @Post('model-profiles/:key/versions/:version/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  publishProfile(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('key') key: string, @Param('version', ParseIntPipe) version: number, @Body() dto: PublishProfileDto) {
    return this.admin.publishProfile(actor, key, version, dto.reason);
  }

  // Routen
  @Get('routes')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  routes() {
    return this.admin.listRoutes();
  }

  @Post('routes')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  createRoute(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Body() dto: CreateRouteDto) {
    return this.admin.createRoute(actor, dto);
  }

  @Get('routes/:id/activation-preview')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  preview(@Param('id') id: string) {
    return this.admin.previewActivation(id);
  }

  @Post('routes/:id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  activate(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: RouteChangeDto) {
    return this.admin.activateRoute(actor, id, dto);
  }

  @Post('routes/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  deactivate(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: RouteChangeDto) {
    return this.admin.deactivateRoute(actor, id, dto);
  }

  // Plattformverbindungen (Secrets werden nie ausgegeben)
  @Get('connections')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  connections() {
    return this.admin.listConnections();
  }

  @Post('connections')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_SECRETS_WRITE)
  @RequireStepUp()
  createConnection(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Body() dto: CreateConnectionDto) {
    return this.admin.createConnection(actor, dto);
  }

  @Post('connections/:id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_SECRETS_WRITE)
  @RequireStepUp()
  rotate(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: RotateSecretDto) {
    return this.admin.rotateConnectionSecret(actor, id, dto);
  }

  @Post('connections/:id/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  validate(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string) {
    return this.admin.validateConnection(actor, id);
  }

  @Post('connections/:id/lifecycle')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  lifecycle(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: ConnectionLifecycleDto) {
    return this.admin.setConnectionLifecycle(actor, id, dto);
  }

  // Health / Nutzung / Bootstrap
  @Get('health')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_READ)
  health() {
    return this.admin.listHealth();
  }

  @Get('usage')
  @RequirePlatformScope(PLATFORM_SCOPES.AI_COST_READ)
  usage(@Query() query: UsageQueryDto) {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 30 * 24 * 3_600_000);
    return this.admin.usageSummary({ from, to, groupBy: query.groupBy ?? 'profileKey' });
  }

  @Post('bootstrap-from-environment')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.AI_WRITE)
  @RequireStepUp()
  bootstrap(@CurrentPlatformPrincipal() actor: PlatformPrincipal) {
    return this.admin.bootstrapFromEnvironment(actor);
  }
}
