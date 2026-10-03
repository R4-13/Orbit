import { Controller, Get, Inject, Param, ParseEnumPipe, Query, Redirect } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { OrbitEnv } from '@orbit/config';
import { IntegrationConnectorType } from '@orbit/domain';
import { ORBIT_ENV } from '../config/env.token';
import { GmailConnectorService } from './gmail-connector.service';

/**
 * §7.3/§13 — Googles Redirect nach dem Consent-Bildschirm landet hier.
 * Bewusst ein **separater, komplett ungeschützter Controller**: Googles
 * Redirect ist ein normaler Browser-GET ohne `Authorization`-Header, der
 * bestehende `JwtAuthGuard` (angewendet auf `IntegrationsController` als
 * Klassen-Decorator) würde jeden echten Callback mit 401 ablehnen. Die
 * tatsächliche Tenant-/Nutzer-Identität kommt stattdessen aus dem
 * signierten `state`-Parameter (`OAuthStateService`, selbst die
 * CSRF-Absicherung nach §5.1) — kein Public-Bypass-Mechanismus auf dem
 * bestehenden Guard nötig, nur ein Controller, der ihn nie anwendet.
 *
 * Nutzt `@Redirect()` statt `@Res()` — dieselbe, bereits in dieser
 * Session dokumentierte Lektion, `@Res()` nur zu verwenden, wenn Nests
 * eigener Response-Mechanismus wirklich nicht ausreicht (hier reicht er).
 */
@ApiTags('integrations')
@Controller({ path: 'integrations' })
export class IntegrationsCallbackController {
  constructor(
    private readonly gmailConnector: GmailConnectorService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  @Get(':connectorType/callback')
  @Redirect()
  async callback(
    @Param('connectorType', new ParseEnumPipe(IntegrationConnectorType)) connectorType: IntegrationConnectorType,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
  ): Promise<{ url: string }> {
    const frontendOrigin = this.env.CORS_ALLOWED_ORIGINS.split(',')[0]?.trim() ?? '';
    const integrationsPageUrl = `${frontendOrigin}/integrations`;

    if (connectorType !== 'GMAIL') {
      return { url: `${integrationsPageUrl}?error=unsupported_connector` };
    }
    if (providerError) {
      return { url: `${integrationsPageUrl}?error=${encodeURIComponent(providerError)}` };
    }
    if (!code || !state) {
      return { url: `${integrationsPageUrl}?error=missing_code_or_state` };
    }

    try {
      await this.gmailConnector.completeConnection(code, state);
      return { url: `${integrationsPageUrl}?connected=GMAIL` };
    } catch {
      return { url: `${integrationsPageUrl}?error=connection_failed` };
    }
  }
}
