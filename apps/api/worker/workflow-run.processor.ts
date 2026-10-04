import { Inject, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../src/config/env.token';
import { TenantConcurrencyService } from '../src/queue/tenant-concurrency.service';
import { WORKFLOW_RUNS_QUEUE } from '../src/queue/queue.tokens';
import { WorkflowRunnerService } from '../src/workflows/workflow-runner.service';
import type { WorkflowRunJobData } from '../src/workflows/workflow-run-queue.service';

const CONCURRENCY_CATEGORY = 'workflow-runs';

/** How long a job waits before re-checking a tenant's concurrency slot — short enough that a freed slot is picked up quickly, long enough not to hammer Redis when a tenant is genuinely at its limit. */
const REQUEUE_DELAY_MS = 2000;

/**
 * docs/SCALABILITY_CONCEPT.md — consumes the `workflow-runs` queue that
 * `WorkflowRunQueueService` (apps/api) enqueues into. Calls the exact
 * same `WorkflowRunnerService.executeQueuedRun()` the synchronous
 * `POST /workflow-definitions/:key/trigger` path is built on — no
 * duplicated execution logic between the sync and async paths.
 *
 * `process()`'s return/throw becomes the BullMQ job's completed/failed
 * result — `executeQueuedRun()` already writes the definitive outcome to
 * the `WorkflowRun` row itself (status/errorMessage) before resolving,
 * so a job failure here only matters for BullMQ's own bookkeeping
 * (`attempts`, dashboards), not for what the client eventually reads via
 * `GET /workflow-definitions/:key/runs`.
 *
 * docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md Phase 2 ("Tenant Concurrency
 * Fairness"): before actually executing, tries to acquire a per-tenant
 * concurrency slot (`TenantConcurrencyService`). If the tenant is
 * already at `TENANT_MAX_CONCURRENT_WORKFLOW_RUNS`, this job
 * deliberately does **not** execute anything and does **not** fail —
 * failing would count against `attempts: 1` (see
 * `WorkflowRunQueueService`'s own doc comment on why retries are
 * deliberately not enabled generally) and looks like a real error on
 * dashboards. Instead it self-requeues an identical job a couple
 * seconds later and returns cleanly — an explicit, visible "deferred",
 * not a disguised retry.
 */
@Processor(WORKFLOW_RUNS_QUEUE)
export class WorkflowRunProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowRunProcessor.name);

  constructor(
    private readonly runner: WorkflowRunnerService,
    private readonly concurrency: TenantConcurrencyService,
    @InjectQueue(WORKFLOW_RUNS_QUEUE) private readonly queue: Queue<WorkflowRunJobData>,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {
    super();
  }

  async process(job: Job<WorkflowRunJobData>): Promise<void> {
    const { tenantId, actorUserId, workflowRunId } = job.data;

    const acquired = await this.concurrency.acquireSlot(
      CONCURRENCY_CATEGORY,
      tenantId,
      workflowRunId,
      this.env.TENANT_MAX_CONCURRENT_WORKFLOW_RUNS,
    );
    if (!acquired) {
      this.logger.log(`Tenant ${tenantId} at its concurrency limit — deferring workflow run ${workflowRunId} by ${REQUEUE_DELAY_MS}ms`);
      await this.queue.add('run', job.data, { attempts: 1, delay: REQUEUE_DELAY_MS });
      return;
    }

    try {
      this.logger.log(`Executing queued workflow run ${workflowRunId} (tenant ${tenantId})`);
      await this.runner.executeQueuedRun(tenantId, actorUserId, workflowRunId);
    } finally {
      await this.concurrency.releaseSlot(CONCURRENCY_CATEGORY, tenantId, workflowRunId);
    }
  }
}
