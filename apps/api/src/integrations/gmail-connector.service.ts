import { Inject, Injectable } from '@nestjs/common';
import { AuthenticationExpiredError, ExternalSystemError, IntegrationUnavailableError } from '@orbit/shared';
import type { EmailAttachment, InboundEmail } from '@orbit/integration-core';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialVaultService } from '../security/credential-vault.service';
import { GMAIL_API_BASE, GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, GOOGLE_CALENDAR_API_BASE, GOOGLE_CALENDAR_FREEBUSY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_SCOPE, GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT, GOOGLE_OAUTH_REVOKE_ENDPOINT, GOOGLE_OAUTH_TOKEN_ENDPOINT } from './google-oauth.config';
import { base64UrlToBase64, extractPlainTextBody, listAttachmentRefs, parseGmailMessageHeaders, type GmailMessage } from './gmail-message-parser';
import { OAuth2Service, OAuthGrantRejectedError, type OAuth2ProviderConfig } from './oauth2.service';
import { buildRfc822Message, toBase64Url, type OutgoingMessage } from './rfc822';
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
  /** Gleichzeitige Aufrufe (Abgleich, Versand, Test) teilen sich eine Erneuerung je Mandant, statt das Refresh-Token mehrfach einzulösen. */
  private readonly refreshing = new Map<string, Promise<string>>();

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

  /**
   * Startet die Zustimmung. Bereits erteilte Berechtigungen bleiben bei einer Erneuerung erhalten: wer die Verbindung nach einem Ablauf erneuert, ohne
   * Senden oder Kalender erneut anzuhaken, verliert sie sonst unbemerkt (die Fähigkeiten werden aus dem tatsächlich gewährten Umfang abgeleitet).
   */
  async startConnection(tenantId: string, userId: string, options: { includeSend?: boolean; includeCalendar?: boolean; includeCalendarWrite?: boolean } = {}): Promise<{ authorizationUrl: string }> {
    this.assertPlatformConfigured();
    const existing = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    const had = Array.isArray(existing?.grantedCapabilities) ? (existing?.grantedCapabilities as unknown[]) : [];
    const scopes = [GMAIL_READONLY_SCOPE];
    if (options.includeSend || had.includes('email.send')) scopes.push(GMAIL_SEND_SCOPE);
    if (options.includeCalendar || had.includes('calendar.freebusy')) scopes.push(GOOGLE_CALENDAR_FREEBUSY_SCOPE);
    if (options.includeCalendarWrite || had.includes('calendar.write')) scopes.push(GOOGLE_CALENDAR_EVENTS_SCOPE);
    const state = this.state.sign({ tenantId, userId, connectorType: 'GMAIL' });
    const authorizationUrl = this.oauth2.buildAuthorizationUrl(this.providerConfig, {
      scope: scopes.join(' '),
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
    // The capability list reflects what Google actually granted (the user can untick scopes), not what was requested.
    const grantedScopes = (tokens.scope ?? GMAIL_READONLY_SCOPE).split(/\s+/).filter(Boolean);
    const grantedCapabilities = ['email.read', ...(grantedScopes.includes(GMAIL_SEND_SCOPE) ? ['email.send'] : []), ...(grantedScopes.includes(GOOGLE_CALENDAR_FREEBUSY_SCOPE) ? ['calendar.freebusy'] : []), ...(grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_SCOPE) ? ['calendar.write'] : [])];

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
        grantedCapabilities: grantedCapabilities,
        lastSuccessAt: new Date(),
      },
      update: {
        status: 'CONNECTED',
        credentialReference,
        externalAccountId: profile.emailAddress,
        externalAccountDisplayName: profile.emailAddress,
        grantedCapabilities: grantedCapabilities,
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

  /**
   * Die Kennungen der neuesten Nachrichten des Postfachs (neueste zuerst, höchstens `maxTotal`), seitenweise gelesen. Spam und Papierkorb gehören laut Gmail nicht dazu. Nur Kennungen – die Nachrichten
   * selbst holt `fetchMessages`, damit Bekanntes nicht noch einmal geladen wird.
   */
  async listMessageIds(tenantId: string, maxTotal = 100): Promise<string[]> {
    return this.idsWithToken(await this.getValidAccessToken(tenantId), maxTotal);
  }

  private async idsWithToken(accessToken: string, maxTotal: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = Math.min(100, maxTotal - ids.length);
      const response = await this.gmailFetch(accessToken, `/users/me/messages?maxResults=${page}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      const body = (await response.json()) as { messages?: { id: string }[]; nextPageToken?: string };
      ids.push(...(body.messages ?? []).map((m) => m.id));
      pageToken = body.nextPageToken;
    } while (pageToken && ids.length < maxTotal);
    return ids;
  }

  async listMessages(tenantId: string, maxResults = 10): Promise<InboundEmail[]> {
    const accessToken = await this.getValidAccessToken(tenantId);
    return this.fetchWithToken(accessToken, await this.idsWithToken(accessToken, maxResults));
  }

  /** Holt die genannten Nachrichten vollständig (Kopfzeilen, Text, Anhänge) in der Reihenfolge der Kennungen. */
  async fetchMessages(tenantId: string, ids: readonly string[]): Promise<InboundEmail[]> {
    return this.fetchWithToken(await this.getValidAccessToken(tenantId), ids);
  }

  private async fetchWithToken(accessToken: string, ids: readonly string[]): Promise<InboundEmail[]> {
    const emails: InboundEmail[] = [];
    for (const id of ids) {
      const messageResponse = await this.gmailFetch(accessToken, `/users/me/messages/${id}?format=full`);
      const message = (await messageResponse.json()) as GmailMessage;
      const { from, fromName, to, subject, receivedAt, rfcMessageId, inReplyTo, references, autoGenerated, bulk } = parseGmailMessageHeaders(message);
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
        fromName,
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

  /**
   * Sends a message through the connected mailbox (`users.messages.send`). Requires the `email.send` capability, i.e. the
   * tenant connected with the gmail.send scope. Errors are classified so the caller can tell a definite failure (the
   * provider rejected the request) from an UNKNOWN outcome (network/timeout/5xx after the request left — the mail may
   * have been sent) and must never blindly retry the latter.
   */
  async sendMessage(tenantId: string, message: Omit<OutgoingMessage, 'from'> & { threadId?: string }): Promise<{ providerMessageId: string; threadId?: string; rfcMessageId?: string; from: string }> {
    const integration = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    const granted = Array.isArray(integration?.grantedCapabilities) ? (integration?.grantedCapabilities as unknown[]) : [];
    if (!integration || !integration.externalAccountDisplayName) {
      throw new IntegrationUnavailableError('Gmail ist nicht verbunden. Die E-Mail wurde nicht gesendet. Bitte unter „Systeme & Verbindungen“ Gmail verbinden.');
    }
    if (integration.status !== 'CONNECTED') {
      throw new IntegrationUnavailableError('Die Verbindung zu Gmail ist unterbrochen (Anmeldung abgelaufen oder widerrufen). Die E-Mail wurde nicht gesendet. Bitte unter „Systeme & Verbindungen“ die Verbindung erneuern.');
    }
    if (!granted.includes('email.send')) {
      throw new IntegrationUnavailableError('Gmail ist nicht mit Sendeberechtigung verbunden. Die E-Mail wurde nicht gesendet. Bitte unter „Systeme & Verbindungen“ erneut mit der Berechtigung zum Senden verbinden.');
    }
    const from = integration.externalAccountDisplayName;
    const accessToken = await this.getValidAccessToken(tenantId);
    const raw = toBase64Url(buildRfc822Message({ ...message, from }));

    let response: Response;
    try {
      response = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw, ...(message.threadId ? { threadId: message.threadId } : {}) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new GmailSendOutcomeUnknownError('Die Anfrage an Gmail ist ohne Antwort geblieben; ob die Nachricht versendet wurde, ist ungewiss.');
    }
    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      throw new GmailSendOutcomeUnknownError(`Gmail hat mit ${response.status} geantwortet; ob die Nachricht versendet wurde, ist ungewiss.`);
    }
    if (!response.ok) {
      throw new ExternalSystemError(`Gmail hat den Versand abgelehnt (${response.status}).`, { status: response.status });
    }
    const sent = (await response.json()) as { id?: string; threadId?: string };
    if (!sent.id) throw new GmailSendOutcomeUnknownError('Gmail hat den Versand ohne Nachrichtenkennung bestätigt.');

    // Best effort: read the real RFC Message-ID so a reply can be correlated by In-Reply-To. A failure here does not undo the send.
    let rfcMessageId: string | undefined;
    try {
      const meta = await this.gmailFetch(accessToken, `/users/me/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`);
      const body = (await meta.json()) as { payload?: { headers?: Array<{ name: string; value: string }> } };
      rfcMessageId = body.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value;
    } catch {
      rfcMessageId = undefined;
    }
    return { providerMessageId: sent.id, threadId: sent.threadId, rfcMessageId, from };
  }

  /**
   * Belegte Zeiten je Kalender im angegebenen Zeitraum (Google `freebusy.query`; nur Frei/Belegt). Wirft, wenn die Berechtigung fehlt, ein Kalender nicht
   * lesbar ist oder Google nicht antwortet – nie eine „halbe“ Antwort, aus der man freie Zeiten ableiten würde.
   */
  async queryFreeBusy(tenantId: string, calendarIds: string[], from: Date, to: Date, timeZone: string): Promise<Array<{ calendarId: string; busy: Array<{ start: Date; end: Date }> }>> {
    const integration = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    const granted = Array.isArray(integration?.grantedCapabilities) ? (integration?.grantedCapabilities as unknown[]) : [];
    if (!integration || integration.status !== 'CONNECTED' || !granted.includes('calendar.freebusy')) {
      throw new IntegrationUnavailableError('Der Kalender ist nicht verbunden (Berechtigung „Verfügbarkeit lesen“ fehlt).');
    }
    const accessToken = await this.getValidAccessToken(tenantId);
    let response: Response;
    try {
      response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/freeBusy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone, items: calendarIds.map((id) => ({ id })) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ExternalSystemError('Der Kalender hat nicht geantwortet.', { transient: true });
    }
    if (!response.ok) throw new ExternalSystemError(`Der Kalender hat die Anfrage abgelehnt (${response.status}).`, { status: response.status });
    const body = (await response.json()) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason?: string }> }> };
    const perCalendar: Array<{ calendarId: string; busy: Array<{ start: Date; end: Date }> }> = [];
    for (const id of calendarIds) {
      const entry = body.calendars?.[id];
      if (!entry || (entry.errors && entry.errors.length > 0)) throw new ExternalSystemError(`Der Kalender „${id}“ ist nicht lesbar (${entry?.errors?.[0]?.reason ?? 'unbekannt'}).`, { calendarId: id });
      perCalendar.push({ calendarId: id, busy: (entry.busy ?? []).map((interval) => ({ start: new Date(interval.start), end: new Date(interval.end) })) });
    }
    return perCalendar;
  }

  /**
   * Legt einen Termin im Kalender an (Google `events.insert`). Die Kennung wird vom Aufrufer vorgegeben (stabil je Vorgang und Termin): Wiederholt ORBIT den Aufruf
   * (Neustart, Wiederholung), antwortet Google mit 409 und es entsteht kein zweiter Termin. Es werden bewusst keine Gäste eingeladen und keine Benachrichtigungen
   * von Google versendet (`sendUpdates=none`) – die Bestätigung an die Kundschaft ist eine eigene, geregelte Nachricht.
   */
  async createCalendarEvent(
    tenantId: string,
    input: { calendarId: string; eventId: string; summary: string; description?: string; start: Date; end: Date; timeZone: string },
  ): Promise<{ eventId: string; htmlLink?: string; alreadyExisted: boolean }> {
    const integration = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    const granted = Array.isArray(integration?.grantedCapabilities) ? (integration?.grantedCapabilities as unknown[]) : [];
    if (!integration || integration.status !== 'CONNECTED' || !granted.includes('calendar.write')) {
      throw new IntegrationUnavailableError('Der Kalender ist nicht zum Anlegen von Terminen freigegeben (Berechtigung „Termine anlegen“ fehlt).');
    }
    if (!/^[a-v0-9]{5,200}$/.test(input.eventId)) throw new ExternalSystemError('Ungültige Termin-Kennung.', { eventId: input.eventId });
    const accessToken = await this.getValidAccessToken(tenantId);
    let response: Response;
    try {
      response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=none`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: input.eventId,
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Ob Google den Termin angelegt hat, ist unbekannt – der Aufrufer behandelt das als ungewiss und prüft, statt blind zu wiederholen.
      throw new GmailSendOutcomeUnknownError('Der Kalender hat nicht geantwortet; ob der Termin angelegt wurde, ist ungewiss.');
    }
    if (response.status === 409) return { eventId: input.eventId, alreadyExisted: true };
    if (!response.ok) throw new ExternalSystemError(`Der Kalender hat das Anlegen abgelehnt (${response.status}).`, { status: response.status });
    const body = (await response.json()) as { id?: string; htmlLink?: string };
    return { eventId: body.id ?? input.eventId, htmlLink: body.htmlLink, alreadyExisted: false };
  }

  /**
   * Liest einen Termin zurück (Google `events.get`): Rücklesung der Wirkung (FX-08). Gibt `undefined` zurück, wenn der Termin nicht (mehr) existiert.
   */
  async getCalendarEvent(tenantId: string, input: { calendarId: string; eventId: string }): Promise<{ eventId: string; status: string; start?: Date; end?: Date } | undefined> {
    const integration = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    if (!integration || integration.status !== 'CONNECTED') throw new IntegrationUnavailableError('Der Kalender ist nicht verbunden.');
    const accessToken = await this.getValidAccessToken(tenantId);
    let response: Response;
    try {
      response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ExternalSystemError('Der Kalender hat nicht geantwortet.', { calendarId: input.calendarId });
    }
    if (response.status === 404 || response.status === 410) return undefined;
    if (!response.ok) throw new ExternalSystemError(`Der Kalender hat die Rücklesung abgelehnt (${response.status}).`, { status: response.status });
    const body = (await response.json()) as { id?: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } };
    return { eventId: body.id ?? input.eventId, status: body.status ?? 'confirmed', start: body.start?.dateTime ? new Date(body.start.dateTime) : undefined, end: body.end?.dateTime ? new Date(body.end.dateTime) : undefined };
  }

  private async getValidAccessToken(tenantId: string): Promise<string> {
    const inFlight = this.refreshing.get(tenantId);
    if (inFlight) return inFlight;
    const pending = this.resolveAccessToken(tenantId).finally(() => this.refreshing.delete(tenantId));
    this.refreshing.set(tenantId, pending);
    return pending;
  }

  private async resolveAccessToken(tenantId: string): Promise<string> {
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
      await this.markAuthRequired(tenantId, 'NO_REFRESH_TOKEN');
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
      // Eine frühere Störung ist behoben: Status und Fehlerspur zurücksetzen (nur wenn tatsächlich etwas zurückzusetzen ist).
      if (integration.status !== 'CONNECTED' || integration.lastErrorCode) {
        await this.prisma
          .forTenantId(tenantId)
          .integration.update({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } }, data: { status: 'CONNECTED', lastErrorAt: null, lastErrorCode: null, lastSuccessAt: new Date() } });
      }
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof OAuthGrantRejectedError) {
        // Endgültig: nur eine neue Zustimmung hilft. Erst jetzt gilt die Verbindung als unterbrochen.
        await this.markAuthRequired(tenantId, error.oauthError === 'invalid_grant' ? 'GRANT_REVOKED_OR_EXPIRED' : 'CLIENT_REJECTED');
      } else {
        // Vorübergehend (Netzwerk, 5xx, 429): die Verbindung bleibt bestehen, der nächste Abgleich versucht es erneut.
        await this.prisma
          .forTenantId(tenantId)
          .integration.update({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } }, data: { lastErrorAt: new Date(), lastErrorCode: 'TOKEN_REFRESH_TRANSIENT' } })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Selbstheilung für Verbindungen, die früher wegen eines nur vorübergehenden Fehlers als „abgemeldet“ markiert wurden (Code `TOKEN_REFRESH_FAILED`):
   * ein einmaliger Erneuerungsversuch stellt sie wieder her, ohne dass die Person neu zustimmen muss. Endgültig widerrufene Verbindungen bleiben
   * unterbrochen (Code `GRANT_REVOKED_OR_EXPIRED`) – dort versucht nichts erneut, bis die Person sie erneuert.
   */
  async attemptRecovery(tenantId: string): Promise<boolean> {
    const integration = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    if (!integration || integration.status !== 'AUTH_REQUIRED' || integration.lastErrorCode !== 'TOKEN_REFRESH_FAILED' || !integration.credentialReference) return false;
    // Höchstens ein Versuch je 30 Minuten.
    if (integration.lastTestedAt && Date.now() - integration.lastTestedAt.getTime() < 30 * 60_000) return false;
    await this.prisma.forTenantId(tenantId).integration.update({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } }, data: { lastTestedAt: new Date() } });
    try {
      // Zeitpunkt der Gültigkeit überspringen: bewusst echte Erneuerung erzwingen.
      const secret = await this.vault.readSecret(tenantId, integration.credentialReference);
      const { refreshToken } = secret.value as unknown as StoredGmailSecret;
      if (!refreshToken) return false;
      const refreshed = await this.oauth2.refreshAccessToken(this.providerConfig, refreshToken);
      await this.vault.updateSecret(tenantId, integration.credentialReference, { tenantId, value: { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt.toISOString() } });
      await this.prisma.forTenantId(tenantId).integration.update({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } }, data: { status: 'CONNECTED', lastErrorAt: null, lastErrorCode: null, lastSuccessAt: new Date() } });
      await this.audit.record({ tenantId, eventType: 'INTEGRATION_RECOVERED', actorType: 'SYSTEM', entityType: 'Integration', entityId: 'GMAIL', payload: { connectorType: 'GMAIL', via: 'AUTOMATIC_TOKEN_REFRESH' } });
      return true;
    } catch (error) {
      if (error instanceof OAuthGrantRejectedError) {
        await this.prisma.forTenantId(tenantId).integration.update({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } }, data: { lastErrorCode: error.oauthError === 'invalid_grant' ? 'GRANT_REVOKED_OR_EXPIRED' : 'CLIENT_REJECTED' } });
      }
      return false;
    }
  }

  private async markAuthRequired(tenantId: string, code: string): Promise<void> {
    await this.prisma
      .forTenantId(tenantId)
      .integration.update({
        where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } },
        data: { status: 'AUTH_REQUIRED', lastErrorAt: new Date(), lastErrorCode: code },
      });
    await this.audit.record({ tenantId, eventType: 'INTEGRATION_AUTH_REQUIRED', actorType: 'SYSTEM', entityType: 'Integration', entityId: 'GMAIL', payload: { connectorType: 'GMAIL', reason: code } }).catch(() => undefined);
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

/** The send request may or may not have reached the mailbox — the caller records OUTCOME_UNKNOWN and reconciles. */
export class GmailSendOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailSendOutcomeUnknownError';
  }
}
