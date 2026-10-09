import { AuthenticationExpiredError, IntegrationUnavailableError } from '@orbit/shared';
import { GmailConnectorService } from './gmail-connector.service';
import { ExternalSystemError } from '@orbit/shared';
import { OAuth2Service, OAuthGrantRejectedError } from './oauth2.service';
import { OAuthStateService } from './oauth-state.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialVaultService } from '../security/credential-vault.service';

describe('GmailConnectorService', () => {
  let service: GmailConnectorService;
  let scopedIntegration: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  let prisma: { forTenantId: jest.Mock };
  let vault: { storeSecret: jest.Mock; readSecret: jest.Mock; updateSecret: jest.Mock; deleteSecret: jest.Mock };
  let audit: { record: jest.Mock };
  let oauth2: { buildAuthorizationUrl: jest.Mock; exchangeCodeForTokens: jest.Mock; refreshAccessToken: jest.Mock; revokeToken: jest.Mock };
  let state: { sign: jest.Mock; verify: jest.Mock };
  let fetchMock: jest.Mock;
  const env = { GOOGLE_CLIENT_ID: 'client_123', GOOGLE_CLIENT_SECRET: 'secret_456', GOOGLE_REDIRECT_URI: 'https://orbit.example/callback' };

  beforeEach(() => {
    scopedIntegration = { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() };
    prisma = { forTenantId: jest.fn().mockReturnValue({ integration: scopedIntegration }) };
    vault = { storeSecret: jest.fn(), readSecret: jest.fn(), updateSecret: jest.fn(), deleteSecret: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    oauth2 = {
      buildAuthorizationUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mocked=1'),
      exchangeCodeForTokens: jest.fn(),
      refreshAccessToken: jest.fn(),
      revokeToken: jest.fn().mockResolvedValue(undefined),
    };
    state = { sign: jest.fn().mockReturnValue('signed_state_token'), verify: jest.fn() };
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    service = new GmailConnectorService(
      prisma as unknown as PrismaService,
      vault as unknown as CredentialVaultService,
      audit as unknown as AuditService,
      oauth2 as unknown as OAuth2Service,
      state as unknown as OAuthStateService,
      env as never,
    );
  });

  describe('startConnection', () => {
    beforeEach(() => scopedIntegration.findUnique.mockResolvedValue(null));
    const READ = 'https://www.googleapis.com/auth/gmail.readonly';
    const SEND = 'https://www.googleapis.com/auth/gmail.send';
    const CAL = 'https://www.googleapis.com/auth/calendar.freebusy';
    const scopeOf = () => (oauth2.buildAuthorizationUrl.mock.calls[0] as [unknown, { scope: string }])[1].scope;

    it('signs a state token and builds the authorization URL with the readonly scope and offline+consent params', async () => {
      const result = await service.startConnection('tenant_1', 'user_1');

      expect(state.sign).toHaveBeenCalledWith({ tenantId: 'tenant_1', userId: 'user_1', connectorType: 'GMAIL' });
      expect(oauth2.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client_123' }),
        expect.objectContaining({ scope: READ, state: 'signed_state_token', accessType: 'offline', prompt: 'consent' }),
      );
      expect(result).toEqual({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?mocked=1' });
    });

    it('fordert Senden und Kalender-Verfügbarkeit nur auf ausdrücklichen Wunsch an', async () => {
      await service.startConnection('tenant_1', 'user_1', { includeSend: true, includeCalendar: true });
      expect(scopeOf().split(' ')).toEqual([READ, SEND, CAL]);
    });

    it('eine Erneuerung behält bereits erteilte Berechtigungen – wer nichts anhakt, verliert Senden und Kalender nicht', async () => {
      scopedIntegration.findUnique.mockResolvedValue({ grantedCapabilities: ['email.read', 'email.send', 'calendar.freebusy'] });
      await service.startConnection('tenant_1', 'user_1');
      expect(scopeOf().split(' ')).toEqual([READ, SEND, CAL]);
    });

    it('throws IntegrationUnavailableError when platform Google credentials are not configured', async () => {
      const unconfigured = new GmailConnectorService(
        prisma as unknown as PrismaService,
        vault as unknown as CredentialVaultService,
        audit as unknown as AuditService,
        oauth2 as unknown as OAuth2Service,
        state as unknown as OAuthStateService,
        { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' } as never,
      );
      await expect(unconfigured.startConnection('tenant_1', 'user_1')).rejects.toThrow(IntegrationUnavailableError);
    });
  });

  describe('completeConnection', () => {
    beforeEach(() => {
      state.verify.mockReturnValue({ tenantId: 'tenant_1', userId: 'user_1', connectorType: 'GMAIL' });
      oauth2.exchangeCodeForTokens.mockResolvedValue({ accessToken: 'at_1', refreshToken: 'rt_1', expiresAt: new Date('2026-01-01T00:00:00Z') });
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ emailAddress: 'nutzer@example.com' }) });
    });

    it('stores a new vault secret (no existing connection) and upserts the Integration row as CONNECTED with the dynamically-fetched account', async () => {
      scopedIntegration.findUnique.mockResolvedValue(null);
      vault.storeSecret.mockResolvedValue('secret_new');
      scopedIntegration.upsert.mockResolvedValue({});

      const result = await service.completeConnection('auth_code', 'signed_state_token');

      expect(state.verify).toHaveBeenCalledWith('signed_state_token');
      expect(vault.storeSecret).toHaveBeenCalledWith({
        tenantId: 'tenant_1',
        value: { accessToken: 'at_1', refreshToken: 'rt_1', expiresAt: '2026-01-01T00:00:00.000Z' },
      });
      expect(vault.updateSecret).not.toHaveBeenCalled();
      const upsertArgs = scopedIntegration.upsert.mock.calls[0][0];
      expect(upsertArgs.create).toMatchObject({
        connectorType: 'GMAIL',
        status: 'CONNECTED',
        credentialReference: 'secret_new',
        externalAccountId: 'nutzer@example.com',
        externalAccountDisplayName: 'nutzer@example.com',
        grantedCapabilities: ['email.read'],
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'INTEGRATION_CONNECTED' }));
      expect(result).toEqual({ tenantId: 'tenant_1', externalAccountDisplayName: 'nutzer@example.com' });
    });

    it('erkennt die gewährte Sendeberechtigung aus der echten, durch Leerzeichen getrennten Scope-Liste von Google', async () => {
      state.verify.mockReturnValue({ tenantId: 'tenant_1', userId: 'user_1' });
      oauth2.exchangeCodeForTokens.mockResolvedValue({
        accessToken: 'at_1',
        refreshToken: 'rt_1',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
      });
      scopedIntegration.findUnique.mockResolvedValue(null);
      vault.storeSecret.mockResolvedValue('secret_1');
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ emailAddress: 'me@example.com' }) });

      await service.completeConnection('code', 'state');

      expect(scopedIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ grantedCapabilities: ['email.read', 'email.send'] }) }));
    });

    it('erkennt die Kalender-Berechtigung (Verfügbarkeit lesen) als Fähigkeit', async () => {
      state.verify.mockReturnValue({ tenantId: 'tenant_1', userId: 'user_1' });
      oauth2.exchangeCodeForTokens.mockResolvedValue({
        accessToken: 'at_1',
        refreshToken: 'rt_1',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.freebusy',
      });
      scopedIntegration.findUnique.mockResolvedValue(null);
      vault.storeSecret.mockResolvedValue('secret_1');
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ emailAddress: 'me@example.com' }) });

      await service.completeConnection('code', 'state');

      expect(scopedIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ grantedCapabilities: ['email.read', 'calendar.freebusy'] }) }));
    });

    it('updates the existing vault secret in place on a reconnect, instead of creating a second one', async () => {
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_existing' });
      scopedIntegration.upsert.mockResolvedValue({});

      await service.completeConnection('auth_code', 'signed_state_token');

      expect(vault.updateSecret).toHaveBeenCalledWith('tenant_1', 'secret_existing', {
        tenantId: 'tenant_1',
        value: { accessToken: 'at_1', refreshToken: 'rt_1', expiresAt: '2026-01-01T00:00:00.000Z' },
      });
      expect(vault.storeSecret).not.toHaveBeenCalled();
      const upsertArgs = scopedIntegration.upsert.mock.calls[0][0];
      expect(upsertArgs.update.credentialReference).toBe('secret_existing');
    });
  });

  describe('testConnection', () => {
    beforeEach(() => {
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_1' });
      vault.readSecret.mockResolvedValue({ value: { accessToken: 'at_1', refreshToken: 'rt_1', expiresAt: '2099-01-01T00:00:00.000Z' } });
    });

    it('returns true and records OK on a successful profile fetch', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ emailAddress: 'x@example.com' }) });

      const result = await service.testConnection('tenant_1');

      expect(result).toBe(true);
      expect(scopedIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastTestStatus: 'OK' }) }),
      );
    });

    it('returns false and records FAILED when the Gmail API call fails', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });

      const result = await service.testConnection('tenant_1');

      expect(result).toBe(false);
      expect(scopedIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastTestStatus: 'FAILED' }) }),
      );
    });

    it('transparently refreshes an expired access token before testing, and persists the refreshed token', async () => {
      vault.readSecret.mockResolvedValue({ value: { accessToken: 'at_old', refreshToken: 'rt_1', expiresAt: '2000-01-01T00:00:00.000Z' } });
      oauth2.refreshAccessToken.mockResolvedValue({ accessToken: 'at_refreshed', refreshToken: 'rt_1', expiresAt: new Date('2099-01-01T00:00:00Z') });
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ emailAddress: 'x@example.com' }) });

      await service.testConnection('tenant_1');

      expect(oauth2.refreshAccessToken).toHaveBeenCalledWith(expect.anything(), 'rt_1');
      expect(vault.updateSecret).toHaveBeenCalledWith('tenant_1', 'secret_1', {
        tenantId: 'tenant_1',
        value: { accessToken: 'at_refreshed', refreshToken: 'rt_1', expiresAt: '2099-01-01T00:00:00.000Z' },
      });
      expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ headers: { Authorization: 'Bearer at_refreshed' } }));
    });

    it('marks the integration AUTH_REQUIRED and fails when the token is expired with no refresh token available', async () => {
      vault.readSecret.mockResolvedValue({ value: { accessToken: 'at_old', expiresAt: '2000-01-01T00:00:00.000Z' } });

      const result = await service.testConnection('tenant_1');

      expect(result).toBe(false);
      expect(scopedIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AUTH_REQUIRED' }) }));
    });

    it('throws AuthenticationExpiredError from getValidAccessToken when the connector was never connected (surfaced via listMessages)', async () => {
      scopedIntegration.findUnique.mockResolvedValue(null);
      await expect(service.listMessages('tenant_1')).rejects.toThrow(AuthenticationExpiredError);
    });

    it('returns false without attempting a DB update when testing a tenant that never connected at all (no Integration row exists to update)', async () => {
      scopedIntegration.findUnique.mockResolvedValue(null);
      const result = await service.testConnection('tenant_1');
      expect(result).toBe(false);
      expect(scopedIntegration.update).not.toHaveBeenCalled();
    });
  });

  describe('Verbindung bleibt bestehen (Token-Erneuerung)', () => {
    const expired = { accessToken: 'at_old', refreshToken: 'rt_1', expiresAt: '2000-01-01T00:00:00.000Z' };
    beforeEach(() => {
      scopedIntegration.update.mockResolvedValue({});
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_1', status: 'CONNECTED', lastErrorCode: null });
      vault.readSecret.mockResolvedValue({ value: expired });
    });
    const statusUpdates = () => scopedIntegration.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data).filter((d) => 'status' in d);

    it('ein vorübergehender Fehler (Netzwerk, 5xx, 429) setzt die Verbindung NICHT auf „Anmeldung erforderlich“ – sie bleibt verbunden und wird beim nächsten Abgleich erneut versucht', async () => {
      oauth2.refreshAccessToken.mockRejectedValue(new ExternalSystemError('OAuth token refresh failed (503).', { transient: true }));

      await expect(service.listMessages('tenant_1')).rejects.toThrow(ExternalSystemError);

      expect(statusUpdates()).toEqual([]);
      expect(scopedIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastErrorCode: 'TOKEN_REFRESH_TRANSIENT' }) }));
    });

    it('nur eine endgültige Ablehnung (invalid_grant: widerrufen oder abgelaufen) markiert die Verbindung als unterbrochen – mit benanntem Grund und Audit', async () => {
      oauth2.refreshAccessToken.mockRejectedValue(new OAuthGrantRejectedError('rejected', 'invalid_grant'));

      await expect(service.listMessages('tenant_1')).rejects.toThrow(OAuthGrantRejectedError);

      expect(scopedIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AUTH_REQUIRED', lastErrorCode: 'GRANT_REVOKED_OR_EXPIRED' }) }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'INTEGRATION_AUTH_REQUIRED', payload: expect.objectContaining({ reason: 'GRANT_REVOKED_OR_EXPIRED' }) }));
    });

    it('gleichzeitige Aufrufe teilen sich EINE Erneuerung, statt das Refresh-Token mehrfach einzulösen', async () => {
      let release!: (value: unknown) => void;
      oauth2.refreshAccessToken.mockReturnValue(new Promise((resolve) => (release = resolve)));
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ emailAddress: 'x@example.com', messages: [] }) });

      const calls = [service.listMessages('tenant_1'), service.listMessages('tenant_1'), service.listMessages('tenant_1')];
      await new Promise((r) => setImmediate(r));
      release({ accessToken: 'at_new', refreshToken: 'rt_1', expiresAt: new Date('2099-01-01T00:00:00Z') });
      await Promise.all(calls);

      expect(oauth2.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it('eine erfolgreiche Erneuerung heilt eine frühere Störung: Status wieder verbunden, Fehlerspur gelöscht', async () => {
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_1', status: 'CONNECTED', lastErrorCode: 'TOKEN_REFRESH_TRANSIENT' });
      oauth2.refreshAccessToken.mockResolvedValue({ accessToken: 'at_new', refreshToken: 'rt_1', expiresAt: new Date('2099-01-01T00:00:00Z') });
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });

      await service.listMessages('tenant_1');

      expect(scopedIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONNECTED', lastErrorCode: null }) }));
    });
  });

  describe('attemptRecovery (früher fälschlich abgemeldete Verbindungen)', () => {
    const stuck = { credentialReference: 'secret_1', status: 'AUTH_REQUIRED', lastErrorCode: 'TOKEN_REFRESH_FAILED', lastTestedAt: null };
    beforeEach(() => vault.readSecret.mockResolvedValue({ value: { accessToken: 'at_old', refreshToken: 'rt_1', expiresAt: '2000-01-01T00:00:00.000Z' } }));

    it('stellt die Verbindung wieder her, wenn das Refresh-Token noch gilt – ohne neue Zustimmung', async () => {
      scopedIntegration.findUnique.mockResolvedValue(stuck);
      oauth2.refreshAccessToken.mockResolvedValue({ accessToken: 'at_new', refreshToken: 'rt_1', expiresAt: new Date('2099-01-01T00:00:00Z') });

      expect(await service.attemptRecovery('tenant_1')).toBe(true);

      expect(scopedIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONNECTED', lastErrorCode: null }) }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'INTEGRATION_RECOVERED' }));
    });

    it('lässt eine endgültig widerrufene Verbindung unterbrochen und merkt sich den Grund (kein Dauerfeuer)', async () => {
      scopedIntegration.findUnique.mockResolvedValue(stuck);
      oauth2.refreshAccessToken.mockRejectedValue(new OAuthGrantRejectedError('rejected', 'invalid_grant'));

      expect(await service.attemptRecovery('tenant_1')).toBe(false);

      expect(scopedIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastErrorCode: 'GRANT_REVOKED_OR_EXPIRED' } }));
    });

    it('versucht es nicht, wenn die Verbindung endgültig unterbrochen ist oder zuletzt vor kurzem versucht wurde', async () => {
      scopedIntegration.findUnique.mockResolvedValue({ ...stuck, lastErrorCode: 'GRANT_REVOKED_OR_EXPIRED' });
      expect(await service.attemptRecovery('tenant_1')).toBe(false);
      scopedIntegration.findUnique.mockResolvedValue({ ...stuck, lastTestedAt: new Date() });
      expect(await service.attemptRecovery('tenant_1')).toBe(false);
      expect(oauth2.refreshAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('queryFreeBusy (Kalender-Verfügbarkeit)', () => {
    const from = new Date('2026-10-12T00:00:00Z');
    const to = new Date('2026-10-26T00:00:00Z');
    beforeEach(() => {
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_1', status: 'CONNECTED', grantedCapabilities: ['email.read', 'calendar.freebusy'], lastErrorCode: null });
      vault.readSecret.mockResolvedValue({ value: { accessToken: 'at_1', refreshToken: 'rt_1', expiresAt: '2099-01-01T00:00:00.000Z' } });
    });

    it('fragt die offizielle freeBusy-Schnittstelle ab und liefert die belegten Zeiten je Kalender', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ calendars: { primary: { busy: [{ start: '2026-10-13T08:00:00Z', end: '2026-10-13T09:00:00Z' }] }, 'monteur@example.com': { busy: [] } } }) });

      const busy = await service.queryFreeBusy('tenant_1', ['primary', 'monteur@example.com'], from, to, 'Europe/Berlin');

      expect(busy).toEqual([
        { calendarId: 'primary', busy: [{ start: new Date('2026-10-13T08:00:00Z'), end: new Date('2026-10-13T09:00:00Z') }] },
        { calendarId: 'monteur@example.com', busy: [] },
      ]);
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer at_1');
      expect(JSON.parse(init.body)).toEqual({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: 'Europe/Berlin', items: [{ id: 'primary' }, { id: 'monteur@example.com' }] });
    });

    it('ohne Berechtigung Verfügbarkeit lesen wird nichts abgefragt', async () => {
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_1', status: 'CONNECTED', grantedCapabilities: ['email.read'] });
      await expect(service.queryFreeBusy('tenant_1', ['primary'], from, to, 'Europe/Berlin')).rejects.toThrow(IntegrationUnavailableError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ein nicht lesbarer Kalender oder ein Fehler ergibt nie eine halbe Antwort, aus der man freie Zeiten ableiten würde', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ calendars: { primary: { busy: [] }, 'monteur@example.com': { errors: [{ reason: 'notFound' }] } } }) });
      await expect(service.queryFreeBusy('tenant_1', ['primary', 'monteur@example.com'], from, to, 'Europe/Berlin')).rejects.toThrow(/monteur@example.com.*notFound/);
      fetchMock.mockResolvedValue({ ok: false, status: 403 });
      await expect(service.queryFreeBusy('tenant_1', ['primary'], from, to, 'Europe/Berlin')).rejects.toThrow(ExternalSystemError);
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(service.queryFreeBusy('tenant_1', ['primary'], from, to, 'Europe/Berlin')).rejects.toThrow(ExternalSystemError);
    });
  });

  describe('listMessages', () => {
    beforeEach(() => {
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_1' });
      vault.readSecret.mockResolvedValue({ value: { accessToken: 'at_1', expiresAt: '2099-01-01T00:00:00.000Z' } });
    });

    it('lists messages, fetches each one, and maps headers/body into InboundEmail shape', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'msg_1' }] }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'msg_1',
            threadId: 'thread_9',
            labelIds: ['INBOX'],
            internalDate: '1700000000000',
            payload: {
              headers: [
                { name: 'From', value: 'sender@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Hallo' },
                { name: 'Message-ID', value: '<m1@mail.example>' },
                { name: 'In-Reply-To', value: '<m0@mail.example>' },
                { name: 'References', value: '<m0@mail.example>' },
              ],
              mimeType: 'text/plain',
              body: { data: Buffer.from('Hallo Welt').toString('base64').replace(/\+/g, '-').replace(/\//g, '_') },
            },
          }),
        });

      const emails = await service.listMessages('tenant_1', 10);

      expect(emails).toEqual([
        {
          providerMessageId: 'msg_1',
          from: 'sender@example.com',
          to: ['me@example.com'],
          subject: 'Hallo',
          bodyText: 'Hallo Welt',
          receivedAt: new Date(1700000000000),
          attachments: [],
          // Amendment 02 §13.1 — thread data and RFC 5322 headers travel with the message for case correlation.
          threadId: 'thread_9',
          rfcMessageId: '<m1@mail.example>',
          inReplyTo: '<m0@mail.example>',
          references: ['<m0@mail.example>'],
          labelIds: ['INBOX'],
          autoGenerated: false,
          bulk: false,
        },
      ]);
    });

    it('fetches attachment bytes for messages that have them', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'msg_1' }] }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'msg_1',
            payload: {
              headers: [],
              mimeType: 'multipart/mixed',
              parts: [{ mimeType: 'application/pdf', filename: 'rechnung.pdf', body: { attachmentId: 'att_1' } }],
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: 'YXR0YWNobWVudC1ieXRlcw' }) });

      const emails = await service.listMessages('tenant_1', 10);

      expect(emails[0]!.attachments).toEqual([{ fileName: 'rechnung.pdf', mimeType: 'application/pdf', contentBase64: 'YXR0YWNobWVudC1ieXRlcw' }]);
    });

    it('returns an empty array when the mailbox has no messages, without calling messages.get', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }) });
      const emails = await service.listMessages('tenant_1');
      expect(emails).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeAtProvider', () => {
    it('reads the stored access token and revokes it at the provider', async () => {
      scopedIntegration.findUnique.mockResolvedValue({ credentialReference: 'secret_1' });
      vault.readSecret.mockResolvedValue({ value: { accessToken: 'at_1' } });

      await service.revokeAtProvider('tenant_1');

      expect(oauth2.revokeToken).toHaveBeenCalledWith(expect.anything(), 'at_1');
    });

    it('is a no-op when the tenant never connected Gmail', async () => {
      scopedIntegration.findUnique.mockResolvedValue(null);
      await service.revokeAtProvider('tenant_1');
      expect(oauth2.revokeToken).not.toHaveBeenCalled();
    });
  });

  describe("sendMessage (reference process)", () => {
    const connected = { status: "CONNECTED", credentialReference: "ref_1", externalAccountDisplayName: "firma@example.com", grantedCapabilities: ["email.read", "email.send"] };
    const message = { to: "kunde@kunde.example", subject: "Rückfrage", bodyText: "Hallo", threadId: "thread_9", inReplyTo: "<orig@mail.example>" };
    const tokenOk = () => vault.readSecret.mockResolvedValue({ value: { accessToken: "tok", refreshToken: "r", expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });

    it("Versand bei unterbrochener Verbindung: verständliche Meldung, nichts wird gesendet", async () => {
      scopedIntegration.findUnique.mockResolvedValue({ status: 'AUTH_REQUIRED', grantedCapabilities: ['email.read', 'email.send'], externalAccountDisplayName: 'me@example.com' });
      await expect(service.sendMessage('tenant_1', { to: 'a@example.com', subject: 'S', bodyText: 'B' })).rejects.toThrow(/Verbindung zu Gmail ist unterbrochen.*nicht gesendet/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses to send without the send capability (read-only connection)", async () => {
      scopedIntegration.findUnique.mockResolvedValue({ ...connected, grantedCapabilities: ["email.read"] });
      await expect(service.sendMessage("tenant_1", message)).rejects.toThrow(IntegrationUnavailableError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends the raw RFC 822 message into the thread and reads the real Message-ID back", async () => {
      scopedIntegration.findUnique.mockResolvedValue(connected);
      tokenOk();
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "gm_1", threadId: "thread_9" }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ payload: { headers: [{ name: "Message-ID", value: "<sent-1@mail.gmail.com>" }] } }) });

      const result = await service.sendMessage("tenant_1", message);

      expect(result).toEqual({ providerMessageId: "gm_1", threadId: "thread_9", rfcMessageId: "<sent-1@mail.gmail.com>", from: "firma@example.com" });
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
      expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      expect(init.headers.Authorization).toBe("Bearer tok");
      const body = JSON.parse(init.body) as { raw: string; threadId: string };
      expect(body.threadId).toBe("thread_9");
      const decoded = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      expect(decoded).toContain("From: firma@example.com");
      expect(decoded).toContain("In-Reply-To: <orig@mail.example>");
    });

    it("classifies a 5xx, a timeout and a missing id as UNKNOWN, and a 4xx as a definite rejection", async () => {
      scopedIntegration.findUnique.mockResolvedValue(connected);
      tokenOk();
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
      await expect(service.sendMessage("tenant_1", message)).rejects.toMatchObject({ name: "GmailSendOutcomeUnknownError" });
      fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
      await expect(service.sendMessage("tenant_1", message)).rejects.toMatchObject({ name: "GmailSendOutcomeUnknownError" });
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await expect(service.sendMessage("tenant_1", message)).rejects.toMatchObject({ name: "GmailSendOutcomeUnknownError" });
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
      await expect(service.sendMessage("tenant_1", message)).rejects.toMatchObject({ name: "ExternalSystemError" });
    });

    it("keeps a successful send successful even if reading the Message-ID back fails", async () => {
      scopedIntegration.findUnique.mockResolvedValue(connected);
      tokenOk();
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "gm_2", threadId: "t" }) }).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
      await expect(service.sendMessage("tenant_1", message)).resolves.toMatchObject({ providerMessageId: "gm_2", rfcMessageId: undefined });
    });
  });
});
