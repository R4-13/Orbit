import { Catch, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { isOrbitError } from '@orbit/shared';

/**
 * Maps OrbitError subclasses (@orbit/shared/errors.ts) to their declared
 * httpStatus + a stable JSON body ({code, message, details}), so business
 * errors thrown anywhere in a service/guard render as the intended HTTP
 * response instead of an opaque 500. Everything else (NestJS HttpException,
 * unexpected errors) falls through to Nest's default handling.
 */
@Catch()
export class OrbitExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (isOrbitError(exception)) {
      const response = host.switchToHttp().getResponse<Response>();
      response.status(exception.httpStatus).json(exception.toJSON());
      return;
    }

    super.catch(exception, host);
  }
}
