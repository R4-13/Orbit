import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { OrbitEnv } from '@orbit/config';
import { AuthenticationExpiredError, parseDurationToMs, type Permission } from '@orbit/shared';
import { Prisma } from '@orbit/domain';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser, JwtPayload } from './types';

const USER_WITH_ROLES_INCLUDE = {
  tenant: true,
  roles: { include: { role: { include: { permissions: true } } } },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof USER_WITH_ROLES_INCLUDE }>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds, for clients to schedule a refresh. */
  expiresIn: number;
  user: AuthenticatedUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  async login(email: string, password: string): Promise<AuthTokens> {
    // Looking up a user by email, before we know their tenant, is one of
    // the few genuinely cross-tenant operations — see PrismaService.withRlsBypass.
    const user = await this.prisma.withRlsBypass((tx) =>
      tx.user.findUnique({ where: { email }, include: USER_WITH_ROLES_INCLUDE }),
    );

    if (!user || user.status !== 'ACTIVE' || user.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const passwordValid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.issueTokens(this.toAuthenticatedUser(user));
  }

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(rawRefreshToken);

    // Same cross-tenant caveat as login(): a refresh token doesn't carry a
    // known tenant until we've looked up the user it belongs to.
    const user = await this.prisma.withRlsBypass(async (tx) => {
      const stored = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
        throw new AuthenticationExpiredError('Refresh token is invalid, revoked or expired.');
      }

      // Rotate: the presented token is single-use, whether or not the
      // lookup below succeeds, so a stolen-and-replayed token dies here.
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });

      return tx.user.findUnique({ where: { id: stored.userId }, include: USER_WITH_ROLES_INCLUDE });
    });

    if (!user || user.status !== 'ACTIVE' || user.tenant.status !== 'ACTIVE') {
      throw new AuthenticationExpiredError('User or tenant is no longer active.');
    }

    return this.issueTokens(this.toAuthenticatedUser(user));
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.withRlsBypass((tx) =>
      tx.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  private async issueTokens(user: AuthenticatedUser): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: this.env.JWT_ACCESS_TTL });

    const rawRefreshToken = randomBytes(32).toString('hex');
    const refreshTtlMs = parseDurationToMs(this.env.JWT_REFRESH_TTL);
    await this.prisma.withRlsBypass((tx) =>
      tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashToken(rawRefreshToken),
          expiresAt: new Date(Date.now() + refreshTtlMs),
        },
      }),
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: Math.floor(parseDurationToMs(this.env.JWT_ACCESS_TTL) / 1000),
      user,
    };
  }

  /**
   * Refresh tokens are high-entropy random values, not low-entropy
   * passwords — a fast hash (not argon2) is the right tool here, matching
   * standard practice for opaque bearer/session tokens.
   */
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private toAuthenticatedUser(user: UserWithRoles): AuthenticatedUser {
    const roles = user.roles.map((userRole) => userRole.role.name);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((userRole) => userRole.role.permissions.map((rp) => rp.permission)),
      ),
    ) as Permission[];

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
      permissions,
    };
  }
}
