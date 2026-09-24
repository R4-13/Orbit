/**
 * BullMQ queue names — a single shared constant so the producer
 * (apps/api) and the consumer (apps/api/worker) never drift apart on a
 * typo'd string. See docs/SCALABILITY_CONCEPT.md for why only one queue
 * exists so far (one job type in production).
 */
export const WORKFLOW_RUNS_QUEUE = 'workflow-runs';
