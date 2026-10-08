import { describe, expect, it } from 'vitest';
import { runtimeTransitions } from './runtime-alerts';
import { assessRuntime, type QueueSnapshot, type RuntimeStatus } from './runtime-health';

const q = (name: string, over: Partial<QueueSnapshot> = {}): QueueSnapshot => ({ name, waiting: 0, active: 0, delayed: 0, failed: 0, workers: 1, oldestWaitingAgeSec: null, ...over });
const health = (...queues: QueueSnapshot[]) => assessRuntime(queues, new Date('2026-10-08T10:00:00Z'));
const state = (entries: Array<[string, RuntimeStatus]>) => new Map(entries);

describe('Alarm bei Zustandswechsel der Hintergrundverarbeitung', () => {
  it('erste Beobachtung in Ordnung: kein Alarm; erste Beobachtung „steht still“: Alarm (ein bestehender Ausfall wird nicht verschwiegen)', () => {
    expect(runtimeTransitions(undefined, health(q('a'), q('b')))).toEqual([]);
    const result = runtimeTransitions(undefined, health(q('a', { workers: 0 }), q('b')));
    expect(result).toEqual([{ queue: 'a', from: null, to: 'DOWN', note: expect.stringContaining('Kein Worker') }]);
  });

  it('unveränderter Zustand meldet nichts – auch nicht bei dauerhaftem Ausfall (keine Wiederholung bei jeder Messung)', () => {
    const down = health(q('a', { workers: 0 }));
    expect(runtimeTransitions(state([['a', 'DOWN']]), down)).toEqual([]);
  });

  it('Ausfall, Verschlechterung und Erholung werden je Queue gemeldet', () => {
    expect(runtimeTransitions(state([['a', 'OK'], ['b', 'OK']]), health(q('a', { workers: 0 }), q('b')))).toEqual([{ queue: 'a', from: 'OK', to: 'DOWN', note: expect.any(String) }]);
    expect(runtimeTransitions(state([['a', 'OK']]), health(q('a', { waiting: 1, oldestWaitingAgeSec: 900 })))).toEqual([{ queue: 'a', from: 'OK', to: 'DEGRADED', note: expect.stringContaining('15 Minuten') }]);
    expect(runtimeTransitions(state([['a', 'DOWN']]), health(q('a')))).toEqual([{ queue: 'a', from: 'DOWN', to: 'OK', note: 'Die Warteschlange arbeitet wieder normal.' }]);
    expect(runtimeTransitions(state([['a', 'DEGRADED']]), health(q('a', { workers: 0 })))).toEqual([{ queue: 'a', from: 'DEGRADED', to: 'DOWN', note: expect.any(String) }]);
  });
});
