import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';

const ZSET_PREFIX = 'tenant-concurrency:';

/**
 * Considers a member "stale" (and eligible for automatic cleanup on the
 * next acquire attempt for that same tenant) after this long — a
 * self-healing measure for the case a worker process crashes between
 * `acquire()` and `release()`, which would otherwise permanently leak
 * one slot of that tenant's concurrency budget forever. Generous on
 * purpose: this system's WorkflowRuns are normally fast (mock LLM
 * responses, a handful of tool calls), but a real LLM provider call
 * could legitimately take a while — this is a crash-recovery ceiling,
 * not a normal-operation timeout.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md Phase 2 ("Tenant Concurrency
 * Fairness", docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §62) — caps how many
 * jobs of a given *category* (WorkflowRuns, and since
 * docs/CHANNEL_EVENT_RUNTIME_PLAN.md Increment D also channel sync jobs) a
 * single tenant may have executing concurrently in the shared worker pool,
 * so one tenant with many simultaneous jobs can't starve every other
 * tenant's throughput. `docs/SCALABILITY_CONCEPT.md` already documented
 * that BullMQ's job-group feature (the natural fit for this) is a paid
 * BullMQ Pro feature — this is the "self-built Redis counter" alternative
 * that document named but never implemented.
 *
 * Generalized (originally WorkflowRuns-only — see docs/ASSUMPTIONS.md
 * Channel Event Runtime Increment D) to take an explicit `category` +
 * `limit` per call, since different job kinds reasonably need different
 * ceilings (`TENANT_MAX_CONCURRENT_WORKFLOW_RUNS` vs.
 * `TENANT_MAX_CONCURRENT_CHANNEL_SYNCS`) — the service itself stays
 * category-agnostic, each caller owns its own limit.
 *
 * A Redis-backed distributed semaphore using a per-tenant-per-category
 * sorted set (score = acquisition timestamp, member = the job's own id —
 * already globally unique, no extra id needed). Not a plain INCR/DECR
 * counter: that would leak permanently if a worker process crashes between
 * `acquire()` and `release()`. A sorted set lets `acquire()` purge stale
 * (`STALE_AFTER_MS`-old) entries for that tenant+category on every
 * attempt, self-healing without a separate sweep process.
 *
 * A dedicated `ioredis` connection, not BullMQ's own — same reasoning as
 * `ThrottlerRedisStorageService` (Phase 23): BullMQ's `IRedisClient`
 * abstraction doesn't expose the raw `EVAL`/`ZADD`/etc. commands this
 * needs.
 */
@Injectable()
export class TenantConcurrencyService implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(@Inject(ORBIT_ENV) env: OrbitEnv) {
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  /** Returns `true` if a slot was acquired (caller must `release()` when done), `false` if the tenant is already at its `limit` for this `category`. */
  async acquireSlot(category: string, tenantId: string, memberId: string, limit: number): Promise<boolean> {
    const key = `${ZSET_PREFIX}${category}:${tenantId}`;
    const now = Date.now();
    const result = (await this.redis.eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      memberId,
      now,
      now - STALE_AFTER_MS,
      limit,
      STALE_AFTER_MS,
    )) as number;
    return result === 1;
  }

  async releaseSlot(category: string, tenantId: string, memberId: string): Promise<void> {
    await this.redis.zrem(`${ZSET_PREFIX}${category}:${tenantId}`, memberId);
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local stale_before = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, '-inf', stale_before)

local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, ttl_ms)
return 1
`;
