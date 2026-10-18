import { describe, expect, it } from 'vitest';
import { evaluateAdHocCompletion } from './adhoc-completion';

describe('Abschlussnachweis für frei geplante Abläufe (FA-09)', () => {
  it('ein Plan ohne jede Wirkung (nur Zusammenfassung/Aufgabe) schließt NICHT ab', () => {
    const result = evaluateAdHocCompletion({ allOtherNodesDone: true, effects: [] });
    expect(result).toMatchObject({ met: false, reason: 'NO_CLOSING_PROOF' });
  });

  it('eine interne Meldung oder eine Aufgabe ist kein Abschlussnachweis', () => {
    const result = evaluateAdHocCompletion({ allOtherNodesDone: true, effects: [{ capabilityKey: 'staff.notify' }, { capabilityKey: 'task.create' }] });
    expect(result.met).toBe(false);
  });

  it('Rückfrage, Eingangsbestätigung und Anhang anfordern lassen das Anliegen offen', () => {
    for (const purpose of ['CLARIFICATION', 'ACKNOWLEDGEMENT', 'ATTACHMENT_REQUEST']) {
      expect(evaluateAdHocCompletion({ allOtherNodesDone: true, effects: [{ capabilityKey: 'email.send', purpose }] }).met).toBe(false);
    }
  });

  it('eine versendete inhaltliche Antwort schließt ab und nennt ihren Nachweis', () => {
    for (const purpose of ['INFORMATION', 'STATUS_UPDATE', 'QUOTE_DELIVERY', 'APPOINTMENT_CONFIRMATION']) {
      const result = evaluateAdHocCompletion({ allOtherNodesDone: true, effects: [{ capabilityKey: 'email.send', purpose }] });
      expect(result).toMatchObject({ met: true, reason: 'PROVEN', evidence: [`email.send/${purpose}`] });
    }
  });

  it('auch ein Nachweis genügt nicht, solange andere Schritte des Plans offen sind', () => {
    const result = evaluateAdHocCompletion({ allOtherNodesDone: false, effects: [{ capabilityKey: 'email.send', purpose: 'INFORMATION' }] });
    expect(result).toMatchObject({ met: false, reason: 'NODES_PENDING' });
  });

  it('derselbe Zweck an einer anderen Fähigkeit zählt nicht (ein Entwurf ist keine Antwort)', () => {
    expect(evaluateAdHocCompletion({ allOtherNodesDone: true, effects: [{ capabilityKey: 'communication.draft', purpose: 'INFORMATION' }] }).met).toBe(false);
  });
});
