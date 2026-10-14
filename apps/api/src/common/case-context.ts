import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Der Vorgang, in dessen Bearbeitung gerade gearbeitet wird (BPF-01). Alle Modellaufrufe innerhalb von `runInCaseContext` werden dem Vorgang zugerechnet – ohne dass
 * jeder Aufrufer den Vorgang weiterreichen muss. Außerhalb (z. B. Triage vor der Anlage) bleibt der Aufruf ohne Vorgang.
 */
const store = new AsyncLocalStorage<{ caseId: string }>();

export function runInCaseContext<T>(caseId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ caseId }, fn);
}

export function currentCaseId(): string | undefined {
  return store.getStore()?.caseId;
}
