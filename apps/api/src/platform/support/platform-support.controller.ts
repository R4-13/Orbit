import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PLATFORM_SCOPES, type PlatformPrincipal } from '@orbit/shared';
import { CurrentPlatformPrincipal, PlatformAuthGuard, PlatformScopeGuard, RequirePlatformScope, RequireStepUp } from '../auth/platform-guards';
import { ApproveSupportSessionDto, CloseSupportSessionDto, RequestSupportSessionDto } from './platform-support.dto';
import { PlatformSupportService } from './platform-support.service';

/**
 * Support-Sessions (Amendment 03 §18). Die Rollen-Scopes öffnen nur die Verwaltung der Sitzungen; Mandanteninhalte gibt es ausschließlich über die
 * Zugriffsrouten unter `/platform/support-sessions/:id/…`, und dort entscheidet die Sitzung (aktiv, nicht abgelaufen, eigener Anfordernder, Scope) bei jedem Aufruf.
 */
@Controller({ path: 'platform/support-sessions' })
@UseGuards(PlatformAuthGuard, PlatformScopeGuard)
export class PlatformSupportController {
  constructor(private readonly support: PlatformSupportService) {}

  @Post()
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_REQUEST)
  request(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Body() dto: RequestSupportSessionDto) {
    return this.support.request(actor, { tenantId: dto.tenantId, mode: dto.mode, scopes: dto.scopes, minutes: dto.minutes, reasonCode: dto.reasonCode, freeTextReason: dto.freeTextReason, ticketRef: dto.ticketRef });
  }

  @Get()
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_READ)
  list(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    return this.support.list(actor, { tenantId, status });
  }

  @Get(':id')
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_READ)
  get(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string) {
    return this.support.get(actor, id);
  }

  /** Vier-Augen: nur Security/Owner, nie die anfordernde Person. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_APPROVE)
  @RequireStepUp()
  approve(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: ApproveSupportSessionDto) {
    return this.support.approve(actor, id, dto);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_READ)
  close(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: CloseSupportSessionDto) {
    return this.support.close(actor, id, { reason: dto.reason, revoke: false });
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_APPROVE)
  revoke(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Body() dto: CloseSupportSessionDto) {
    return this.support.close(actor, id, { reason: dto.reason, revoke: true });
  }

  // ── Zugriff innerhalb der Sitzung ────────────────────────────────────────────────────────────────────────────────

  @Get(':id/tenant')
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_READ)
  tenant(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string) {
    return this.support.tenantContext(actor, id);
  }

  @Get(':id/cases')
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_READ)
  cases(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string) {
    return this.support.caseMetadata(actor, id);
  }

  @Get(':id/cases/:caseId/diagnostics')
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_READ)
  caseDiagnostics(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Param('caseId') caseId: string) {
    return this.support.caseDiagnostics(actor, id, caseId);
  }

  @Get(':id/cases/:caseId/payload')
  @RequirePlatformScope(PLATFORM_SCOPES.SUPPORT_SESSION_READ)
  casePayload(@CurrentPlatformPrincipal() actor: PlatformPrincipal, @Param('id') id: string, @Param('caseId') caseId: string) {
    return this.support.casePayload(actor, id, caseId);
  }
}
