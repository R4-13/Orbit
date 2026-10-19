/** Injektions-Schlüssel des Teilvorgangs-Starters. Eigene Datei ohne Importe, damit der Roll-up (vom Orchestrator genutzt) den Starter (nutzt den Orchestrator) ohne Importzyklus auflösen kann. */
export const CHILD_CASE_STARTER = Symbol('CHILD_CASE_STARTER');

export interface ChildCaseStarterPort {
  startPending(tenantId: string, parentCaseId: string, count: number, userId?: string): Promise<number>;
}
