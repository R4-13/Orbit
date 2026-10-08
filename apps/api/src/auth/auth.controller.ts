import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { OrbitEnv } from '@orbit/config';
import { AuthenticationExpiredError, parseDurationToMs } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { TENANT_REFRESH_COOKIE, tenantSessionCookie } from './auth-cookie';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService, type AuthTokens, type UserProfile } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './types';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * Tighter than the app-wide default (RATE_LIMIT_MAX/_WINDOW_MS) — these are
 * the two unauthenticated, credential-guessable endpoints, so brute-forcing
 * a password or replaying stolen refresh tokens should be slow even before
 * argon2's own cost factor or refresh-token rotation kick in. Read directly
 * from process.env (not the validated ORBIT_ENV) to match the existing
 * ThrottlerModule.forRoot() call in app.module.ts — `@Throttle()` is
 * evaluated once at module-load time, before Nest's DI container (and thus
 * ORBIT_ENV) exists. Defaults (60 attempts/5min — deliberately looser than a
 * typical production recommendation of ~5-20/15min; tighten via the env
 * vars below for a real deployment) were sized against the Phase 14 E2E
 * suites' actual login volume: ~15 requests per full local/CI run, and a
 * developer re-running the suite two or three times in a row within the
 * same 5-minute window (a real, observed failure while building this)
 * shouldn't trip a security control meant for brute-force attempts. See
 * docs/ASSUMPTIONS.md Phase 15.
 */
const AUTH_THROTTLE = {
  default: {
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 60),
    ttl: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 300_000),
  },
};

@ApiTags('auth')
@Controller({ path: 'auth' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /** Im Cookie-Modus (Browser) gelangt das Refresh-Token nur als httpOnly-Cookie zum Client, nie in den Antwortkörper. */
  private deliver(tokens: AuthTokens, request: Request, response: Response): AuthTokens {
    if (!tenantSessionCookie.isCookieMode(request)) return tokens;
    response.cookie(TENANT_REFRESH_COOKIE, tokens.refreshToken, tenantSessionCookie.options(this.env, parseDurationToMs(this.env.JWT_REFRESH_TTL)));
    return { ...tokens, refreshToken: '' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthTokens> {
    return this.deliver(await this.authService.login(dto.email, dto.password), request, response);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthTokens> {
    // Das Cookie gilt nur im Cookie-Modus (Header als Schutz gegen fremde Auslöser); ein Token im Körper hat Vorrang und braucht keinen Header.
    const token = dto.refreshToken || (tenantSessionCookie.isCookieMode(request) ? tenantSessionCookie.read(request) : undefined);
    if (!token) throw new AuthenticationExpiredError('Kein Refresh-Token vorhanden.');
    try {
      return this.deliver(await this.authService.refresh(token), request, response);
    } catch (error) {
      if (tenantSessionCookie.isCookieMode(request)) response.clearCookie(TENANT_REFRESH_COOKIE, tenantSessionCookie.clearOptions(this.env));
      throw error;
    }
  }

  /** Anzeigename des angemeldeten Nutzers (Begrüßung, Profil) – bewusst getrennt vom Token, das keine Namen trägt. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.authService.profile(user.tenantId, user.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = dto.refreshToken || (tenantSessionCookie.isCookieMode(request) ? tenantSessionCookie.read(request) : undefined);
    if (token) await this.authService.logout(token);
    if (tenantSessionCookie.isCookieMode(request)) response.clearCookie(TENANT_REFRESH_COOKIE, tenantSessionCookie.clearOptions(this.env));
  }
}
