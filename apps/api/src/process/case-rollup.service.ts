import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { rollUpChildren } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { CHILD_CASE_STARTER, type ChildCaseStarterPort } from './child-case-starter.token';

const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED']);

/**
 * Hauptvorgang einer aufgeteilten Nachricht (FX-02/FX-06): Der Hauptvorgang führt selbst nichts aus, er fasst seine Teilvorgänge zusammen. Er schließt erst, wenn **jeder** Teilvorgang erledigt ist –
 * auch ein noch nicht begonnenes Anliegen hält ihn offen und wird gestartet, sobald ein Platz frei ist. Was Aufmerksamkeit braucht, steht an ihm; sein Status ändert sich dadurch nicht (die
 * Teilvorgänge melden sich selbst).
 */
@Injectable()
export class CaseRollupService {
  private readonly logger = new Logger(CaseRollupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Wirft nie: eine fehlgeschlagene Zusammenfassung darf die Bearbeitung des Teilvorgangs nicht stören. */
  async update(tenantId: string, parentCaseId: string): Promise<void> {
    try {
      const scoped = this.prisma.forTenantId(tenantId);
      const parent = await scoped.case.findFirst({ where: { id: parentCaseId }, select: { id: true, orchestrationStatus: true, attentionReasons: true } });
      if (!parent || TERMINAL.has(parent.orchestrationStatus)) return;
      const load = () => scoped.case.findMany({ where: { parentCaseId }, select: { title: true, orchestrationStatus: true }, orderBy: { createdAt: 'asc' } });
      let children = await load();
      let rollUp = rollUpChildren(children.map((c) => ({ title: c.title, status: c.orchestrationStatus })));
      if (rollUp.startable > 0) {
        // Platz ist frei: nicht begonnene Anliegen werden jetzt bearbeitet (oder gehen mit Begründung an eine Person).
        await this.moduleRef.get<ChildCaseStarterPort>(CHILD_CASE_STARTER, { strict: false }).startPending(tenantId, parentCaseId, rollUp.startable);
        children = await load();
        rollUp = rollUpChildren(children.map((c) => ({ title: c.title, status: c.orchestrationStatus })));
      }
      if (rollUp.outcome === 'COMPLETE') {
        await this.lifecycle.transition(tenantId, parentCaseId, { to: 'COMPLETED', outcome: { code: 'CHILDREN_SETTLED', evidenceRefs: [`${children.length} Teilvorgänge erledigt`] } });
        return;
      }
      const same = parent.attentionReasons.length === rollUp.attention.length && parent.attentionReasons.every((r, i) => r === rollUp.attention[i]);
      if (!same) await scoped.case.update({ where: { id: parentCaseId }, data: { attentionReasons: rollUp.attention } });
    } catch (error) {
      this.logger.warn(`roll-up of case ${parentCaseId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
