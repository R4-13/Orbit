import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { CHANNEL_SYNC_QUEUE, WORKFLOW_RUNS_QUEUE } from './queue.tokens';
import { TenantConcurrencyService } from './tenant-concurrency.service';

/**
 * docs/SCALABILITY_CONCEPT.md — BullMQ/Redis wiring that the codebase has
 * carried as a dependency + docker-compose service since Phase 1
 * (`apps/api/worker/main.ts`'s own long-standing comment: "Queue
 * processors are registered on WorkerModule as they're implemented in
 * Phase 5 onward") but never actually connected until now. Imported by
 * both `AppModule` (as a producer — enqueues jobs) and `WorkerModule`
 * (as a consumer — registers `@Processor()` classes against the same
 * queue name), so both processes share one Redis connection config and
 * can never register a queue under a different name by accident.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => ({ connection: { url: env.REDIS_URL } }),
    }),
    BullModule.registerQueue({ name: WORKFLOW_RUNS_QUEUE }),
    BullModule.registerQueue({ name: CHANNEL_SYNC_QUEUE }),
  ],
  providers: [TenantConcurrencyService],
  exports: [BullModule, TenantConcurrencyService],
})
export class QueueModule {}
