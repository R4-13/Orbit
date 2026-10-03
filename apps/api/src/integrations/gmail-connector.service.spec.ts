import { AuthenticationExpiredError, IntegrationUnavailableError } from '@orbit/shared';
import { GmailConnectorService } from './gmail-connector.service';
import { OAuth2Service } from './oauth2.service';
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
    it('signs a state token and builds the authorization URL with the readonly scope and offline+consent params', () => {
      const result = service.startConnection('tenant_1', 'user_1');

      expect(state.sign).toHaveBeenCalledWith({ tenantId: 'tenant_1', userId: 'user_1', connectorType: 'GMAIL' });
      expect(oauth2.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client_123' }),
        expect.objectContaining({
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          state: 'signed_state_token',
          accessType: 'offline',
          prompt: 'consent',
        }),
      );
      expect(result).toEqual({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?mocked=1' });
    });

    it('throws IntegrationUnavailableError when platform Google credentials are not configured', () => {
      const unconfigured = new GmailConnectorService(
        prisma as unknown as PrismaService,
        vault as unknown as CredentialVaultService,
        audit as unknown as AuditService,
        oauth2 as unknown as OAuth2Service,
        state as unknown as OAuthStateService,
        { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' } as never,
      );
      expect(() => unconfigured.startConnection('tenant_1', 'user_1')).toThrow(IntegrationUnavailableError);
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
            internalDate: '1700000000000',
            payload: {
              headers: [
                { name: 'From', value: 'sender@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Hallo' },
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
});
