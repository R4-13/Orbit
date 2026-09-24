import { Module } from '@nestjs/common';
import { ThrottlerRedisStorageService } from './throttler-redis-storage.service';

/**
 * A tiny standalone module so `ThrottlerRedisStorageService` can be
 * imported into `ThrottlerModule.forRootAsync()`'s `inject` array
 * (apps/api/src/app.module.ts) — `ThrottlerModule` itself is configured
 * before the rest of the app's providers exist, so the storage service
 * needs its own module to be resolvable at that point.
 */
@Module({
  providers: [ThrottlerRedisStorageService],
  exports: [ThrottlerRedisStorageService],
})
export class ThrottlerStorageModule {}
