import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { clearCookieOptions, isCookieMode, PLATFORM_REFRESH_COOKIE, readRefreshCookie, refreshCookieOptions } from './auth/platform-cookie';
import { Throttle } from '@nestjs/throttler';
import type { OrchestrationDiagnosticProjection } from '@orbit/shared';
import { AuthenticationExpiredError, PLATFORM_ROLES, PLATFORM_SCOPES, PermissionDeniedError, type PlatformPrincipal, type PlatformRole, type RuntimeHealth, type WorkBacklog } from '@orbit/shared';
import { PlatformAuditService, type PlatformAuditEntry } from './audit/platform-audit.service';
import { PlatformAuthService, type PlatformTokens } from './auth/platform-auth.service';
import { AllowWhilePasswordChangePending, CurrentPlatformPrincipal, PlatformAuthGuard, PlatformScopeGuard, RequirePlatformScope, RequireStepUp } from './auth/platform-guards';
import {
  CreatePlatformIdentityDto,
  DiagnosticsQueryDto,
  DiagnosticsSearchQueryDto,
  DisablePlatformIdentityDto,
  PlatformAuditQueryDto,
  PlatformChangePasswordDto,
  PlatformLoginDto,
  PlatformRefreshDto,
  PlatformStepUpDto,
  ProvisionTenantDto,
  ResetPlatformPasswordDto,
  SetPlatformRolesDto,
} from './dto/platform.dto';
import { PlatformRuntimeService } from './runtime/platform-runtime.service';
import { PlatformDiagnosticsService } from './diagnostics/platform-diagnostics.service';
import { PlatformIdentityService, type PlatformIdentityView } from './identity/platform-identity.service';
import { PlatformTenantsService, type PlatformOverview, type PlatformTenantSummary, type ProvisionedTenant } from './tenants/platform-tenants.service';

/** Anmeldung der Plattformdomäne – strenger gedrosselt als die Mandantenanmeldung (Betreiberzugang ist das lohnendere Ziel). */
const PLATFORM_AUTH_THROTTLE = { default: { limit: Number(process.env.PLATFORM_AUTH_RATE_LIMIT_MAX ?? 20), ttl: Number(process.env.PLATFORM_AUTH_RATE_LIMIT_WINDOW_MS ?? 300_000) } };

@Controller({ path: 'platform/auth' })
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /** Im Cookie-Modus (Browser) gelangt das Refresh-Token nur als httpOnly-Cookie zum Client, nie in den Antwortkörper. */
  private deliver(tokens: PlatformTokens, request: Request, response: Response): PlatformTokens {
    if (!isCookieMode(request)) return tokens;
    response.cookie(PLATFORM_REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions(this.env));
    return { ...tokens, refreshToken: '' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(PLATFORM_AUTH_THROTTLE)
  async login(@Body() dto: PlatformLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PlatformTokens> {
    return this.deliver(await this.auth.login(dto.email, dto.password), request, response);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(PLATFORM_AUTH_THROTTLE)
  async refresh(@Body() dto: PlatformRefreshDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PlatformTokens> {
    // Das Cookie gilt nur im Cookie-Modus (Header als Schutz gegen fremde Auslöser); ein Token im Körper hat Vorrang und braucht keinen Header.
    const token = dto.refreshToken || (isCookieMode(request) ? readRefreshCookie(request) : undefined);
    if (!token) throw new AuthenticationExpiredError('Kein Refresh-Token vorhanden.');
    try {
      return this.deliver(await this.auth.refresh(token), request, response);
    } catch (error) {
      if (isCookieMode(request)) response.clearCookie(PLATFORM_REFRESH_COOKIE, clearCookieOptions(this.env));
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowWhilePasswordChangePending()
  @UseGuards(PlatformAuthGuard)
  async logout(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(principal);
    response.clearCookie(PLATFORM_REFRESH_COOKIE, clearCookieOptions(this.env));
  }

  /** Passwortwechsel durch die Person selbst: aktuelles Passwort wird erneut geprüft, andere Sitzungen enden. */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(PLATFORM_AUTH_THROTTLE)
  @AllowWhilePasswordChangePending()
  @UseGuards(PlatformAuthGuard)
  changePassword(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Body() dto: PlatformChangePasswordDto) {
    return this.auth.changePassword(principal, dto);
  }

  /** Erneute Passwortprüfung für kritische Operationen (Amendment 03 §3.2). Kein MFA. */
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @Throttle(PLATFORM_AUTH_THROTTLE)
  @UseGuards(PlatformAuthGuard)
  stepUp(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Body() dto: PlatformStepUpDto) {
    return this.auth.stepUp(principal, dto.password);
  }
}

@Controller({ path: 'platform' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
export class PlatformController {
  constructor(
    private readonly tenants: PlatformTenantsService,
    private readonly audit: PlatformAuditService,
    private readonly diagnostics: PlatformDiagnosticsService,
    private readonly runtime: PlatformRuntimeService,
  ) {}

  @Get('me')
  @AllowWhilePasswordChangePending()
  me(@CurrentPlatformPrincipal() principal: PlatformPrincipal): PlatformPrincipal {
    return principal;
  }

  @Get('overview')
  @RequirePlatformScope(PLATFORM_SCOPES.CONFIG_READ)
  overview(): Promise<PlatformOverview> {
    return this.tenants.overview();
  }

  /** Betriebszustand der Hintergrundverarbeitung (Queues, Worker): echte Messwerte, nur Zahlen. */
  @Get('runtime')
  @RequirePlatformScope(PLATFORM_SCOPES.RUNTIME_READ)
  runtimeHealth(): Promise<RuntimeHealth> {
    return this.runtime.health();
  }

  /** Arbeitsstand der Hintergrundverarbeitung (Amendment 03 §16.2): Erwartungen, Wiederholungen, hängende Vorgänge – nur Zähler. */
  @Get('runtime/work')
  @RequirePlatformScope(PLATFORM_SCOPES.RUNTIME_READ)
  runtimeWork(): Promise<WorkBacklog> {
    return this.runtime.backlog();
  }

  @Get('tenants')
  @RequirePlatformScope(PLATFORM_SCOPES.TENANTS_READ)
  listTenants(): Promise<PlatformTenantSummary[]> {
    return this.tenants.list();
  }

  /** Neukunde anlegen – kritische Operation: Step-up, Begründung und Audit. Das Startpasswort steht nur in dieser Antwort. */
  @Post('tenants')
  @RequirePlatformScope(PLATFORM_SCOPES.TENANTS_LIFECYCLE_WRITE)
  @RequireStepUp()
  provisionTenant(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Body() dto: ProvisionTenantDto): Promise<ProvisionedTenant> {
    return this.tenants.provision(principal, dto);
  }

  @Get('tenants/:id')
  @RequirePlatformScope(PLATFORM_SCOPES.TENANTS_READ)
  getTenant(@Param('id') id: string): Promise<PlatformTenantSummary> {
    return this.tenants.get(id);
  }

  /**
   * Diagnostic Projection eines Case (Amendment 02 v1.2 §35.3, Amendment 03 §17): technische Metadaten, mandantenscharf, begründet und auditiert.
   * Keine Fachinhalte/Payloads; tiefere Einsicht gibt es nur über eine Support-Session (Phase OPS-5).
   */
  @Get('diagnostics/cases/:caseId')
  @RequirePlatformScope(PLATFORM_SCOPES.DIAGNOSTICS_READ)
  caseDiagnostics(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Param('caseId') caseId: string, @Query() query: DiagnosticsQueryDto): Promise<OrchestrationDiagnosticProjection> {
    return this.diagnostics.caseDiagnostics(principal, { tenantId: query.tenantId, caseId, reason: query.reason });
  }

  /** Referenzsuche (Amendment 03 §16.1): zu einer Kennung Mandant und Vorgang finden – begründet, auditiert, ohne Inhalte. */
  @Get('diagnostics/search')
  @RequirePlatformScope(PLATFORM_SCOPES.DIAGNOSTICS_READ)
  searchReferences(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Query() query: DiagnosticsSearchQueryDto) {
    return this.diagnostics.search(principal, { reference: query.reference, reason: query.reason });
  }

  /** Diagnose-Export als Datei (OAS-05): Step-up, Begründung, Audit mit Prüfsumme. */
  @Get('diagnostics/cases/:caseId/export')
  @RequirePlatformScope(PLATFORM_SCOPES.DIAGNOSTICS_READ)
  @RequireStepUp()
  async exportCaseDiagnostics(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Param('caseId') caseId: string,
    @Query() query: DiagnosticsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.diagnostics.exportCase(principal, { tenantId: query.tenantId, caseId, reason: query.reason });
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Cache-Control', 'no-store');
    return file.content;
  }

  /**
   * Plattform-Audit (Amendment 03 §19). Der Detailgrad hängt von der Rolle ab: volle Sicht (`audit.read`), Fachbereichssicht (`audit.read.scoped`)
   * oder nur eigene Handlungen (`audit.read.own`). Es gibt keinen Schreib-/Änderungs-/Löschpfad (OAS-03).
   */
  @Get('audit')
  async auditTrail(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Query() query: PlatformAuditQueryDto): Promise<{ items: PlatformAuditEntry[]; nextBefore?: string }> {
    const scopes = principal.platformScopes;
    const common = { limit: query.limit ?? 50, before: query.before, eventTypes: query.eventType ? [query.eventType] : undefined, targetTenantId: query.targetTenantId };
    if (scopes.includes(PLATFORM_SCOPES.AUDIT_READ)) return this.audit.list(common);
    if (scopes.includes(PLATFORM_SCOPES.AUDIT_READ_SCOPED)) return this.audit.list({ ...common, restrict: { eventTypePrefixes: auditPrefixesFor(principal.platformRoles) } });
    if (scopes.includes(PLATFORM_SCOPES.AUDIT_READ_OWN)) return this.audit.list({ ...common, restrict: { ownUserId: principal.userId } });
    await this.audit.record({ eventType: 'PLATFORM_ACCESS_DENIED', actor: { userId: principal.userId, roles: principal.platformRoles }, targetType: 'Route', targetId: 'PlatformController.auditTrail', reason: 'missing scope', extra: { missing: [PLATFORM_SCOPES.AUDIT_READ] } });
    throw new PermissionDeniedError('Missing required platform scope(s).', { missing: [PLATFORM_SCOPES.AUDIT_READ] });
  }
}

/** Ereignispräfixe, die eine Rolle im eingeschränkten Audit sieht (Amendment 03 §2.3: „begrenzt“/„cost relevant“/„release relevant“). */
export function auditPrefixesFor(roles: readonly PlatformRole[]): string[] {
  const prefixes = new Set<string>();
  const add = (...values: string[]) => values.forEach((v) => prefixes.add(v));
  for (const role of roles) {
    if (role === PLATFORM_ROLES.PLATFORM_FINOPS) add('PLATFORM_AI_', 'PLATFORM_SECRET');
    if (role === PLATFORM_ROLES.PLATFORM_RELEASE_MANAGER) add('PLATFORM_FEATURE', 'PLATFORM_KILL', 'PLATFORM_CONNECTOR');
    if (role === PLATFORM_ROLES.PLATFORM_ENGINEERING) add('PLATFORM_AI_', 'PLATFORM_CONNECTOR', 'PLATFORM_FEATURE', 'PLATFORM_RUNTIME_');
    if (role === PLATFORM_ROLES.PLATFORM_OPERATOR) add('PLATFORM_TENANT_', 'PLATFORM_AI_', 'PLATFORM_SECRET', 'PLATFORM_CONNECTOR', 'PLATFORM_FEATURE', 'PLATFORM_KILL', 'PLATFORM_SUPPORT_', 'PLATFORM_RUNTIME_');
  }
  return [...prefixes];
}

@Controller({ path: 'platform/identities' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
@RequirePlatformScope(PLATFORM_SCOPES.IDENTITY_MANAGE)
export class PlatformIdentityController {
  constructor(private readonly identities: PlatformIdentityService) {}

  @Get()
  list(): Promise<PlatformIdentityView[]> {
    return this.identities.list();
  }

  /** Neue Plattformidentität – kritische Operation: verlangt Step-up. */
  @Post()
  @RequireStepUp()
  create(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Body() dto: CreatePlatformIdentityDto): Promise<PlatformIdentityView> {
    return this.identities.create(principal, dto);
  }

  @Put(':id/roles')
  @RequireStepUp()
  setRoles(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Param('id') id: string, @Body() dto: SetPlatformRolesDto): Promise<PlatformIdentityView> {
    return this.identities.setRoles(principal, id, dto);
  }

  /** Vergessenes Passwort zurücksetzen: einmaliges Startpasswort nur in dieser Antwort, Wechsel wird erzwungen, Sitzungen enden. */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequireStepUp()
  resetPassword(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Param('id') id: string, @Body() dto: ResetPlatformPasswordDto) {
    return this.identities.resetPassword(principal, id, dto.reason);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @RequireStepUp()
  disable(@CurrentPlatformPrincipal() principal: PlatformPrincipal, @Param('id') id: string, @Body() dto: DisablePlatformIdentityDto): Promise<PlatformIdentityView> {
    return this.identities.disable(principal, id, dto.reason);
  }
}
