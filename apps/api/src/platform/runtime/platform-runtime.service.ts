import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { assessRuntime, type QueueSnapshot, type RuntimeHealth } from '@orbit/shared';
import { CHANNEL_SYNC_QUEUE, WORKFLOW_RUNS_QUEUE } from '../../queue/queue.tokens';

/**
 * Betriebszustand der Hintergrundverarbeitung für die Plattform (Amendment 03 §22). Misst echte BullMQ-Werte – Auftragszähler, verbundene Worker (Redis
 * `CLIENT LIST`), Alter des ältesten wartenden Auftrags – und bewertet sie mit der reinen Funktion aus `@orbit/shared`. Enthält keine Mandanten- oder
 * Auftragsinhalte, nur Zahlen. Ist Redis nicht erreichbar, schlägt die Messung fehl und wird nicht durch Nullen ersetzt.
 */
@Injectable()
export class PlatformRuntimeService {
  constructor(
    @InjectQueue(WORKFLOW_RUNS_QUEUE) private readonly workflowRuns: Queue,
    @InjectQueue(CHANNEL_SYNC_QUEUE) private readonly channelSync: Queue,
  ) {}

  private async snapshot(queue: Queue): Promise<QueueSnapshot> {
    const [counts, workers, oldest] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      queue.getWorkers(),
      queue.getJobs(['waiting'], 0, 0, true),
    ]);
    const timestamp = oldest[0]?.timestamp;
    return {
      name: queue.name,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      workers: workers.length,
      oldestWaitingAgeSec: timestamp === undefined ? null : Math.max(0, Math.round((Date.now() - timestamp) / 1000)),
    };
  }

  async health(): Promise<RuntimeHealth> {
    const snapshots = await Promise.all([this.snapshot(this.workflowRuns), this.snapshot(this.channelSync)]);
    return assessRuntime(snapshots, new Date());
  }
}
