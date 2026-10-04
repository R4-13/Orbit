/**
 * BullMQ queue names — a single shared constant so the producer
 * (apps/api) and the consumer (apps/api/worker) never drift apart on a
 * typo'd string. See docs/SCALABILITY_CONCEPT.md for why only one queue
 * exists so far (one job type in production).
 */
export const WORKFLOW_RUNS_QUEUE = 'workflow-runs';
/** docs/CHANNEL_EVENT_RUNTIME_PLAN.md Increment D — carries both the repeatable "scan" job (finds due connections) and the per-connection "poll" job it fans out. */
export const CHANNEL_SYNC_QUEUE = 'channel-sync';
