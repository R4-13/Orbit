import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CaseEventsService } from './case-events.service';
import { OrchestratorService } from './orchestrator.service';

const BATCH = 50;
/** A case that is IN_PROGRESS but untouched for this long, with no live lease, was most likely abandoned by a crashed worker. */
export const STALE_IN_PROGRESS_MS = 2 * 60_000;

export interface SweepResult {
  advanced: number;
  failed: number;
}

/**
 * Durability of the process runtime (Amendment 02 §12.3 / BP-19): state lives in PostgreSQL, a queue job is only the
 * trigger. This sweep — run periodically by the worker — finds every case that has work but no one working on it
 * (unprocessed inbound events after a restart, waits past their deadline, abandoned in-progress cases, retryable steps
 * whose backoff elapsed) and advances it. `advance` is lease-guarded and idempotent, so concurrent sweeps are harmless.
 */
@Injectable()
export class ProcessSweepService {
  private readonly logger = new Logger(ProcessSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CaseEventsService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async sweep(now = new Date()): Promise<SweepResult> {
    const candidates = new Map<string, { tenantId: string; caseId: string }>();
    const add = (tenantId: string, caseId: string): void => {
      candidates.set(`${tenantId}:${caseId}`, { tenantId, caseId });
    };

    for (const c of await this.events.casesWithPendingInbound(BATCH)) add(c.tenantId, c.caseId);

    const { overdueWaits, stale, retries } = await this.prisma.withRlsBypass(async (tx) => ({
      overdueWaits: await tx.waitSubscription.findMany({ where: { status: 'WAITING', deadlineAt: { lt: now } }, select: { tenantId: true, caseId: true }, take: BATCH }),
      stale: await tx.case.findMany({
        where: {
          orchestrationStatus: 'IN_PROGRESS',
          updatedAt: { lt: new Date(now.getTime() - STALE_IN_PROGRESS_MS) },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
          processPlans: { some: { status: 'ACTIVE' } },
        },
        select: { tenantId: true, id: true },
        take: BATCH,
      }),
      retries: await tx.processPlanNode.findMany({ where: { state: 'PLANNED', retryAt: { lte: now }, plan: { status: 'ACTIVE' } }, select: { tenantId: true, plan: { select: { caseId: true } } }, take: BATCH }),
    }));
    for (const w of overdueWaits) add(w.tenantId, w.caseId);
    for (const c of stale) add(c.tenantId, c.id);
    for (const n of retries) add(n.tenantId, n.plan.caseId);

    let advanced = 0;
    let failed = 0;
    for (const { tenantId, caseId } of candidates.values()) {
      try {
        await this.orchestrator.advance(tenantId, caseId);
        advanced += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`sweep: advance failed for case ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { advanced, failed };
  }
}
