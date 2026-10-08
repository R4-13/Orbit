import { Injectable } from '@nestjs/common';
import { ExternalSystemError } from '@orbit/shared';

/**
 * Der Anbieter hat das Refresh-Token endgültig abgelehnt (widerrufen, abgelaufen, Konto/Client geändert): nur eine neue Zustimmung der Person hilft.
 * Alles andere – Netzwerkfehler, Zeitüberschreitung, 5xx, 429 – ist vorübergehend und darf die Verbindung nie als „abgemeldet“ markieren.
 */
export class OAuthGrantRejectedError extends ExternalSystemError {
  constructor(
    message: string,
    readonly oauthError: string,
  ) {
    super(message, { oauthError });
  }
}

/** OAuth-2.0-Fehlercodes (RFC 6749 §5.2), bei denen ein erneuter Versuch mit demselben Token nie gelingt. */
const DEFINITIVE_REFRESH_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

export interface OAuth2ProviderConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Not every provider supports revocation (§5.1: "soweit Provider dies unterstützt"). */
  revokeEndpoint?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  /** Only present when `access_type=offline` was requested and granted (first consent only — Google omits it on later token refreshes). */
  refreshToken?: string;
  expiresAt: Date;
  scope?: string;
  tokenType?: string;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

/**
 * §5.1 des Integration-Framework-Amendments — providerunabhängiger
 * Authorization-Code-Flow (RFC 6749 §4.1). Google ist der erste
 * Verwender (`GmailConnectorService`), aber nichts hier ist Google-
 * spezifisch — ein künftiger Microsoft-/HubSpot-Connector würde dieselbe
 * Klasse mit eigenen `OAuth2ProviderConfig`-Endpunkten verwenden.
 *
 * Nutzt natives `fetch` (Node 22 im Docker-Image, `engines.node >=20.0.0`)
 * statt einer neuen HTTP-Client-Abhängigkeit — dieselbe
 * Minimal-Dependency-Philosophie wie an anderer Stelle dieser Session
 * (z. B. eigene Chart-Komponenten statt einer Chart-Bibliothek).
 */
@Injectable()
export class OAuth2Service {
  buildAuthorizationUrl(
    config: OAuth2ProviderConfig,
    params: { scope: string; state: string; accessType?: 'online' | 'offline'; prompt?: string },
  ): string {
    const url = new URL(config.authorizationEndpoint);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', params.scope);
    url.searchParams.set('state', params.state);
    if (params.accessType) url.searchParams.set('access_type', params.accessType);
    if (params.prompt) url.searchParams.set('prompt', params.prompt);
    return url.toString();
  }

  async exchangeCodeForTokens(config: OAuth2ProviderConfig, code: string): Promise<OAuth2Tokens> {
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) {
      throw new ExternalSystemError(`OAuth token exchange failed (${response.status}).`, { status: response.status, body: await response.text() });
    }
    return this.parseTokenResponse((await response.json()) as RawTokenResponse);
  }

  async refreshAccessToken(config: OAuth2ProviderConfig, refreshToken: string): Promise<OAuth2Tokens> {
    let response: Response;
    try {
      response = await fetch(config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      // Netzwerk, DNS, Zeitüberschreitung: vorübergehend – die Verbindung bleibt bestehen und der nächste Versuch läuft von selbst.
      throw new ExternalSystemError('OAuth token refresh unreachable.', { transient: true, cause: error instanceof Error ? error.message : String(error) });
    }
    if (!response.ok) {
      const body = await response.text();
      const oauthError = this.readOAuthError(body);
      if ((response.status === 400 || response.status === 401) && oauthError && DEFINITIVE_REFRESH_ERRORS.has(oauthError)) {
        throw new OAuthGrantRejectedError(`OAuth token refresh rejected (${oauthError}).`, oauthError);
      }
      throw new ExternalSystemError(`OAuth token refresh failed (${response.status}).`, { status: response.status, transient: response.status >= 500 || response.status === 429, body });
    }
    // Google's refresh response omits refresh_token (it stays valid, not reissued) — keep the one we already stored.
    return this.parseTokenResponse((await response.json()) as RawTokenResponse, refreshToken);
  }

  /**
   * Best-effort: a provider may not support revocation, and Google itself
   * returns 200 even for an already-invalid token — a non-2xx here still
   * does not block the local disconnect (the Credential Vault row is
   * deleted regardless, see IntegrationsService.disconnect()), it only
   * means the token *might* remain technically valid at Google's end
   * until it naturally expires.
   */
  async revokeToken(config: OAuth2ProviderConfig, token: string): Promise<void> {
    if (!config.revokeEndpoint) return;
    await fetch(config.revokeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  }

  private readOAuthError(body: string): string | undefined {
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      return typeof parsed.error === 'string' ? parsed.error : undefined;
    } catch {
      return undefined;
    }
  }

  private parseTokenResponse(body: RawTokenResponse, existingRefreshToken?: string): OAuth2Tokens {
    const expiresInSeconds = body.expires_in ?? 3600;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? existingRefreshToken,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      scope: body.scope,
      tokenType: body.token_type,
    };
  }
}
