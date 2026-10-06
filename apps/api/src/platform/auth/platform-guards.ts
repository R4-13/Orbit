import {
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedError, StepUpRequiredError, type PlatformPrincipal, type PlatformScope } from '@orbit/shared';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import type { PlatformRequest } from './platform-auth.types';

const SCOPES_KEY = 'orbit:platform-scopes';
const STEP_UP_KEY = 'orbit:platform-step-up';

/** Verlangt ALLE genannten Plattform-Scopes (serverseitig; Amendment 03 §23.3). */
export const RequirePlatformScope = (...scopes: PlatformScope[]) => SetMetadata(SCOPES_KEY, scopes);

/** Verlangt ein aktuelles Step-up (erneute Passwortprüfung) für kritische Operationen (Amendment 03 §3.2). */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);

export const CurrentPlatformPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): PlatformPrincipal => {
  const request = ctx.switchToHttp().getRequest<PlatformRequest>();
  if (!request.platformPrincipal) throw new UnauthorizedException('No platform principal.');
  return request.platformPrincipal;
});

/**
 * Erste Stufe jeder Plattformroute: authenticate → resolve platform principal. Akzeptiert ausschließlich Plattform-Token
 * (eigenes Secret + Zielgruppe); ein Mandanten-Token scheitert an der Signatur und erreicht nie eine Plattform-Logik.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith('Bearer ')) throw new UnauthorizedException('Missing platform bearer token.');
    request.platformPrincipal = await this.auth.authenticate(value.slice('Bearer '.length).trim());
    return true;
  }
}

/** Zweite Stufe: authorize platform scope (+ Step-up). Verweigerungen werden auditiert (OPS-04). */
@Injectable()
export class PlatformScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: PlatformAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PlatformScope[] | undefined>(SCOPES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const stepUp = this.reflector.getAllAndOverride<boolean | undefined>(STEP_UP_KEY, [context.getHandler(), context.getClass()]) ?? false;
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const principal = request.platformPrincipal;
    if (!principal) throw new UnauthorizedException('No platform principal.');

    const missing = required.filter((scope) => !principal.platformScopes.includes(scope));
    if (missing.length > 0) {
      await this.audit.record({
        eventType: 'PLATFORM_ACCESS_DENIED',
        actor: { userId: principal.userId, roles: principal.platformRoles },
        targetType: 'Route',
        targetId: `${context.getClass().name}.${context.getHandler().name}`,
        reason: 'missing scope',
        extra: { missing },
      });
      throw new PermissionDeniedError('Missing required platform scope(s).', { missing });
    }

    if (stepUp && !(principal.stepUpUntil && new Date(principal.stepUpUntil).getTime() > Date.now())) {
      await this.audit.record({
        eventType: 'PLATFORM_ACCESS_DENIED',
        actor: { userId: principal.userId, roles: principal.platformRoles },
        targetType: 'Route',
        targetId: `${context.getClass().name}.${context.getHandler().name}`,
        reason: 'step-up required',
      });
      throw new StepUpRequiredError('Für diese Operation ist eine erneute Passwortbestätigung erforderlich.');
    }
    return true;
  }
}
