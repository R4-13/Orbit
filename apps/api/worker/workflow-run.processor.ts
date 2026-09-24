import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { WORKFLOW_RUNS_QUEUE } from '../src/queue/queue.tokens';
import { WorkflowRunnerService } from '../src/workflows/workflow-runner.service';
import type { WorkflowRunJobData } from '../src/workflows/workflow-run-queue.service';

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
 */
@Processor(WORKFLOW_RUNS_QUEUE)
export class WorkflowRunProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowRunProcessor.name);

  constructor(private readonly runner: WorkflowRunnerService) {
    super();
  }

  async process(job: Job<WorkflowRunJobData>): Promise<void> {
    const { tenantId, actorUserId, workflowRunId } = job.data;
    this.logger.log(`Executing queued workflow run ${workflowRunId} (tenant ${tenantId})`);
    await this.runner.executeQueuedRun(tenantId, actorUserId, workflowRunId);
  }
}
