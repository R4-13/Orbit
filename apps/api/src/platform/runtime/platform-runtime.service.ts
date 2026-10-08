import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { assessRuntime, type QueueSnapshot, type RuntimeHealth, type WorkBacklog } from '@orbit/shared';
import { STALE_IN_PROGRESS_MS } from '../../process/process-sweep.service';
import { PrismaService } from '../../prisma/prisma.service';
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
    private readonly prisma: PrismaService,
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

  /**
   * Arbeitsstand (Amendment 03 §16.2) über alle Mandanten: nur Zähler aus den Betriebstabellen (Erwartungen, Schrittzustände, Sperren, Aktionen). „Hängend“
   * entspricht genau dem Kriterium, mit dem der Sweep einen Vorgang wieder aufnimmt: in Bearbeitung, seit Minuten ohne Änderung, ohne gültige Sperre, mit aktivem Plan.
   */
  async backlog(now = new Date()): Promise<WorkBacklog> {
    const stale = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
    const day = new Date(now.getTime() - 24 * 3_600_000);
    const [openWaits, overdueWaits, scheduledRetries, dueRetries, stuckCases, casesInReview, unknownOutcomes, failedSteps24h] = await this.prisma.withRlsBypass((tx) =>
      Promise.all([
        tx.waitSubscription.count({ where: { status: 'WAITING' } }),
        tx.waitSubscription.count({ where: { status: 'WAITING', deadlineAt: { lt: now } } }),
        tx.processPlanNode.count({ where: { state: 'PLANNED', retryAt: { gt: now }, plan: { status: 'ACTIVE' } } }),
        tx.processPlanNode.count({ where: { state: 'PLANNED', retryAt: { lte: now }, plan: { status: 'ACTIVE' } } }),
        tx.case.count({ where: { orchestrationStatus: 'IN_PROGRESS', updatedAt: { lt: stale }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }], processPlans: { some: { status: 'ACTIVE' } } } }),
        tx.case.count({ where: { orchestrationStatus: 'MANUAL_REVIEW' } }),
        tx.actionIntent.count({ where: { status: 'OUTCOME_UNKNOWN' } }),
        tx.processPlanNode.count({ where: { state: 'FAILED', completedAt: { gte: day } } }),
      ]),
    );
    return { checkedAt: now.toISOString(), openWaits, overdueWaits, scheduledRetries, dueRetries, stuckCases, casesInReview, unknownOutcomes, failedSteps24h };
  }
}
