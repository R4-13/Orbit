import { ProcessingPathConflictError } from '@orbit/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Konzept Flexible Autonomie §9.1 / Addendum ADD-5.3: ein Vorgang hat zu jedem Zeitpunkt genau einen Bearbeitungsweg.
 *
 *  - `ENGINE`: die Prozess-Engine (Orchestrator, Plan) – sobald ein Plan existiert, gleich welcher Herkunft.
 *  - `LEGACY`: der Altweg (Agenten/Workflows) – wenn Workflow-Läufe existieren, aber nie ein Plan.
 *  - `NONE`: noch nichts gestartet.
 *
 * Der Weg wird aus vorhandenen Daten abgeleitet (keine zweite Statusspalte, Governance §5.3) und an beiden Einstiegen gegengeprüft. Ein Wechsel geschieht nie
 * stillschweigend; eine ausdrückliche Übernahme beendet erst den einen Weg und startet dann den anderen (nicht gebaut, siehe Konzept 9.1).
 */
export type ProcessingPath = 'ENGINE' | 'LEGACY' | 'NONE';

type Scoped = ReturnType<PrismaService['forTenantId']>;

export async function processingPathOf(scoped: Scoped, caseId: string): Promise<ProcessingPath> {
  if ((await scoped.processPlan.count({ where: { caseId } })) > 0) return 'ENGINE';
  if ((await scoped.workflowRun.count({ where: { caseId } })) > 0) return 'LEGACY';
  return 'NONE';
}

/** Wirft, wenn der Vorgang bereits auf dem anderen Weg bearbeitet wird oder wurde. */
export async function assertProcessingPath(scoped: Scoped, caseId: string, wanted: Exclude<ProcessingPath, 'NONE'>): Promise<void> {
  const current = await processingPathOf(scoped, caseId);
  if (current === 'NONE' || current === wanted) return;
  throw new ProcessingPathConflictError(
    wanted === 'ENGINE'
      ? 'Dieser Vorgang wird bereits im bisherigen Ablauf (Agenten/Workflows) bearbeitet und kann nicht zusätzlich von der Prozess-Engine übernommen werden.'
      : 'Dieser Vorgang wird bereits von der Prozess-Engine bearbeitet und kann nicht zusätzlich im bisherigen Ablauf (Agenten/Workflows) laufen.',
    { caseId, current, wanted },
  );
}
