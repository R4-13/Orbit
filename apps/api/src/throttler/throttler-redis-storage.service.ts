import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';

/**
 * `@nestjs/throttler` (v6.7.0) declares this interface but, unlike
 * `ThrottlerStorage`, does not re-export it from the package's public
 * entry point (only from an internal `dist/` path) — defined locally
 * instead of a deep, non-public import. Shape verified against the
 * installed version's own `throttler-storage-record.interface.d.ts`.
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Atomically increments the hit counter and evaluates/applies blocking in
 * one round trip — the same guarantee `ThrottlerStorageService` (the
 * in-memory default) gets for free from JS's single-threaded execution,
 * but which a naive GET-then-INCR-then-SET sequence against Redis would
 * not have under concurrent requests from multiple API replicas (the
 * whole reason this exists — docs/SCALABILITY_CONCEPT.md).
 *
 * Mirrors `ThrottlerStorageService.increment()`'s exact semantics
 * (verified by reading its source, `@nestjs/throttler` v6.7.0):
 *  - A currently-blocked key does **not** get its hit counter incremented
 *    further (`fireHitCount` is only called when not blocked).
 *  - `ttl`/`blockDuration` parameters are **milliseconds**; the returned
 *    `timeToExpire`/`timeToBlockExpire` are **seconds**, rounded up
 *    (`Math.ceil`) — `ThrottlerGuard` sends `timeToBlockExpire` directly
 *    as the `Retry-After` HTTP header value, which is defined in seconds.
 *  - A block that has naturally expired is indistinguishable from "never
 *    blocked" — Redis's own key expiry (`PEXPIRE`) handles this for
 *    free, more simply than the in-memory version's manual
 *    `timeToBlockExpire <= 0` reset branch.
 */
const INCREMENT_SCRIPT = `
local counter_key = KEYS[1]
local block_key = KEYS[2]
local ttl_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block_duration_ms = tonumber(ARGV[3])

local block_pttl = redis.call('PTTL', block_key)
if block_pttl > 0 then
  local total_hits = tonumber(redis.call('GET', counter_key) or '0')
  local counter_pttl = redis.call('PTTL', counter_key)
  if counter_pttl < 0 then counter_pttl = 0 end
  return { total_hits, counter_pttl, 1, block_pttl }
end

local total_hits = redis.call('INCR', counter_key)
if total_hits == 1 then
  redis.call('PEXPIRE', counter_key, ttl_ms)
end
local counter_pttl = redis.call('PTTL', counter_key)
if counter_pttl < 0 then
  redis.call('PEXPIRE', counter_key, ttl_ms)
  counter_pttl = ttl_ms
end

local is_blocked = 0
local new_block_pttl = 0
if total_hits > limit then
  is_blocked = 1
  if block_duration_ms > 0 then
    redis.call('SET', block_key, '1', 'PX', block_duration_ms)
    new_block_pttl = block_duration_ms
  end
end

return { total_hits, counter_pttl, is_blocked, new_block_pttl }
`;

@Injectable()
export class ThrottlerRedisStorageService implements ThrottlerStorage, OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(@Inject(ORBIT_ENV) env: OrbitEnv) {
    // A dedicated connection, separate from QueueModule's BullMQ
    // connection: BullMQ's `IRedisClient` abstraction deliberately
    // doesn't expose `EVAL`/raw commands (see HealthController's own
    // comment on the same limitation), and mixing a Lua-scripted
    // workload onto a connection BullMQ also manages internally would
    // be an unnecessary coupling between two unrelated concerns.
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // Hash-tagged so the counter and block key always land on the same
    // Redis Cluster shard, should this ever run against a cluster
    // (EVALs touching multiple keys require same-shard keys there).
    const counterKey = `throttler:{${key}}:${throttlerName}`;
    const blockKey = `throttler:{${key}}:${throttlerName}:blocked`;

    const [totalHits, timeToExpireMs, isBlockedRaw, timeToBlockExpireMs] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      counterKey,
      blockKey,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpireMs / 1000),
      isBlocked: isBlockedRaw === 1,
      timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
    };
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
