import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { isOrbitError } from '@orbit/shared';
import type { AuthenticatedUser } from '../types';
import { PermissionsGuard } from './permissions.guard';

function buildContext(user: AuthenticatedUser | undefined, metadata: string[] | undefined) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(metadata);

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;

  return { reflector, context };
}

const USER: AuthenticatedUser = {
  id: 'user_1',
  tenantId: 'tenant_1',
  email: 'a@b.example',
  roles: ['FINANCE_USER'],
  permissions: ['invoice.read', 'booking.read'],
};

describe('PermissionsGuard', () => {
  it('allows the request through when the route has no @RequirePermissions metadata', () => {
    const { reflector, context } = buildContext(undefined, undefined);
    expect(new PermissionsGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows the request when the user holds every required permission', () => {
    const { reflector, context } = buildContext(USER, ['invoice.read']);
    expect(new PermissionsGuard(reflector).canActivate(context)).toBe(true);
  });

  it('throws PermissionDeniedError when a required permission is missing', () => {
    const { reflector, context } = buildContext(USER, ['invoice.approve']);
    let caught: unknown;
    try {
      new PermissionsGuard(reflector).canActivate(context);
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('PERMISSION_DENIED');
  });

  it('throws PermissionDeniedError when there is no authenticated user at all', () => {
    const { reflector, context } = buildContext(undefined, ['invoice.read']);
    expect(() => new PermissionsGuard(reflector).canActivate(context)).toThrow();
  });
});
