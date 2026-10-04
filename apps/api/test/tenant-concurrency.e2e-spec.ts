import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { loadEnv } from '@orbit/config';
import { TenantConcurrencyService } from '../src/queue/tenant-concurrency.service';

/**
 * docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md Phase 2 ("Tenant Concurrency
 * Fairness") — real-Redis proof of the per-tenant semaphore
 * `WorkflowRunProcessor` uses, same rationale as
 * `throttler-redis-storage.e2e-spec.ts` (Phase 23): a mocked `ioredis`
 * would only prove the service parses whatever a mock returns, not that
 * the Lua script's sorted-set logic is actually correct under real
 * concurrent access.
 */
const CATEGORY = 'workflow-runs';

describe('TenantConcurrencyService (real Redis)', () => {
  let service: TenantConcurrencyService;
  let redis: Redis;

  beforeAll(() => {
    const env = loadEnv();
    service = new TenantConcurrencyService(env);
    redis = new Redis(env.REDIS_URL);
  });

  afterAll(async () => {
    await redis.quit();
    (service as unknown as { onApplicationShutdown: () => void }).onApplicationShutdown();
  });

  afterEach(async () => {
    const keys = await redis.keys('tenant-concurrency:workflow-runs:*e2e-tenant-concurrency*');
    if (keys.length > 0) await redis.del(...keys);
  });

  function uniqueTenant(): string {
    return `e2e-tenant-concurrency-${randomUUID()}`;
  }

  it('acquires up to TENANT_MAX_CONCURRENT_WORKFLOW_RUNS slots, then refuses the next one', async () => {
    const tenantId = uniqueTenant();
    const env = loadEnv();
    const limit = env.TENANT_MAX_CONCURRENT_WORKFLOW_RUNS;

    for (let i = 0; i < limit; i += 1) {
      const acquired = await service.acquireSlot(CATEGORY, tenantId, `run_${i}`, limit);
      expect(acquired).toBe(true);
    }

    const overLimit = await service.acquireSlot(CATEGORY, tenantId, 'run_over_limit', limit);
    expect(overLimit).toBe(false);
  });

  it('releasing a slot makes room for exactly one more acquire', async () => {
    const tenantId = uniqueTenant();
    const env = loadEnv();
    const limit = env.TENANT_MAX_CONCURRENT_WORKFLOW_RUNS;
    for (let i = 0; i < limit; i += 1) {
      await service.acquireSlot(CATEGORY, tenantId, `run_${i}`, limit);
    }
    expect(await service.acquireSlot(CATEGORY, tenantId, 'still_blocked', limit)).toBe(false);

    await service.releaseSlot(CATEGORY, tenantId, 'run_0');

    expect(await service.acquireSlot(CATEGORY, tenantId, 'now_fits', limit)).toBe(true);
    expect(await service.acquireSlot(CATEGORY, tenantId, 'still_over', limit)).toBe(false);
  });

  it('tracks each tenant independently — one tenant at its limit does not block another', async () => {
    const tenantA = uniqueTenant();
    const tenantB = uniqueTenant();
    const env = loadEnv();
    const limit = env.TENANT_MAX_CONCURRENT_WORKFLOW_RUNS;

    for (let i = 0; i < limit; i += 1) {
      await service.acquireSlot(CATEGORY, tenantA, `run_${i}`, limit);
    }
    expect(await service.acquireSlot(CATEGORY, tenantA, 'blocked', limit)).toBe(false);

    expect(await service.acquireSlot(CATEGORY, tenantB, 'run_0', limit)).toBe(true);
  });

  it('handles N concurrent acquire attempts atomically: exactly the limit succeed, no more and no fewer', async () => {
    const tenantId = uniqueTenant();
    const env = loadEnv();
    const limit = env.TENANT_MAX_CONCURRENT_WORKFLOW_RUNS;
    const attempts = limit * 2;

    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) => service.acquireSlot(CATEGORY, tenantId, `run_${i}`, limit)),
    );

    expect(results.filter(Boolean)).toHaveLength(limit);
    expect(results.filter((r) => !r)).toHaveLength(attempts - limit);
  });

  it('a stale (crashed-worker-leaked) slot does not count toward the limit, and is purged as a side effect of the next acquire attempt', async () => {
    const tenantId = uniqueTenant();
    const key = `tenant-concurrency:${CATEGORY}:${tenantId}`;
    const env = loadEnv();
    const limit = env.TENANT_MAX_CONCURRENT_WORKFLOW_RUNS;

    // Set up the pre-state directly via Redis (not via the service —
    // acquireSlot() always cleans stale entries as part of its own
    // script, so building this state through the service itself would
    // clean the stale entry away before the scenario is even set up).
    // One entry from long before STALE_AFTER_MS (15 min) — as if a
    // worker crashed after acquire() but before release() — plus
    // exactly `limit` genuinely fresh entries.
    await redis.zadd(key, Date.now() - 20 * 60 * 1000, 'leaked_run');
    for (let i = 0; i < limit; i += 1) {
      await redis.zadd(key, Date.now(), `fresh_${i}`);
    }
    expect(await redis.zcard(key)).toBe(limit + 1);

    // Blocked by the `limit` genuinely fresh entries alone — the stale
    // one must not have contributed to this being over capacity.
    expect(await service.acquireSlot(CATEGORY, tenantId, 'blocked_by_fresh_entries', limit)).toBe(false);
    // ...yet the stale entry was purged as a side effect of that same call.
    expect(await redis.zrange(key, 0, -1)).not.toContain('leaked_run');
    expect(await redis.zcard(key)).toBe(limit);

    await service.releaseSlot(CATEGORY, tenantId, 'fresh_0');
    expect(await service.acquireSlot(CATEGORY, tenantId, 'fits_now', limit)).toBe(true);
  });
});
