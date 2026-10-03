import { ExternalSystemError } from '@orbit/shared';
import { OAuth2Service, type OAuth2ProviderConfig } from './oauth2.service';

describe('OAuth2Service', () => {
  let service: OAuth2Service;
  let fetchMock: jest.Mock;
  const config: OAuth2ProviderConfig = {
    authorizationEndpoint: 'https://provider.example/authorize',
    tokenEndpoint: 'https://provider.example/token',
    revokeEndpoint: 'https://provider.example/revoke',
    clientId: 'client_123',
    clientSecret: 'secret_456',
    redirectUri: 'https://orbit.example/callback',
  };

  beforeEach(() => {
    service = new OAuth2Service();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('buildAuthorizationUrl', () => {
    it('builds the authorization URL with all required RFC 6749 query parameters', () => {
      const url = new URL(
        service.buildAuthorizationUrl(config, { scope: 'read write', state: 'state_abc', accessType: 'offline', prompt: 'consent' }),
      );

      expect(url.origin + url.pathname).toBe('https://provider.example/authorize');
      expect(url.searchParams.get('client_id')).toBe('client_123');
      expect(url.searchParams.get('redirect_uri')).toBe('https://orbit.example/callback');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('read write');
      expect(url.searchParams.get('state')).toBe('state_abc');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
    });

    it('omits access_type/prompt entirely when not provided, rather than sending empty values', () => {
      const url = new URL(service.buildAuthorizationUrl(config, { scope: 'read', state: 's' }));
      expect(url.searchParams.has('access_type')).toBe(false);
      expect(url.searchParams.has('prompt')).toBe(false);
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('POSTs the authorization_code grant with the correct body and parses the response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'at_1', refresh_token: 'rt_1', expires_in: 3600, scope: 'read', token_type: 'Bearer' }),
      });

      const before = Date.now();
      const tokens = await service.exchangeCodeForTokens(config, 'auth_code_xyz');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://provider.example/token',
        expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
      );
      const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth_code_xyz');
      expect(body.get('client_id')).toBe('client_123');
      expect(body.get('client_secret')).toBe('secret_456');
      expect(body.get('redirect_uri')).toBe('https://orbit.example/callback');

      expect(tokens.accessToken).toBe('at_1');
      expect(tokens.refreshToken).toBe('rt_1');
      expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600_000);
    });

    it('throws ExternalSystemError on a non-2xx response instead of returning a bogus token', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' });
      await expect(service.exchangeCodeForTokens(config, 'bad_code')).rejects.toThrow(ExternalSystemError);
    });
  });

  describe('refreshAccessToken', () => {
    it('POSTs the refresh_token grant and keeps the existing refresh token when the response omits one (Google behavior)', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at_new', expires_in: 3600 }) });

      const tokens = await service.refreshAccessToken(config, 'rt_existing');

      const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('rt_existing');
      expect(tokens.accessToken).toBe('at_new');
      expect(tokens.refreshToken).toBe('rt_existing');
    });

    it('throws ExternalSystemError on a non-2xx response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' });
      await expect(service.refreshAccessToken(config, 'rt_bad')).rejects.toThrow(ExternalSystemError);
    });
  });

  describe('revokeToken', () => {
    it('POSTs to the revoke endpoint', async () => {
      fetchMock.mockResolvedValue({ ok: true });
      await service.revokeToken(config, 'at_to_revoke');
      expect(fetchMock).toHaveBeenCalledWith('https://provider.example/revoke', expect.objectContaining({ method: 'POST' }));
    });

    it('does not throw on a non-2xx response — revocation is best-effort', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400 });
      await expect(service.revokeToken(config, 'at_already_invalid')).resolves.toBeUndefined();
    });

    it('is a no-op when the provider has no revokeEndpoint configured', async () => {
      await service.revokeToken({ ...config, revokeEndpoint: undefined }, 'at_x');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
