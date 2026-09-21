import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../../config/env.token';
import type { AuthenticatedUser, JwtPayload } from '../types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(ORBIT_ENV) env: OrbitEnv) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_SECRET,
    });
  }

  /**
   * Trusts the roles/permissions embedded in the access token rather than
   * re-querying the DB on every request (stateless JWT, see ASSUMPTIONS).
   * A revoked permission takes effect on this user's next token refresh —
   * within JWT_ACCESS_TTL (15 min by default), not instantly.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  }
}
