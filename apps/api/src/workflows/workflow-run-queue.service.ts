import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { WORKFLOW_RUNS_QUEUE } from '../queue/queue.tokens';
import { WorkflowRunnerService } from './workflow-runner.service';

export interface WorkflowRunJobData {
  tenantId: string;
  actorUserId: string;
  workflowRunId: string;
}

/**
 * docs/SCALABILITY_CONCEPT.md — the producer side of the queue-backed
 * workflow trigger. Creates the `WorkflowRun` row synchronously
 * (`WorkflowRunnerService.createQueuedRun()`) so the caller has an id to
 * poll immediately, then enqueues a job for `apps/api/worker`'s
 * `WorkflowRunProcessor` to actually execute — outside the HTTP
 * request/response cycle. `attempts: 1` (no automatic retry) is the
 * deliberate, documented starting point until the retry-idempotency
 * question in the concept doc is resolved (`WorkflowRunnerService`
 * doesn't yet support resuming a partially-run workflow from a specific
 * step — a naive retry would start the whole run over).
 *
 * No per-tenant concurrency grouping *here*: BullMQ's job `group` option
 * (docs/SCALABILITY_CONCEPT.md's original "noisy neighbor" idea) is a
 * BullMQ **Pro** (paid) feature, not available in the open-source
 * `bullmq` package this project depends on — verified against the
 * installed version's `JobsOptions` type, which has no `group` field.
 * The "noisy neighbor" protection itself is **not** missing anymore —
 * `WorkflowRunProcessor` enforces a per-tenant concurrency ceiling
 * (`TenantConcurrencyService`, docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md
 * Phase 2) on the consumer side instead, since the producer side (this
 * file) has no way to know how many of a tenant's other runs are
 * currently executing elsewhere in the worker pool.
 */
@Injectable()
export class WorkflowRunQueueService {
  constructor(
    @InjectQueue(WORKFLOW_RUNS_QUEUE) private readonly queue: Queue<WorkflowRunJobData>,
    private readonly runner: WorkflowRunnerService,
  ) {}

  async enqueueTrigger(
    tenantId: string,
    actorUserId: string,
    key: string,
    triggerInput: Record<string, unknown>,
  ): Promise<{ workflowRunId: string }> {
    const { workflowRunId } = await this.runner.createQueuedRun(tenantId, key, triggerInput);
    await this.queue.add('run', { tenantId, actorUserId, workflowRunId }, { attempts: 1 });
    return { workflowRunId };
  }
}
