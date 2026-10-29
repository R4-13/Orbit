import { Injectable } from '@nestjs/common';
import type { PlanNode } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CaseEventsService } from './case-events.service';
import type { PlanGraph } from './plan-store.service';

export const MANUAL_TASK_EVENTS = {
  /** Eine Planstelle (manueller Schritt) hat eine Aufgabe angelegt. */
  OPENED: 'task.opened_by_plan',
  /** Eine spätere Planrevision hat dieselbe Arbeit übernommen: die offene Aufgabe wurde aktualisiert statt eine zweite anzulegen. */
  UPDATED: 'task.updated_by_plan',
  /** Die Arbeit gibt es im geltenden Plan nicht mehr: die offene Aufgabe wurde geschlossen (nachvollziehbar, nicht gelöscht). */
  SUPERSEDED: 'task.superseded',
} as const;

/** Der Zusatz, den die Zuordnung einer Antwort der Kundschaft an einer Aufgabe hinterlässt – er bleibt bei der Übernahme erhalten. */
const CUSTOMER_NOTE = /\n\nAntwort der Kundschaft zu diesem Anliegen[\s\S]*$/;

interface Linked {
  taskId: string;
  planId: string;
  nodeKey: string;
  title: string;
}

/**
 * Die Aufgaben der manuellen Planschritte eines Vorgangs (Meilenstein C, Nachbesserung FN-14): eine Aufgabe gehört zu einer **Arbeit** (Planstelle), nicht zu einer Planrevision. Wird neu geplant,
 *  - übernimmt der Schritt, der dieselbe Arbeit meint (gleiche Kennung oder gleicher Titel), die offene Aufgabe – Titel und Beschreibung werden aktualisiert, ein Vermerk der Kundschaft bleibt erhalten,
 *  - wird eine offene Aufgabe, deren Arbeit der geltende Plan nicht mehr vorsieht, geschlossen (CANCELLED, mit Ereignis), und
 *  - bleiben tatsächlich verschiedene Aufgaben nebeneinander bestehen.
 * Die Zuordnung steht in Ereignissen am Vorgang (kein eigenes Schema); jede Änderung ist dort nachvollziehbar.
 */
@Injectable()
export class ManualTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CaseEventsService,
  ) {}

  private async linked(tenantId: string, caseId: string): Promise<Linked[]> {
    const rows = await this.prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: { in: [MANUAL_TASK_EVENTS.OPENED, MANUAL_TASK_EVENTS.UPDATED] } }, orderBy: { sequence: 'asc' }, select: { payload: true } });
    // Je Aufgabe gilt die jüngste Zuordnung (Planrevision und Planstelle, die sie zuletzt trug).
    const latest = new Map<string, Linked>();
    for (const row of rows) {
      const p = row.payload as Partial<Linked> | null;
      if (p?.taskId && p.planId && p.nodeKey) latest.set(p.taskId, { taskId: p.taskId, planId: p.planId, nodeKey: p.nodeKey, title: p.title ?? '' });
    }
    return [...latest.values()];
  }

  /** Legt die Aufgabe eines manuellen Planschritts an – oder übernimmt die offene Aufgabe derselben Arbeit aus einer früheren Planrevision. */
  async open(tenantId: string, caseId: string, step: { planId: string; nodeKey: string; title: string; description: string; dueDate?: Date }): Promise<{ taskId: string; adopted: boolean }> {
    const scoped = this.prisma.forTenantId(tenantId);
    const candidates = (await this.linked(tenantId, caseId)).filter((l) => l.planId !== step.planId && (l.nodeKey === step.nodeKey || l.title === step.title));
    for (const candidate of candidates.reverse()) {
      const task = await scoped.task.findFirst({ where: { id: candidate.taskId, status: 'OPEN' } });
      if (!task) continue;
      const note = CUSTOMER_NOTE.exec(task.description ?? '')?.[0] ?? '';
      await scoped.task.update({ where: { id: task.id }, data: { title: step.title, description: `${step.description}${note}`.slice(0, 4000), ...(step.dueDate ? { dueDate: step.dueDate } : {}) } });
      await this.events.append(tenantId, caseId, { type: MANUAL_TASK_EVENTS.UPDATED, payload: { taskId: task.id, planId: step.planId, nodeKey: step.nodeKey, title: step.title, previousTitle: task.title } });
      return { taskId: task.id, adopted: true };
    }
    const created = await scoped.task.create({ data: { tenantId, caseId, title: step.title, description: step.description, source: 'AGENT', ...(step.dueDate ? { dueDate: step.dueDate } : {}) } });
    await this.events.append(tenantId, caseId, { type: MANUAL_TASK_EVENTS.OPENED, payload: { taskId: created.id, planId: step.planId, nodeKey: step.nodeKey, title: step.title } });
    return { taskId: created.id, adopted: false };
  }

  /**
   * Nach der Aktivierung einer Planrevision: offene Aufgaben früherer Revisionen, deren Arbeit der geltende Plan nicht mehr als noch offenen manuellen Schritt enthält, werden geschlossen. Eine Aufgabe, die eine
   * Person schon bearbeitet hat (erledigt), bleibt unberührt; nur offene werden geschlossen.
   */
  async reconcile(tenantId: string, caseId: string, active: PlanGraph): Promise<number> {
    const scoped = this.prisma.forTenantId(tenantId);
    const open = active.nodes.filter((n) => ['MANUAL_TASK', 'APPROVAL'].includes(n.type) && !['SUCCEEDED', 'SKIPPED', 'CANCELLED', 'SUPERSEDED'].includes(n.state));
    const stillPlanned = open.map((n) => ({ key: n.nodeKey, title: (n.definition as unknown as PlanNode).title ?? n.title }));
    let closed = 0;
    for (const link of await this.linked(tenantId, caseId)) {
      if (link.planId === active.plan.id) continue;
      if (stillPlanned.some((s) => s.key === link.nodeKey || s.title === link.title)) continue;
      const task = await scoped.task.findFirst({ where: { id: link.taskId, status: 'OPEN' } });
      if (!task) continue;
      await scoped.task.update({ where: { id: task.id }, data: { status: 'CANCELLED' } });
      await this.events.append(tenantId, caseId, { type: MANUAL_TASK_EVENTS.SUPERSEDED, payload: { taskId: task.id, title: task.title, byPlanId: active.plan.id, byRevision: active.plan.revision, reason: 'Die Arbeit ist im geltenden Plan nicht mehr als offener Schritt vorgesehen.' } });
      closed += 1;
    }
    return closed;
  }
}
