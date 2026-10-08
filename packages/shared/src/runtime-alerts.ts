import type { RuntimeHealth, RuntimeStatus } from './runtime-health';

/**
 * Zustandswechsel der Hintergrundverarbeitung, über die jemand informiert werden muss (Amendment 03 §22). Reine Funktion: dieselbe Messung ergibt nie
 * zweimal denselben Alarm, und eine Erholung wird ebenso gemeldet wie ein Ausfall.
 */
export interface RuntimeTransition {
  queue: string;
  /** `null` = erste Beobachtung seit dem Start der Überwachung. */
  from: RuntimeStatus | null;
  to: RuntimeStatus;
  note: string;
}

/**
 * Regeln: gleicher Zustand wie zuvor ⇒ nichts. Erste Beobachtung „in Ordnung“ ⇒ nichts (kein Alarm beim Start). Erste Beobachtung „nicht in Ordnung“ ⇒ Alarm –
 * ein Ausfall, der schon vor dem Start der Überwachung bestand, darf nicht verschwiegen werden.
 */
export function runtimeTransitions(previous: ReadonlyMap<string, RuntimeStatus> | undefined, current: RuntimeHealth): RuntimeTransition[] {
  const out: RuntimeTransition[] = [];
  for (const q of current.queues) {
    const from = previous?.get(q.name) ?? null;
    if (from === q.status) continue;
    if (from === null && q.status === 'OK') continue;
    out.push({ queue: q.name, from, to: q.status, note: q.status === 'OK' ? 'Die Warteschlange arbeitet wieder normal.' : q.note });
  }
  return out;
}
