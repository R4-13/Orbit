import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { loadEnv } from '@orbit/config';
import { ThrottlerRedisStorageService } from '../src/throttler/throttler-redis-storage.service';

/**
 * Real-Redis test of the Lua-scripted increment/block logic
 * (docs/SCALABILITY_CONCEPT.md, "Redis-gestütztes Rate-Limiting") — a
 * mocked `ioredis.eval()` would only prove the service parses whatever
 * array *I* told the mock to return, not that the Lua script itself is
 * correct (atomic increment, correct blocking, correct TTL semantics).
 * Runs against the same `REDIS_URL` every other live-verified piece of
 * this session's work used (`orbit-redis` container).
 */
describe('ThrottlerRedisStorageService (real Redis)', () => {
  let service: ThrottlerRedisStorageService;
  let redis: Redis;

  beforeAll(() => {
    const env = loadEnv();
    service = new ThrottlerRedisStorageService(env);
    redis = new Redis(env.REDIS_URL);
  });

  afterAll(async () => {
    await redis.quit();
    // ThrottlerRedisStorageService.onApplicationShutdown() disconnects its own client — not called by Nest here since this test constructs it directly, not through DI.
    (service as unknown as { onApplicationShutdown: () => void }).onApplicationShutdown();
  });

  afterEach(async () => {
    // No blanket FLUSHDB (orbit-redis is shared with BullMQ's own job
    // data in a full dev/CI run) — delete only this suite's own keys.
    const keys = await redis.keys('throttler:*e2e-throttler-test*');
    if (keys.length > 0) await redis.del(...keys);
  });

  function uniqueKey(): string {
    return `e2e-throttler-test-${randomUUID()}`;
  }

  it('reports totalHits=1 and isBlocked=false for the first request under the limit', async () => {
    const record = await service.increment(uniqueKey(), 10000, 5, 10000, 'default');

    expect(record.totalHits).toBe(1);
    expect(record.isBlocked).toBe(false);
    expect(record.timeToExpire).toBeGreaterThan(0);
    expect(record.timeToExpire).toBeLessThanOrEqual(10);
  });

  it('counts up to the limit without blocking, then blocks on the request that exceeds it', async () => {
    const key = uniqueKey();
    let last;
    for (let i = 0; i < 3; i += 1) {
      last = await service.increment(key, 10000, 3, 5000, 'default');
      expect(last.isBlocked).toBe(false);
    }

    const overLimit = await service.increment(key, 10000, 3, 5000, 'default');
    expect(overLimit.totalHits).toBe(4);
    expect(overLimit.isBlocked).toBe(true);
    expect(overLimit.timeToBlockExpire).toBeGreaterThan(0);
    expect(overLimit.timeToBlockExpire).toBeLessThanOrEqual(5);
  });

  it('does not increment the counter further while blocked', async () => {
    const key = uniqueKey();
    for (let i = 0; i < 3; i += 1) {
      await service.increment(key, 10000, 2, 5000, 'default');
    }
    const stillBlocked = await service.increment(key, 10000, 2, 5000, 'default');

    // 3 real increments (2 allowed + the one that tripped the block) —
    // the 4th call above must not have incremented the counter again.
    expect(stillBlocked.totalHits).toBe(3);
    expect(stillBlocked.isBlocked).toBe(true);
  });

  it('scopes counters independently per throttlerName for the same key', async () => {
    const key = uniqueKey();
    const short = await service.increment(key, 10000, 5, 5000, 'short');
    const long = await service.increment(key, 10000, 5, 5000, 'long');

    expect(short.totalHits).toBe(1);
    expect(long.totalHits).toBe(1);
  });

  it('handles N concurrent increments atomically: no duplicate/skipped counts below the limit, and the counter freezes once blocked', async () => {
    // Real finding while writing this test (see docs/ASSUMPTIONS.md):
    // the first version of this assertion wrongly expected 10 unique
    // sequential totalHits values. That's not what the reference
    // `ThrottlerStorageService` (the in-memory default) does once a key
    // is blocked — `fireHitCount()` (its own counter-increment step) is
    // only called when *not* blocked, so a blocked key's counter stops
    // moving and every blocked caller sees the same frozen value. The
    // Lua script here replicates that intentionally (single Redis
    // EVAL = atomic, so this is Redis serializing 10 concurrent calls
    // one at a time, not a race).
    const key = uniqueKey();
    const limit = 5;
    const concurrentRequests = 10;

    const results = await Promise.all(
      Array.from({ length: concurrentRequests }, () => service.increment(key, 10000, limit, 5000, 'default')),
    );

    const notBlocked = results.filter((r) => !r.isBlocked);
    const blocked = results.filter((r) => r.isBlocked);

    // Exactly `limit` calls got through unblocked, each with a distinct,
    // sequential totalHits (1..limit) — no duplicates, no gaps, proving
    // the increments themselves were atomic under real concurrency.
    expect(notBlocked.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

    // The remaining calls are all blocked, and — because a blocked key's
    // counter is frozen — they all report the exact same totalHits: the
    // one call that tripped the block (6), never more than one distinct
    // value.
    expect(blocked).toHaveLength(concurrentRequests - limit);
    expect(new Set(blocked.map((r) => r.totalHits)).size).toBe(1);
    expect(blocked[0]?.totalHits).toBe(limit + 1);
  });
});
