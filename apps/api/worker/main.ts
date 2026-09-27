import { startTracing } from '../src/tracing';

startTracing('orbit-worker');

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { loadBrandingConfig, loadEnv } from '@orbit/config';
import { createPinoLogger } from '../src/logging/create-pino-logger';
import { OrbitPinoLogger } from '../src/logging/pino-nest-logger';

/**
 * Standalone BullMQ worker process. Runs as a separate container/process
 * from the API (see docker-compose.yml `worker` service) so long-running
 * job processing (document extraction, connector sync, webhook
 * processing) never blocks API request handling.
 *
 * Queue processors are registered on WorkerModule as they're implemented
 * in Phase 5 onward (IntegrationModule, DocumentModule, AgentModule).
 */
async function bootstrap() {
  const branding = loadBrandingConfig();
  const pino = createPinoLogger(loadEnv());
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(new OrbitPinoLogger(pino));
  await app.init();
  pino.info(`[${branding.appName}] Worker process started`);
}

bootstrap();
