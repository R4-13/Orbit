import { describe, expect, it } from 'vitest';
import { MAX_SPLIT_CHILDREN, decideSplit, rollUpChildren } from './case-split';

const intent = (key: string, confidence = 0.9) => ({ key, confidence, evidenceRefs: [] });
const triage = (over: Partial<Parameters<typeof decideSplit>[0]> = {}) => ({ intents: [intent('A'), intent('B')], riskFlags: ['MULTIPLE_INTENTS'], proposedBusinessGoals: [] as string[], ...over });

describe('Aufteilung mehrerer Anliegen (ADD-3.1, FX-02/FX-06)', () => {
  it('teilt nur bei dem Hinweis MULTIPLE_INTENTS und mindestens zwei belastbar unterscheidbaren Anliegen', () => {
    expect(decideSplit(triage({ riskFlags: [] })).split).toBe(false);
    expect(decideSplit(triage({ intents: [intent('A')] })).split).toBe(false);
    expect(decideSplit(triage({ intents: [intent('A'), intent('A')] })).split).toBe(false); // doppelt ist nicht getrennt
    expect(decideSplit(triage({ intents: [intent('A'), intent('B', 0.3)] })).split).toBe(false); // unsicher
    const decision = decideSplit(triage());
    expect(decision.split).toBe(true);
    expect(decision.children.map((c) => c.intentKey)).toEqual(['A', 'B']);
  });

  it('ordnet Ziele nur zu, wenn ihre Zahl zu den Anliegen passt – sonst ist das Anliegen das Ziel', () => {
    expect(decideSplit(triage({ proposedBusinessGoals: ['Vertrag kündigen', 'Rechnung klären'] })).children.map((c) => c.goal)).toEqual(['Vertrag kündigen', 'Rechnung klären']);
    expect(decideSplit(triage({ proposedBusinessGoals: ['nur eins'] })).children.map((c) => c.goal)).toEqual(['A', 'B']);
  });

  it('über der Obergrenze geht nichts verloren: der Rest wird genannt', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((k) => intent(k));
    const decision = decideSplit(triage({ intents: many }));
    expect(decision.children).toHaveLength(MAX_SPLIT_CHILDREN);
    expect(decision.overflow).toEqual(['E', 'F']);
  });

  it('der Hauptvorgang schließt erst, wenn alle Teilvorgänge erledigt und mindestens einer abgeschlossen ist; ein gescheiterter schließt nie', () => {
    expect(rollUpChildren([]).outcome).toBe('OPEN');
    expect(rollUpChildren([{ title: 'a', status: 'COMPLETED' }, { title: 'b', status: 'IN_PROGRESS' }]).outcome).toBe('OPEN');
    expect(rollUpChildren([{ title: 'a', status: 'COMPLETED' }, { title: 'b', status: 'CANCELLED' }]).outcome).toBe('COMPLETE');
    expect(rollUpChildren([{ title: 'a', status: 'CANCELLED' }, { title: 'b', status: 'REJECTED' }]).outcome).toBe('OPEN'); // nichts wurde erledigt
    const failed = rollUpChildren([{ title: 'a', status: 'COMPLETED' }, { title: 'b', status: 'FAILED' }]);
    expect(failed.outcome).toBe('OPEN');
    expect(failed.attention).toEqual(['Teilvorgang „b“ braucht Prüfung.']);
  });
});
