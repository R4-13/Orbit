import { DEFAULT_CAPABILITIES, validatePlan, type PlanValidationContext } from '@orbit/shared';
import { buildInformationProcedure, buildStatusProcedure } from './standard-procedures';

const capabilities = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const executability = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, { executable: true, reasons: [] as string[] }]));
const ctx = (): PlanValidationContext => ({
  capabilities,
  executability,
  knownFactKeys: new Set(),
  collectableFactKeys: new Set(),
  strictBindings: true,
  policyModes: new Map([
    ['context.lookup', 'AUTONOMOUS'],
    ['knowledge.answer', 'AUTONOMOUS'],
    ['staff.notify', 'AUTONOMOUS'],
    ['email.draft', 'AUTONOMOUS'],
    ['email.send.information', 'REQUIRE_APPROVAL'],
    ['email.send.acknowledgement', 'REQUIRE_APPROVAL'],
  ]),
  limits: { maxSteps: 30, maxExternalActions: 6, maxAutoQuestions: 2 },
});
const errors = (r: ReturnType<typeof validatePlan>) => r.issues.filter((i) => i.severity === 'ERROR').map((i) => `${i.code}: ${i.message}`);

describe('Standardabläufe', () => {
  it('„Allgemeine Frage“ besteht die strenge Plan-Prüfung', () => {
    expect(errors(validatePlan(buildInformationProcedure({ message: 'Allgemeine Frage – bitte antworten.' }), ctx()))).toEqual([]);
  });
  it('„Nachfrage zum Stand“ besteht die strenge Plan-Prüfung', () => {
    expect(errors(validatePlan(buildStatusProcedure(), ctx()))).toEqual([]);
  });
  it('jeder Zweig der Frage ist bedingt: der nicht gewählte Zweig läuft nicht nach', () => {
    const plan = buildInformationProcedure({ message: 'Allgemeine Frage – bitte antworten.' });
    for (const id of ['reply_draft', 'reply_send', 'answered', 'notify_staff', 'plan_further', 'human_answers']) {
      const incoming = plan.edges.filter((e) => e.target === id);
      expect(incoming.length).toBeGreaterThan(0);
      expect(incoming.every((e) => e.condition !== undefined)).toBe(true);
    }
  });
});
