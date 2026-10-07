/**
 * Betriebszustand der Hintergrundverarbeitung (Amendment 03 §22): Queues und Worker. Reine, deterministische Bewertung echter Messwerte – es werden keine
 * Werte erfunden. Ohne verbundenen Worker wird nichts bearbeitet; das ist der wichtigste Befund und steht an erster Stelle.
 */
export type RuntimeStatus = 'OK' | 'DEGRADED' | 'DOWN';

export interface QueueSnapshot {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  /** Fehlgeschlagene Aufträge, die noch aufbewahrt werden (Verlauf; ändert die Bewertung nicht). */
  failed: number;
  /** Verbundene Worker für diese Queue. */
  workers: number;
  /** Alter des ältesten wartenden Auftrags in Sekunden; `null`, wenn nichts wartet. */
  oldestWaitingAgeSec: number | null;
}

export interface QueueHealth extends QueueSnapshot {
  status: RuntimeStatus;
  /** Fachliche Erklärung; leer bei OK. */
  note: string;
}

/** Ein wartender Auftrag, der älter ist, gilt als Stau (die Verarbeitung kommt nicht hinterher). */
export const QUEUE_STALL_SECONDS = 300;

export function assessQueue(snapshot: QueueSnapshot, stallSeconds = QUEUE_STALL_SECONDS): QueueHealth {
  if (snapshot.workers === 0) {
    return { ...snapshot, status: 'DOWN', note: 'Kein Worker verbunden: Aufträge dieser Warteschlange werden nicht bearbeitet.' };
  }
  if (snapshot.oldestWaitingAgeSec !== null && snapshot.oldestWaitingAgeSec > stallSeconds) {
    const minutes = Math.floor(snapshot.oldestWaitingAgeSec / 60);
    return { ...snapshot, status: 'DEGRADED', note: `Der älteste wartende Auftrag wartet seit ${minutes} Minuten; die Verarbeitung kommt nicht hinterher.` };
  }
  return { ...snapshot, status: 'OK', note: '' };
}

const SEVERITY: Record<RuntimeStatus, number> = { OK: 0, DEGRADED: 1, DOWN: 2 };

export interface RuntimeHealth {
  status: RuntimeStatus;
  checkedAt: string;
  queues: QueueHealth[];
}

/** Gesamtzustand = schlechtester Zustand einer Queue; ohne Queues ist nichts gemessen (DOWN, nie ein stilles OK). */
export function assessRuntime(snapshots: readonly QueueSnapshot[], checkedAt: Date, stallSeconds = QUEUE_STALL_SECONDS): RuntimeHealth {
  const queues = snapshots.map((s) => assessQueue(s, stallSeconds));
  const status = queues.reduce<RuntimeStatus>((worst, q) => (SEVERITY[q.status] > SEVERITY[worst] ? q.status : worst), queues.length === 0 ? 'DOWN' : 'OK');
  return { status, checkedAt: checkedAt.toISOString(), queues };
}
