import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { loadBrandingConfig } from '@orbit/config';

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
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  await app.init();
  console.log(`[${branding.appName}] Worker process started`);
}

bootstrap();
