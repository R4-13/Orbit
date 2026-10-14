import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_KEY_PREFIX } from '@orbit/shared';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ApiKeysService } from './api-keys.service';

/**
 * Wie `JwtAuthGuard`, nimmt aber zusätzlich einen Zugriffsschlüssel (`Authorization: Bearer osk_…` oder `X-Api-Key`) an. Nur auf Endpunkten einsetzen, die für
 * Dienstzugänge gedacht sind; der Schlüssel trägt nur die Berechtigungen seiner Bereiche, `PermissionsGuard` entscheidet wie bei einem Konto.
 */
@Injectable()
export class ApiKeyOrJwtGuard extends JwtAuthGuard {
  constructor(
    reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {
    super(reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers.authorization;
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const direct = request.headers['x-api-key'];
    const candidate = bearer?.startsWith(API_KEY_PREFIX) ? bearer : typeof direct === 'string' && direct.startsWith(API_KEY_PREFIX) ? direct : undefined;
    if (!candidate) return (await super.canActivate(context)) as boolean;
    request.user = await this.apiKeys.authenticate(candidate);
    return true;
  }
}
