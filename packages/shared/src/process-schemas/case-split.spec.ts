import { describe, expect, it } from 'vitest';
import { MAX_ACTIVE_SPLIT_CHILDREN, decideSplit, rollUpChildren } from './case-split';

const intent = (key: string, confidence = 0.9) => ({ key, confidence, evidenceRefs: [] });
const triage = (over: Partial<Parameters<typeof decideSplit>[0]> = {}) => ({ intents: [intent('A'), intent('B')], riskFlags: ['MULTIPLE_INTENTS'], proposedBusinessGoals: [] as string[], ...over });
const child = (title: string, status: string) => ({ title, status });

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

  it('kein Anliegen geht verloren: auch über der Zahl gleichzeitiger Bearbeitung entstehen alle Teilvorgänge', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((k) => intent(k));
    expect(decideSplit(triage({ intents: many })).children.map((c) => c.intentKey)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('der Hauptvorgang schließt erst, wenn alle Teilvorgänge erledigt und mindestens einer abgeschlossen ist; ein gescheiterter schließt nie', () => {
    expect(rollUpChildren([]).outcome).toBe('OPEN');
    expect(rollUpChildren([child('a', 'COMPLETED'), child('b', 'IN_PROGRESS')]).outcome).toBe('OPEN');
    expect(rollUpChildren([child('a', 'COMPLETED'), child('b', 'CANCELLED')]).outcome).toBe('COMPLETE');
    expect(rollUpChildren([child('a', 'CANCELLED'), child('b', 'REJECTED')]).outcome).toBe('OPEN'); // nichts wurde erledigt
    const failed = rollUpChildren([child('a', 'COMPLETED'), child('b', 'FAILED')]);
    expect(failed.outcome).toBe('OPEN');
    expect(failed.attention).toEqual(['Teilvorgang „b“ braucht Prüfung.']);
  });

  it('ein noch nicht begonnenes Anliegen hält den Hauptvorgang offen und wird gestartet, sobald ein Platz frei ist', () => {
    const open = rollUpChildren([child('a', 'COMPLETED'), child('b', 'COMPLETED'), child('c', 'RECEIVED')]);
    expect(open.outcome).toBe('OPEN');
    expect(open.attention).toEqual(['1 Anliegen wartet auf die Bearbeitung.']);
    expect(open.startable).toBe(1);
    // Fünf Anliegen, vier in Arbeit: das fünfte wartet, es gibt keinen freien Platz.
    const busy = rollUpChildren([child('a', 'IN_PROGRESS'), child('b', 'WAITING_FOR_INFORMATION'), child('c', 'WAITING_FOR_APPROVAL'), child('d', 'IN_PROGRESS'), child('e', 'RECEIVED')]);
    expect(MAX_ACTIVE_SPLIT_CHILDREN).toBe(4);
    expect(busy.startable).toBe(0);
    // Ein Teilvorgang, der auf eine Person wartet, belegt keinen Platz – sonst bliebe das fünfte Anliegen unbegrenzt liegen.
    expect(rollUpChildren([child('a', 'MANUAL_REVIEW'), child('b', 'IN_PROGRESS'), child('c', 'IN_PROGRESS'), child('d', 'IN_PROGRESS'), child('e', 'RECEIVED')]).startable).toBe(1);
  });
});
