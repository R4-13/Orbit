import { describe, expect, it } from 'vitest';
import { evaluateAdHocCompletion } from './adhoc-completion';
import { GOAL_CATALOGUE, evaluateGoal, evaluateGoals } from './goal-catalogue';

const none = { effects: [], tasksCreated: 0 };

describe('Zielkatalog: überprüfbare, zielbezogene Abschlusskriterien (FA-09)', () => {
  it('Kommunikationsziele brauchen die passende versendete Nachricht – nicht irgendeine Wirkung', () => {
    expect(evaluateGoal('inquiry.answered', none).status).toBe('NOT_ACHIEVED');
    // Rückfrage/Bestätigung beantworten die Anfrage nicht.
    expect(evaluateGoal('inquiry.answered', { effects: [{ capabilityKey: 'email.send', purpose: 'CLARIFICATION' }], tasksCreated: 0 }).status).toBe('NOT_ACHIEVED');
    expect(evaluateGoal('inquiry.answered', { effects: [{ capabilityKey: 'email.send', purpose: 'ACKNOWLEDGEMENT' }], tasksCreated: 0 }).status).toBe('NOT_ACHIEVED');
    expect(evaluateGoal('inquiry.answered', { effects: [{ capabilityKey: 'email.send', purpose: 'INFORMATION' }], tasksCreated: 0 })).toMatchObject({ status: 'ACHIEVED', evidence: ['email.send/INFORMATION'] });
    // ... aber die Bestätigung belegt das Ziel „Eingang bestätigt“.
    expect(evaluateGoal('receipt.acknowledged', { effects: [{ capabilityKey: 'email.send', purpose: 'ACKNOWLEDGEMENT' }], tasksCreated: 0 }).status).toBe('ACHIEVED');
  });

  it('interne Ziele sind ohne E-Mail abschließbar: Meldung an eine Person, Aufgabe, Terminbuchung', () => {
    expect(evaluateGoal('staff.informed', { effects: [{ capabilityKey: 'staff.notify' }], tasksCreated: 0 }).status).toBe('ACHIEVED');
    expect(evaluateGoal('task.created', { effects: [], tasksCreated: 1 }).status).toBe('ACHIEVED');
    expect(evaluateGoal('task.created', none).status).toBe('NOT_ACHIEVED');
    expect(evaluateGoal('appointment.booked', { effects: [{ capabilityKey: 'calendar.book' }], tasksCreated: 0 }).status).toBe('ACHIEVED');
  });

  it('Ziele einer Person werden nie von ORBIT erreicht; unbekannte Ziele ebenfalls nicht', () => {
    expect(evaluateGoal('human.review', { effects: [{ capabilityKey: 'staff.notify' }], tasksCreated: 3 }).status).toBe('NEEDS_HUMAN');
    expect(evaluateGoal('emergency.handled', { effects: [{ capabilityKey: 'staff.notify' }], tasksCreated: 3 }).status).toBe('NEEDS_HUMAN');
    expect(evaluateGoal('topic.reviewed', { effects: [{ capabilityKey: 'email.send', purpose: 'INFORMATION' }], tasksCreated: 1 }).status).toBe('UNKNOWN_GOAL');
  });

  it('mehrere Ziele: erst wenn jedes belegt ist; ohne Ziel nie', () => {
    const evidence = { effects: [{ capabilityKey: 'email.send', purpose: 'INFORMATION' }], tasksCreated: 0 };
    expect(evaluateGoals(['inquiry.answered', 'staff.informed'], evidence).met).toBe(false);
    expect(evaluateGoals(['inquiry.answered', 'staff.informed'], { ...evidence, effects: [...evidence.effects, { capabilityKey: 'staff.notify' }] }).met).toBe(true);
    expect(evaluateGoals([], evidence).met).toBe(false);
  });

  it('jeder Katalogeintrag ist entweder bei einer Person oder hat mindestens ein Kriterium', () => {
    for (const goal of Object.values(GOAL_CATALOGUE)) expect(goal.humanOnly === true || goal.requires.length > 0).toBe(true);
  });
});

describe('Abschluss frei geplanter Abläufe', () => {
  it('„Zusammenfassung → Abschluss“ ohne Nachweis schließt NICHT ab', () => {
    expect(evaluateAdHocCompletion({ allOtherNodesDone: true, goalKeys: ['inquiry.answered'], evidence: none })).toMatchObject({ met: false, reason: 'GOAL_NOT_ACHIEVED' });
  });

  it('eine Zusammenfassung oder Aufgabe schließt nur dann ab, wenn das Ziel genau das ist', () => {
    expect(evaluateAdHocCompletion({ allOtherNodesDone: true, goalKeys: ['inquiry.answered'], evidence: { effects: [{ capabilityKey: 'staff.notify' }], tasksCreated: 1 } }).met).toBe(false);
    expect(evaluateAdHocCompletion({ allOtherNodesDone: true, goalKeys: ['task.created'], evidence: { effects: [], tasksCreated: 1 } })).toMatchObject({ met: true, reason: 'PROVEN' });
  });

  it('ein internes Ziel („Person informieren“) schließt ohne jede E-Mail ab – eine E-Mail ist weder nötig noch allgemein ausreichend', () => {
    const internal = evaluateAdHocCompletion({ allOtherNodesDone: true, goalKeys: ['staff.informed'], evidence: { effects: [{ capabilityKey: 'staff.notify' }], tasksCreated: 0 } });
    expect(internal).toMatchObject({ met: true, evidence: ['staff.notify'] });
    const mailOnly = evaluateAdHocCompletion({ allOtherNodesDone: true, goalKeys: ['staff.informed'], evidence: { effects: [{ capabilityKey: 'email.send', purpose: 'INFORMATION' }], tasksCreated: 0 } });
    expect(mailOnly.met).toBe(false);
  });

  it('Ziele bei einer Person und unbekannte Ziele enden in der Prüfung (GOAL_NEEDS_HUMAN), nicht im Abschluss', () => {
    for (const goal of ['human.review', 'topic.reviewed']) {
      expect(evaluateAdHocCompletion({ allOtherNodesDone: true, goalKeys: [goal], evidence: { effects: [{ capabilityKey: 'staff.notify' }], tasksCreated: 1 } })).toMatchObject({ met: false, reason: 'GOAL_NEEDS_HUMAN' });
    }
  });

  it('auch ein Nachweis genügt nicht, solange andere Schritte des Plans offen sind; ohne Ziel gibt es keinen automatischen Abschluss', () => {
    expect(evaluateAdHocCompletion({ allOtherNodesDone: false, goalKeys: ['staff.informed'], evidence: { effects: [{ capabilityKey: 'staff.notify' }], tasksCreated: 0 } })).toMatchObject({ met: false, reason: 'NODES_PENDING' });
    expect(evaluateAdHocCompletion({ allOtherNodesDone: true, goalKeys: [], evidence: none })).toMatchObject({ met: false, reason: 'NO_GOAL' });
  });
});
