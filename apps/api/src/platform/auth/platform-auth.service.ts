import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { OrbitEnv } from '@orbit/config';
import {
  AuthenticationExpiredError,
  PlatformNotConfiguredError,
  isPlatformRole,
  parseDurationToMs,
  scopesForRoles,
  type PlatformPrincipal,
  type PlatformRole,
} from '@orbit/shared';
import { ORBIT_ENV } from '../../config/env.token';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { PLATFORM_AUDIENCE, PLATFORM_ISSUER, type PlatformJwtPayload } from './platform-auth.types';

export interface PlatformTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  principal: PlatformPrincipal;
}

interface SessionShape {
  id: string;
  stepUpUntil: Date | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Anmeldung der Plattformdomäne (Amendment 03 §3, ADR OPS-A2). Eigenes Secret, eigene Zielgruppe (`aud`), eigene Sitzungstabelle.
 * Ein Mandanten-Token wird hier nie akzeptiert (andere Signatur) und ein Plattform-Token nicht von der Mandanten-Strategie (andere Signatur).
 * Die Sitzung wird bei jedem Request geprüft – ein Widerruf wirkt sofort. Kurze Access-Token-Lebensdauer, rotierendes Refresh-Token,
 * absolute Sitzungsgrenze. Step-up = erneute Passwortprüfung (kein MFA; ehrlich als Lücke geführt, ASSUMPTIONS OPS-A5).
 */
@Injectable()
export class PlatformAuthService {
  /** Argon2-Hash eines unbekannten Passworts: bei unbekannter E-Mail wird trotzdem verifiziert, damit die Antwortzeit keine Konten verrät. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  get enabled(): boolean {
    return Boolean(this.env.PLATFORM_JWT_SECRET);
  }

  assertEnabled(): string {
    if (!this.env.PLATFORM_JWT_SECRET) throw new PlatformNotConfiguredError('Die Plattformdomäne ist nicht konfiguriert.');
    return this.env.PLATFORM_JWT_SECRET;
  }

  private async verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
    this.dummyHash ??= argon2.hash(randomBytes(16).toString('hex'));
    return argon2.verify(hash ?? (await this.dummyHash), password).catch(() => false);
  }

  async login(email: string, password: string): Promise<PlatformTokens> {
    this.assertEnabled();
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.withPlatformScope((tx) =>
      tx.platformUser.findUnique({ where: { email: normalized }, include: { roleAssignments: { where: { revokedAt: null } } } }),
    );

    const valid = await this.verifyPassword(user?.passwordHash, password);
    const roles = (user?.roleAssignments ?? []).map((a) => a.role).filter(isPlatformRole);
    if (!user || !valid || user.status !== 'ACTIVE' || roles.length === 0) {
      await this.audit.record({
        eventType: 'PLATFORM_LOGIN_FAILED',
        targetType: 'PlatformUser',
        targetId: user?.id,
        extra: { emailHash: sha256(normalized), cause: !user ? 'unknown' : !valid ? 'password' : user.status !== 'ACTIVE' ? 'disabled' : 'no_roles' },
      });
      throw new UnauthorizedException('Invalid credentials.');
    }

    const refreshToken = randomBytes(32).toString('hex');
    const session = await this.prisma.withPlatformScope(async (tx) => {
      await tx.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return tx.platformSession.create({
        data: {
          platformUserId: user.id,
          refreshTokenHash: sha256(refreshToken),
          assurance: 'PASSWORD',
          environment: this.env.ORBIT_ENVIRONMENT,
          expiresAt: new Date(Date.now() + this.env.PLATFORM_SESSION_MAX_HOURS * 3_600_000),
        },
      });
    });
    await this.audit.record({ eventType: 'PLATFORM_LOGIN', actor: { userId: user.id, roles }, targetType: 'PlatformSession', targetId: session.id });
    return this.issue(user.id, user.email, user.displayName, roles, session, refreshToken);
  }

  async refresh(rawRefreshToken: string): Promise<PlatformTokens> {
    this.assertEnabled();
    const hash = sha256(rawRefreshToken);
    const next = randomBytes(32).toString('hex');
    // Rotation atomar: nur wer das aktuelle Token vorlegt, bekommt ein neues; das alte ist danach wertlos (ein gestohlenes Token lebt höchstens einmal).
    const claimed = await this.prisma.withPlatformScope(async (tx) => {
      const session = await tx.platformSession.findUnique({
        where: { refreshTokenHash: hash },
        include: { user: { include: { roleAssignments: { where: { revokedAt: null } } } } },
      });
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.environment !== this.env.ORBIT_ENVIRONMENT) return null;
      if (session.user.status !== 'ACTIVE') return null;
      const updated = await tx.platformSession.updateMany({
        where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
        data: { refreshTokenHash: sha256(next), lastSeenAt: new Date() },
      });
      return updated.count === 1 ? session : null;
    });
    if (!claimed) throw new AuthenticationExpiredError('Refresh token is invalid, revoked or expired.');
    const roles = claimed.user.roleAssignments.map((a) => a.role).filter(isPlatformRole);
    if (roles.length === 0) throw new AuthenticationExpiredError('No platform role assigned.');
    return this.issue(claimed.user.id, claimed.user.email, claimed.user.displayName, roles, claimed, next);
  }

  async logout(principal: PlatformPrincipal): Promise<void> {
    await this.prisma.withPlatformScope((tx) =>
      tx.platformSession.updateMany({ where: { id: principal.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'LOGOUT' } }),
    );
    await this.audit.record({ eventType: 'PLATFORM_LOGOUT', actor: { userId: principal.userId, roles: principal.platformRoles }, targetType: 'PlatformSession', targetId: principal.sessionId });
  }

  /** Erneute Passwortprüfung → zeitlich begrenztes Erhöhungsfenster für kritische Operationen. */
  async stepUp(principal: PlatformPrincipal, password: string): Promise<{ stepUpUntil: string; authenticationAssurance: 'PASSWORD_STEP_UP' }> {
    const user = await this.prisma.withPlatformScope((tx) => tx.platformUser.findUnique({ where: { id: principal.userId } }));
    const valid = await this.verifyPassword(user?.passwordHash, password);
    if (!user || !valid || user.status !== 'ACTIVE') {
      await this.audit.record({ eventType: 'PLATFORM_ACCESS_DENIED', actor: { userId: principal.userId, roles: principal.platformRoles }, targetType: 'PlatformSession', targetId: principal.sessionId, reason: 'step-up password check failed' });
      throw new UnauthorizedException('Invalid credentials.');
    }
    const until = new Date(Date.now() + this.env.PLATFORM_STEP_UP_MINUTES * 60_000);
    await this.prisma.withPlatformScope((tx) => tx.platformSession.update({ where: { id: principal.sessionId }, data: { stepUpUntil: until, assurance: 'PASSWORD_STEP_UP' } }));
    await this.audit.record({ eventType: 'PLATFORM_STEP_UP', actor: { userId: principal.userId, roles: principal.platformRoles }, targetType: 'PlatformSession', targetId: principal.sessionId, extra: { until: until.toISOString() } });
    return { stepUpUntil: until.toISOString(), authenticationAssurance: 'PASSWORD_STEP_UP' };
  }

  /** Widerruft alle Sitzungen einer Identität (z. B. beim Deaktivieren oder bei Rollenentzug). */
  async revokeAllSessions(platformUserId: string, reason: string): Promise<number> {
    const result = await this.prisma.withPlatformScope((tx) =>
      tx.platformSession.updateMany({ where: { platformUserId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } }),
    );
    return result.count;
  }

  /** Prüft Access Token + Sitzung + Konto und baut den Plattformkontext serverseitig (Amendment 03 §3.1). Wirft 401 bei jedem Mangel. */
  async authenticate(accessToken: string): Promise<PlatformPrincipal> {
    const secret = this.assertEnabled();
    let payload: PlatformJwtPayload & { iat?: number; exp?: number };
    try {
      payload = this.jwt.verify(accessToken, { secret, audience: PLATFORM_AUDIENCE, issuer: PLATFORM_ISSUER });
    } catch {
      throw new UnauthorizedException('Invalid or expired platform token.');
    }
    if (payload.dom !== 'PLATFORM' || !payload.sub || !payload.sid) throw new UnauthorizedException('Invalid platform token.');

    const session = await this.prisma.withPlatformScope(async (tx) => {
      const found = await tx.platformSession.findUnique({
        where: { id: payload.sid },
        include: { user: { include: { roleAssignments: { where: { revokedAt: null } } } } },
      });
      if (found && Date.now() - found.lastSeenAt.getTime() > 60_000) await tx.platformSession.update({ where: { id: found.id }, data: { lastSeenAt: new Date() } });
      return found;
    });
    if (
      !session ||
      session.platformUserId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.environment !== this.env.ORBIT_ENVIRONMENT ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Platform session is not active.');
    }
    const roles = session.user.roleAssignments.map((a) => a.role).filter(isPlatformRole);
    if (roles.length === 0) throw new UnauthorizedException('No platform role assigned.');
    return this.toPrincipal(session.user.id, session.user.email, session.user.displayName, roles, session, payload);
  }

  private issue(userId: string, email: string, displayName: string, roles: PlatformRole[], session: SessionShape, rawRefresh: string): PlatformTokens {
    const secret = this.assertEnabled();
    const payload: PlatformJwtPayload = { sub: userId, sid: session.id, dom: 'PLATFORM', env: this.env.ORBIT_ENVIRONMENT };
    const accessToken = this.jwt.sign(payload, { secret, audience: PLATFORM_AUDIENCE, issuer: PLATFORM_ISSUER, expiresIn: this.env.PLATFORM_ACCESS_TTL });
    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: Math.floor(parseDurationToMs(this.env.PLATFORM_ACCESS_TTL) / 1000),
      principal: this.toPrincipal(userId, email, displayName, roles, session, payload),
    };
  }

  private toPrincipal(userId: string, email: string, displayName: string, roles: PlatformRole[], session: SessionShape, payload: PlatformJwtPayload & { iat?: number; exp?: number }): PlatformPrincipal {
    const stepUpActive = Boolean(session.stepUpUntil && session.stepUpUntil.getTime() > Date.now());
    const issuedAt = payload.iat ? new Date(payload.iat * 1000) : new Date();
    const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + parseDurationToMs(this.env.PLATFORM_ACCESS_TTL));
    return {
      userId,
      email,
      displayName,
      platformRoles: roles,
      platformScopes: scopesForRoles(roles),
      authenticationAssurance: stepUpActive ? 'PASSWORD_STEP_UP' : 'PASSWORD',
      stepUpUntil: stepUpActive && session.stepUpUntil ? session.stepUpUntil.toISOString() : undefined,
      sessionId: session.id,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      environment: this.env.ORBIT_ENVIRONMENT,
    };
  }
}
