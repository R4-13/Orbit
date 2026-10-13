import { DEFAULT_CAPABILITIES, validatePlan, type PlanValidationContext } from '@orbit/shared';
import { buildEmergencyProcedure } from './emergency-procedure';

const capabilities = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const executability = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, { executable: true, reasons: [] as string[] }]));
const policyModes = new Map<string, 'AUTONOMOUS' | 'REQUIRE_APPROVAL' | 'DISABLED'>([
  ['context.lookup', 'AUTONOMOUS'],
  ['staff.notify', 'AUTONOMOUS'],
  ['email.draft', 'AUTONOMOUS'],
  ['email.send.acknowledgement', 'REQUIRE_APPROVAL'],
]);
const ctx = (over: Partial<PlanValidationContext> = {}): PlanValidationContext => ({
  capabilities,
  executability,
  knownFactKeys: new Set(),
  collectableFactKeys: new Set(),
  policyModes,
  limits: { maxSteps: 30, maxExternalActions: 6, maxAutoQuestions: 2 },
  ...over,
});
const errors = (r: ReturnType<typeof validatePlan>) => r.issues.filter((i) => i.severity === 'ERROR').map((i) => i.code);

describe('Notfallverfahren', () => {
  it('besteht die Plan-Prüfung mit Bestätigung an den Absender', () => {
    const result = validatePlan(buildEmergencyProcedure({ message: 'Notfall: Rohrbruch', acknowledgeSender: true }), ctx());
    expect(errors(result)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('besteht die Plan-Prüfung ohne Bestätigung (Absender ungeeignet oder Versand nicht möglich)', () => {
    const procedure = buildEmergencyProcedure({ message: 'Notfall: Rohrbruch', acknowledgeSender: false });
    expect(procedure.nodes.map((n) => n.id)).toEqual(['sender_check', 'notify_staff', 'human_takes_over']);
    expect(errors(validatePlan(procedure, ctx()))).toEqual([]);
  });

  it('die Bestätigung umgeht die Regel nicht: sie ist ein Zweck von email.send und optional', () => {
    const procedure = buildEmergencyProcedure({ message: 'x y z', acknowledgeSender: true });
    const send = procedure.nodes.find((n) => n.id === 'ack_send');
    expect(send?.config.purpose).toBe('ACKNOWLEDGEMENT');
    expect(send?.optional).toBe(true);
    expect(send?.onFailure).toBe('SKIP');
    // Ist die Regel deaktiviert, lehnt die Prüfung den Plan ab, statt ihn stillschweigend zu senden.
    const disabled = new Map(policyModes).set('email.send.acknowledgement', 'DISABLED');
    expect(errors(validatePlan(procedure, ctx({ policyModes: disabled })))).toContain('POLICY_DISABLED');
  });

  it('die Benachrichtigung ist dringend und die Meldung steht fest im Verfahren', () => {
    const procedure = buildEmergencyProcedure({ message: 'Notfall: Rohrbruch', acknowledgeSender: false });
    const notify = procedure.nodes.find((n) => n.id === 'notify_staff');
    expect(notify?.inputs.urgent).toEqual({ literal: true });
    expect(notify?.inputs.message).toEqual({ literal: 'Notfall: Rohrbruch' });
  });
});
