import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
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
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokens> {
    return this.authService.refresh(dto.refreshToken);
  }

  /** Anzeigename des angemeldeten Nutzers (Begrüßung, Profil) – bewusst getrennt vom Token, das keine Namen trägt. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.authService.profile(user.tenantId, user.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }
}
