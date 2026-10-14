import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PasswordChangeRequiredError } from '@orbit/shared';
import { PASSWORD_PENDING_KEY } from '../decorators/allow-password-change-pending.decorator';
import type { AuthenticatedUser } from '../types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /** Mit Startpasswort ist nur erlaubt, was ausdrücklich freigegeben ist (Passwortwechsel, Kontoabfrage) – alles andere antwortet `PASSWORD_CHANGE_REQUIRED`. */
  override handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser, info: unknown, context: ExecutionContext, status?: unknown): TUser {
    const authenticated = super.handleRequest(err, user, info, context, status) as TUser;
    if ((authenticated as unknown as AuthenticatedUser | undefined)?.passwordChangeRequired && !this.reflector.getAllAndOverride<boolean | undefined>(PASSWORD_PENDING_KEY, [context.getHandler(), context.getClass()])) {
      throw new PasswordChangeRequiredError('Bitte ändern Sie zuerst Ihr Startpasswort.');
    }
    return authenticated;
  }
}
