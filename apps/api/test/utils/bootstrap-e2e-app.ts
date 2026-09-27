import { Test } from '@nestjs/testing';
import { HttpAdapterHost } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { OrbitExceptionFilter } from '../../src/common/filters/orbit-exception.filter';
import { MetricsService } from '../../src/metrics/metrics.service';

/**
 * Boots a full Nest application against the real (Testing)Module the same
 * way `src/main.ts` does for production — versioning, global prefix,
 * ValidationPipe, and crucially `OrbitExceptionFilter` (mapping
 * OrbitError subclasses to their declared HTTP status instead of an opaque
 * 500). The original app.e2e-spec.ts (health checks only) never exercised
 * an OrbitError, so this filter's absence from the e2e bootstrap went
 * unnoticed until the Phase 14 workflow suites hit 403/404 paths — found
 * live, fixed by extracting this single shared helper so the two bootstrap
 * paths can't drift apart again (see docs/ASSUMPTIONS.md).
 *
 * Deliberately skips `helmet()`/CORS/Swagger/`app.listen()` — irrelevant
 * for supertest, which talks to the underlying HTTP server directly.
 */
export async function bootstrapE2eApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new OrbitExceptionFilter(httpAdapter, app.get(MetricsService)));

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  await app.init();
  return app;
}
