import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv, loadBrandingConfig } from '@orbit/config';
import { OrbitExceptionFilter } from './common/filters/orbit-exception.filter';

async function bootstrap() {
  const env = loadEnv();
  const branding = loadBrandingConfig();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.use(helmet());

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new OrbitExceptionFilter(httpAdapter));
  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
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
  console.log(`[${branding.appName}] API listening on port ${env.API_PORT}`);
}

bootstrap();
