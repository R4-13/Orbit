import { Inject, Injectable } from '@nestjs/common';
import { AuthenticationExpiredError, ExternalSystemError, IntegrationUnavailableError } from '@orbit/shared';
import type { EmailAttachment, InboundEmail } from '@orbit/integration-core';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialVaultService } from '../security/credential-vault.service';
import { GMAIL_API_BASE, GMAIL_READONLY_SCOPE, GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT, GOOGLE_OAUTH_REVOKE_ENDPOINT, GOOGLE_OAUTH_TOKEN_ENDPOINT } from './google-oauth.config';
import { base64UrlToBase64, extractPlainTextBody, listAttachmentRefs, parseGmailMessageHeaders, type GmailMessage } from './gmail-message-parser';
import { OAuth2Service, type OAuth2ProviderConfig } from './oauth2.service';
import { OAuthStateService } from './oauth-state.service';

interface StoredGmailSecret {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  /** `CredentialVaultService.storeSecret()`/`updateSecret()` expect `Record<string, unknown>` — this index signature is what makes this named interface structurally assignable to that, not an escape hatch for extra fields. */
  [key: string]: unknown;
}

/**
 * §7 des Integration-Framework-Amendments — der erste reale Connector.
 * Bewusst **nicht** als Erweiterung des bestehenden `MAIL_CONNECTOR`-
 * Singletons (siehe `apps/api/src/connectors/connectors.module.ts`)
 * implementiert — jenes Interface hat keinen `tenantId`-Parameter und
 * passt strukturell nicht zu echten, pro Tenant unterschiedlichen OAuth-
 * Credentials (ASSUMPTIONS #353). Stattdessen tenant-aufgelöst nach dem
 * Vorbild von `AiProviderResolverService.resolveForTenant()`: jede
 * Methode nimmt `tenantId` explizit entgegen, keine Methode hält
 * Zustand über einen Aufruf hinaus.
 *
 * Implementiert bewusst nur `email.read` (Verbindung herstellen, Konto
 * erkennen, Verbindung testen, Nachrichten+Anhänge lesen, Token-Refresh,
 * Trennen) — `email.send` ist laut Amendment §7.4/§7.5 ausdrücklich
 * optional für Phase 1 und bleibt ein künftiger, separat zu scopender
 * Auftrag (kein `MailConnector`-Interface-Zwang, da dessen `sendMessage`
 * nicht optional ist — dieser Service erhebt keinen Anspruch, das
 * bestehende Interface vollständig zu erfüllen).
 */
@Injectable()
export class GmailConnectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: CredentialVaultService,
    private readonly audit: AuditService,
    private readonly oauth2: OAuth2Service,
    private readonly state: OAuthStateService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  private get providerConfig(): OAuth2ProviderConfig {
    return {
      authorizationEndpoint: GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: GOOGLE_OAUTH_TOKEN_ENDPOINT,
      revokeEndpoint: GOOGLE_OAUTH_REVOKE_ENDPOINT,
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      redirectUri: this.env.GOOGLE_REDIRECT_URI,
    };
  }

  /**
   * §23: "Fehlende echte Provider Credentials blockieren nicht die
   * generische Implementierung" — dieser Check ist der einzige Punkt, an
   * dem ein leerer `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` tatsächlich
   * etwas verhindert (den realen Google-Redirect), nicht den restlichen
   * Code-Pfad.
   */
  private assertPlatformConfigured(): void {
    if (!this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET || !this.env.GOOGLE_REDIRECT_URI) {
      throw new IntegrationUnavailableError(
        'Gmail ist plattformseitig noch nicht konfiguriert (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI fehlen) — siehe docs/GOOGLE_INTEGRATION.md.',
      );
    }
  }

  startConnection(tenantId: string, userId: string): { authorizationUrl: string } {
    this.assertPlatformConfigured();
    const state = this.state.sign({ tenantId, userId, connectorType: 'GMAIL' });
    const authorizationUrl = this.oauth2.buildAuthorizationUrl(this.providerConfig, {
      scope: GMAIL_READONLY_SCOPE,
      state,
      accessType: 'offline',
      // Forces Google to reissue a refresh_token even on a reconnect — without this, a second
      // consent for an already-authorized app normally omits refresh_token entirely.
      prompt: 'consent',
    });
    return { authorizationUrl };
  }

  async completeConnection(code: string, rawState: string): Promise<{ tenantId: string; externalAccountDisplayName: string }> {
    this.assertPlatformConfigured();
    const { tenantId, userId } = this.state.verify(rawState);

    const tokens = await this.oauth2.exchangeCodeForTokens(this.providerConfig, code);
    const profile = await this.fetchProfile(tokens.accessToken);

    const existing = await this.prisma
      .forTenantId(tenantId)
      .integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });

    const secretValue: StoredGmailSecret = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
    };
    let credentialReference: string;
    if (existing?.credentialReference) {
      await this.vault.updateSecret(tenantId, existing.credentialReference, { tenantId, value: secretValue });
      credentialReference = existing.credentialReference;
    } else {
      credentialReference = await this.vault.storeSecret({ tenantId, value: secretValue });
    }

    await this.prisma.forTenantId(tenantId).integration.upsert({
      where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } },
      create: {
        tenantId,
        connectorType: 'GMAIL',
        status: 'CONNECTED',
        credentialReference,
        externalAccountId: profile.emailAddress,
        externalAccountDisplayName: profile.emailAddress,
        grantedCapabilities: ['email.read'],
        lastSuccessAt: new Date(),
      },
      update: {
        status: 'CONNECTED',
        credentialReference,
        externalAccountId: profile.emailAddress,
        externalAccountDisplayName: profile.emailAddress,
        grantedCapabilities: ['email.read'],
        lastSuccessAt: new Date(),
        lastErrorAt: null,
        lastErrorCode: null,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'INTEGRATION_CONNECTED',
      actorType: 'USER',
      actorUserId: userId,
      entityType: 'Integration',
      entityId: 'GMAIL',
      payload: { connectorType: 'GMAIL', externalAccountDisplayName: profile.emailAddress },
    });

    return { tenantId, externalAccountDisplayName: profile.emailAddress };
  }

  async testConnection(tenantId: string): Promise<boolean> {
    try {
      const accessToken = await this.getValidAccessToken(tenantId);
      await this.fetchProfile(accessToken);
      await this.prisma
        .forTenantId(tenantId)
        .integration.update({
          where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } },
          data: { lastTestedAt: new Date(), lastTestStatus: 'OK', lastSuccessAt: new Date() },
        });
      return true;
    } catch (error) {
      // `update()` throws (P2025) if the row doesn't exist — reachable here when testConnection()
      // is called for a tenant that never completed the connect flow at all (getValidAccessToken()
      // throws AuthenticationExpiredError before any Gmail API call happens). Nothing to record in
      // that case; "never connected" is itself the honest answer, not a write-worthy test failure.
      const existing = await this.prisma
        .forTenantId(tenantId)
        .integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
      if (existing) {
        await this.prisma
          .forTenantId(tenantId)
          .integration.update({
            where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } },
            data: {
              lastTestedAt: new Date(),
              lastTestStatus: 'FAILED',
              lastErrorAt: new Date(),
              lastErrorCode: error instanceof Error ? error.message.slice(0, 255) : 'UNKNOWN',
            },
          });
      }
      return false;
    }
  }

  /** Revokes the token at Google (best-effort) — the local credential row/vault secret are already deleted generically by `IntegrationsService.disconnect()`, which calls this first. */
  async revokeAtProvider(tenantId: string): Promise<void> {
    const integration = await this.prisma
      .forTenantId(tenantId)
      .integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    if (!integration?.credentialReference) return;

    const secret = await this.vault.readSecret(tenantId, integration.credentialReference);
    const { accessToken } = secret.value as unknown as StoredGmailSecret;
    await this.oauth2.revokeToken(this.providerConfig, accessToken);
  }

  async listMessages(tenantId: string, maxResults = 10): Promise<InboundEmail[]> {
    const accessToken = await this.getValidAccessToken(tenantId);

    const listResponse = await this.gmailFetch(accessToken, `/users/me/messages?maxResults=${maxResults}`);
    const { messages = [] } = (await listResponse.json()) as { messages?: { id: string }[] };

    const emails: InboundEmail[] = [];
    for (const { id } of messages) {
      const messageResponse = await this.gmailFetch(accessToken, `/users/me/messages/${id}?format=full`);
      const message = (await messageResponse.json()) as GmailMessage;
      const { from, to, subject, receivedAt, rfcMessageId, inReplyTo, references, autoGenerated, bulk } = parseGmailMessageHeaders(message);
      const bodyText = extractPlainTextBody(message);

      const attachments: EmailAttachment[] = [];
      for (const ref of listAttachmentRefs(message)) {
        const attachmentResponse = await this.gmailFetch(accessToken, `/users/me/messages/${id}/attachments/${ref.attachmentId}`);
        const { data } = (await attachmentResponse.json()) as { data: string };
        attachments.push({ fileName: ref.filename, mimeType: ref.mimeType, contentBase64: base64UrlToBase64(data) });
      }

      emails.push({
        providerMessageId: id,
        from,
        to,
        subject,
        bodyText,
        receivedAt,
        attachments,
        threadId: message.threadId,
        rfcMessageId,
        inReplyTo,
        references,
        labelIds: message.labelIds,
        autoGenerated,
        bulk,
      });
    }
    return emails;
  }

  private async getValidAccessToken(tenantId: string): Promise<string> {
    const integration = await this.prisma
      .forTenantId(tenantId)
      .integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    if (!integration?.credentialReference) {
      throw new AuthenticationExpiredError('Gmail ist für diesen Tenant nicht verbunden.');
    }

    const secret = await this.vault.readSecret(tenantId, integration.credentialReference);
    const { accessToken, refreshToken, expiresAt } = secret.value as unknown as StoredGmailSecret;

    // A 60s safety margin avoids a request starting right as the token expires mid-flight.
    if (new Date(expiresAt).getTime() > Date.now() + 60_000) {
      return accessToken;
    }
    if (!refreshToken) {
      await this.markAuthRequired(tenantId);
      throw new AuthenticationExpiredError('Gmail-Token abgelaufen und kein Refresh Token vorhanden — erneute Anmeldung nötig.');
    }

    try {
      const refreshed = await this.oauth2.refreshAccessToken(this.providerConfig, refreshToken);
      const refreshedSecret: StoredGmailSecret = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt.toISOString(),
      };
      await this.vault.updateSecret(tenantId, integration.credentialReference, { tenantId, value: refreshedSecret });
      return refreshed.accessToken;
    } catch (error) {
      await this.markAuthRequired(tenantId);
      throw error;
    }
  }

  private async markAuthRequired(tenantId: string): Promise<void> {
    await this.prisma
      .forTenantId(tenantId)
      .integration.update({
        where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } },
        data: { status: 'AUTH_REQUIRED', lastErrorAt: new Date(), lastErrorCode: 'TOKEN_REFRESH_FAILED' },
      });
  }

  private async fetchProfile(accessToken: string): Promise<{ emailAddress: string }> {
    const response = await this.gmailFetch(accessToken, '/users/me/profile');
    return (await response.json()) as { emailAddress: string };
  }

  private async gmailFetch(accessToken: string, path: string): Promise<Response> {
    const response = await fetch(`${GMAIL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      throw new ExternalSystemError(`Gmail API request failed (${response.status}): ${path}`, { status: response.status });
    }
    return response;
  }
}
