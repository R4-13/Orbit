import { describe, expect, it } from 'vitest';
import { QUEUE_STALL_SECONDS, assessQueue, assessRuntime, type QueueSnapshot } from './runtime-health';

const queue = (over: Partial<QueueSnapshot> = {}): QueueSnapshot => ({ name: 'workflow-runs', waiting: 0, active: 0, delayed: 0, failed: 0, workers: 1, oldestWaitingAgeSec: null, ...over });

describe('Betriebszustand der Queues', () => {
  it('ohne verbundenen Worker: DOWN – auch wenn nichts wartet (es könnte nichts bearbeitet werden)', () => {
    expect(assessQueue(queue({ workers: 0 }))).toMatchObject({ status: 'DOWN' });
    expect(assessQueue(queue({ workers: 0, waiting: 5, oldestWaitingAgeSec: 10 })).note).toContain('Kein Worker');
  });

  it('mit Worker und ohne Stau: OK; fehlgeschlagene Aufträge im Verlauf ändern die Bewertung nicht', () => {
    expect(assessQueue(queue({ waiting: 3, oldestWaitingAgeSec: 20 }))).toMatchObject({ status: 'OK', note: '' });
    expect(assessQueue(queue({ failed: 40 })).status).toBe('OK');
  });

  it('ein zu lange wartender Auftrag ist ein Stau: DEGRADED mit Minutenangabe; genau an der Grenze noch OK', () => {
    expect(assessQueue(queue({ waiting: 2, oldestWaitingAgeSec: QUEUE_STALL_SECONDS })).status).toBe('OK');
    const stalled = assessQueue(queue({ waiting: 2, oldestWaitingAgeSec: 725 }));
    expect(stalled.status).toBe('DEGRADED');
    expect(stalled.note).toContain('12 Minuten');
  });

  it('Gesamtzustand ist der schlechteste; ohne gemessene Queue nie ein stilles OK', () => {
    const at = new Date('2026-10-07T10:00:00Z');
    expect(assessRuntime([queue(), queue({ name: 'channel-sync' })], at).status).toBe('OK');
    expect(assessRuntime([queue(), queue({ name: 'channel-sync', oldestWaitingAgeSec: 999, waiting: 1 })], at).status).toBe('DEGRADED');
    expect(assessRuntime([queue({ oldestWaitingAgeSec: 999, waiting: 1 }), queue({ name: 'channel-sync', workers: 0 })], at).status).toBe('DOWN');
    expect(assessRuntime([], at)).toMatchObject({ status: 'DOWN', queues: [] });
    expect(assessRuntime([queue()], at).checkedAt).toBe('2026-10-07T10:00:00.000Z');
  });
});
