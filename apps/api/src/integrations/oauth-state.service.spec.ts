import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuthStateService } from './oauth-state.service';

describe('OAuthStateService', () => {
  const jwt = new JwtService({ secret: 'test-secret-at-least-32-bytes-long' });
  const service = new OAuthStateService(jwt);

  it('signs and verifies a round trip, recovering the exact payload', () => {
    const state = service.sign({ tenantId: 'tenant_1', userId: 'user_1', connectorType: 'GMAIL' });
    expect(service.verify(state)).toEqual({ tenantId: 'tenant_1', userId: 'user_1', connectorType: 'GMAIL' });
  });

  it('rejects a token signed with a different secret (forged state)', () => {
    const otherJwt = new JwtService({ secret: 'a-completely-different-secret-value' });
    const forgedState = otherJwt.sign({ tenantId: 'tenant_1', userId: 'user_1', connectorType: 'GMAIL', purpose: 'integration_oauth_state' });
    expect(() => service.verify(forgedState)).toThrow(UnauthorizedException);
  });

  it('rejects a syntactically valid but non-JWT string', () => {
    expect(() => service.verify('not-a-jwt')).toThrow(UnauthorizedException);
  });

  it('rejects a token that is a validly-signed JWT but lacks the oauth_state purpose claim (e.g. a real session access token)', () => {
    const sessionLikeToken = jwt.sign({ sub: 'user_1', tenantId: 'tenant_1' });
    expect(() => service.verify(sessionLikeToken)).toThrow(UnauthorizedException);
  });

  it('rejects an expired state token', () => {
    const almostExpiredJwt = new JwtService({ secret: 'test-secret-at-least-32-bytes-long' });
    const expiredToken = almostExpiredJwt.sign(
      { tenantId: 'tenant_1', userId: 'user_1', connectorType: 'GMAIL', purpose: 'integration_oauth_state' },
      { expiresIn: '-1s' },
    );
    expect(() => service.verify(expiredToken)).toThrow(UnauthorizedException);
  });
});
