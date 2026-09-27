import type { HttpAdapterHost } from '@nestjs/core';
import { Catch, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { isOrbitError } from '@orbit/shared';
import type { MetricsService } from '../../metrics/metrics.service';

/**
 * Maps OrbitError subclasses (@orbit/shared/errors.ts) to their declared
 * httpStatus + a stable JSON body ({code, message, details}), so business
 * errors thrown anywhere in a service/guard render as the intended HTTP
 * response instead of an opaque 500. Everything else (NestJS HttpException,
 * unexpected errors) falls through to Nest's default handling.
 *
 * `metrics` is optional (constructed manually via `new
 * OrbitExceptionFilter(httpAdapter)` in `main.ts`/`bootstrap-e2e-app.ts`,
 * outside Nest's DI container, same as `httpAdapter` itself) — increments
 * `connector_errors_total` (docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §64)
 * for the two error codes that represent an external system failing,
 * without needing every connector call site to remember to record it
 * itself.
 */
@Catch()
export class OrbitExceptionFilter extends BaseExceptionFilter {
  constructor(
    applicationRef: HttpAdapterHost['httpAdapter'],
    private readonly metrics?: MetricsService,
  ) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (isOrbitError(exception)) {
      if (this.metrics && (exception.code === 'EXTERNAL_SYSTEM_ERROR' || exception.code === 'INTEGRATION_UNAVAILABLE')) {
        this.metrics.connectorErrors.inc({ error_code: exception.code });
      }
      const response = host.switchToHttp().getResponse<Response>();
      response.status(exception.httpStatus).json(exception.toJSON());
      return;
    }

    super.catch(exception, host);
  }
}
