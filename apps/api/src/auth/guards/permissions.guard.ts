import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedError, type Permission } from '@orbit/shared';
import { PERMISSIONS_METADATA_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedUser } from '../types';

/**
 * Enforces @RequirePermissions(...) on a route. Must run after JwtAuthGuard
 * (needs `request.user` already populated) — apply both together:
 * `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new PermissionDeniedError('No authenticated user on request.');
    }

    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length > 0) {
      throw new PermissionDeniedError('Missing required permission(s).', { missing });
    }

    return true;
  }
}
