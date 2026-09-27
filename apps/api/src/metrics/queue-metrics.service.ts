import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { WORKFLOW_RUNS_QUEUE } from '../queue/queue.tokens';
import { MetricsService } from './metrics.service';

const POLL_INTERVAL_MS = 15_000;

/**
 * `queue_depth` is a pull-based Gauge, not something updated at the
 * moment a job is enqueued/dequeued — BullMQ's `getJobCounts()` is
 * already the authoritative source (used by no one until now; the queue
 * has been running blind since Phase 22, see
 * docs/SCALABILITY_CONCEPT.md). Polls every 15s rather than on every
 * enqueue/dequeue event: cheap, and "queue depth 12 seconds ago" is
 * exactly as useful operationally as "queue depth right now" for a
 * metric meant to catch a queue backing up, not for exact accounting.
 */
@Injectable()
export class QueueMetricsService implements OnModuleInit, OnModuleDestroy {
  private interval: NodeJS.Timeout | undefined;

  constructor(
    @InjectQueue(WORKFLOW_RUNS_QUEUE) private readonly queue: Queue,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(() => {
      this.poll().catch((error: unknown) => console.error('[metrics] Fehler beim Abfragen der Queue-Tiefe', error));
    }, POLL_INTERVAL_MS);
    this.interval.unref();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private async poll(): Promise<void> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    for (const [state, count] of Object.entries(counts)) {
      this.metrics.queueDepth.set({ queue: WORKFLOW_RUNS_QUEUE, state }, count);
    }
  }
}
