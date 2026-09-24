import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { QueueModule } from '../queue/queue.module';
import { HealthController } from './health.controller';

/** QueueModule for the Redis client `HealthController.ready()` pings (docs/SCALABILITY_CONCEPT.md). PrismaService comes from the @Global() PrismaModule, already available everywhere. */
@Module({
  imports: [TerminusModule, QueueModule],
  controllers: [HealthController],
})
export class HealthModule {}
