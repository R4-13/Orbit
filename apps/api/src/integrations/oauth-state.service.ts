import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { IntegrationConnectorType } from '@orbit/domain';

export interface OAuthStatePayload {
  tenantId: string;
  userId: string;
  connectorType: IntegrationConnectorType;
}

const STATE_PURPOSE = 'integration_oauth_state';
/** Short-lived on purpose — the whole Google consent round-trip normally takes well under a minute; 10 minutes covers a slow/distracted user without leaving a long-lived forgeable token around. */
const STATE_EXPIRY = '10m';

/**
 * §5.1 ("state gegen CSRF absichern") — the OAuth `state` query parameter
 * doubles as both a CSRF token (an attacker can't forge a signed JWT
 * without `JWT_SECRET`) and the only way to recover *which* tenant/user
 * started the flow when Google's redirect lands on the public callback
 * endpoint (a browser redirect carries no Authorization header, so the
 * normal JwtAuthGuard identity is unavailable there — see
 * `IntegrationsController.callback()`).
 *
 * Reuses the app's existing `JwtService`/`JWT_SECRET` (AuthModule already
 * establishes this as a trusted signing secret) rather than introducing a
 * second one — distinguished from real session tokens by the `purpose`
 * claim and a short, single-purpose expiry, not by a different secret.
 */
@Injectable()
export class OAuthStateService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: OAuthStatePayload): string {
    return this.jwt.sign({ ...payload, purpose: STATE_PURPOSE }, { expiresIn: STATE_EXPIRY });
  }

  verify(state: string): OAuthStatePayload {
    let decoded: OAuthStatePayload & { purpose?: string };
    try {
      decoded = this.jwt.verify(state);
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state.');
    }
    if (decoded.purpose !== STATE_PURPOSE) {
      throw new UnauthorizedException('Invalid OAuth state.');
    }
    return { tenantId: decoded.tenantId, userId: decoded.userId, connectorType: decoded.connectorType };
  }
}
