import { startTracing } from './tracing';

startTracing('orbit-api');

import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { loadEnv, loadBrandingConfig } from '@orbit/config';
import { OrbitExceptionFilter } from './common/filters/orbit-exception.filter';
import { createPinoLogger } from './logging/create-pino-logger';
import { OrbitPinoLogger } from './logging/pino-nest-logger';
import { MetricsService } from './metrics/metrics.service';

async function bootstrap() {
  const env = loadEnv();
  const branding = loadBrandingConfig();
  const pino = createPinoLogger(env);

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  // As early as possible — `bufferLogs: true` holds every Nest bootstrap
  // log (module init, route mapping) until this call, so they render
  // through pino too instead of Nest's default console Logger. See
  // docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §63.
  app.useLogger(new OrbitPinoLogger(pino));

  app.use(helmet());
  app.use(pinoHttp({ logger: pino }));

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new OrbitExceptionFilter(httpAdapter, app.get(MetricsService)));
  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    // Der Browser darf den Dateinamen eines Downloads (z. B. Diagnose-Export) über Origins hinweg nur lesen, wenn der Server den Header freigibt.
    exposedHeaders: ['Content-Disposition'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle(`${branding.appName} API`)
    .setDescription(
      'API-first backend for Finance & Sales process automation (multi-tenant).',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(env.API_PORT);
  pino.info(`[${branding.appName}] API listening on port ${env.API_PORT}`);
}

bootstrap();
