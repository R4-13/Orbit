import { DEFAULT_CAPABILITIES, validatePlan, type PlanProposal, type PlanValidationContext } from '@orbit/shared';
import { PlannerService } from './planner.service';

const capabilities = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const executability = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, { executable: true, reasons: [] as string[] }]));

const ctx = (over: Partial<PlanValidationContext> = {}): PlanValidationContext => ({
  capabilities,
  executability,
  knownFactKeys: new Set(['contact.email']),
  collectableFactKeys: new Set(),
  policyModes: new Map([['staff.notify', 'AUTONOMOUS'], ['context.lookup', 'AUTONOMOUS'], ['requirements.resolve', 'AUTONOMOUS']]),
  limits: { maxSteps: 30, maxExternalActions: 4, maxAutoQuestions: 2 },
  strictBindings: true,
  contractGoalKeys: ['staff.informed'],
  priorClarifications: 0,
  customerQuestionsOpen: 0,
  requirementsAnalyzed: false,
  ...over,
});

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });
const edge = (source: string, target: string) => ({ id: `e_${source}_${target}`, source, target });
const notify = node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte prüfen: neue Anfrage.' } } });

/** Plant hinter das Ergebnis der Anforderungsprüfung, das noch unbekannt ist – das ist reparierbar. */
const behindUnderstanding = (goalKeys: string[]): PlanProposal =>
  ({
    goalKeys,
    nodes: [node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }), node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }), notify, node('done', 'COMPLETE')],
    edges: [edge('ctx', 'reqs'), edge('reqs', 'notify'), edge('notify', 'done')],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Verstehen, dann informieren.',
  }) as unknown as PlanProposal;

// repairDeterministically hängt von keinem Zustand ab; der Planer wird ohne seine Abhängigkeiten angelegt.
const planner = Object.create(PlannerService.prototype) as unknown as {
  repairDeterministically(proposal: PlanProposal, validation: ReturnType<typeof validatePlan>, context: PlanValidationContext, parent: undefined): ReturnType<typeof validatePlan> | undefined;
};

describe('automatisch reparierte Pläne werden erneut vollständig geprüft', () => {
  it('ein reparierbarer Mangel (Planung hinter unbekanntem Verstehen) wird behoben – und der reparierte Plan besteht die volle Prüfung', () => {
    const context = ctx();
    const proposal = behindUnderstanding(['staff.informed']);
    const first = validatePlan(proposal, context);
    expect(first.issues.filter((i) => i.severity === 'ERROR').map((i) => i.code)).toEqual(['REPLAN_AFTER_UNDERSTANDING']);
    const repaired = planner.repairDeterministically(proposal, first, context, undefined);
    expect(repaired?.valid).toBe(true);
    expect(validatePlan(repaired!.proposal as PlanProposal, context).valid).toBe(true);
  });

  it('die Reparatur macht aus einem Plan, der das Ziel des Vorgangs verfehlt, keinen zulässigen: der Planvertrag (Ziele) gilt auch danach', () => {
    const context = ctx({ contractGoalKeys: ['inquiry.answered'] });
    const proposal = behindUnderstanding(['staff.informed']); // streicht das vereinbarte Ziel „Auskunft erteilt“
    const first = validatePlan(proposal, context);
    expect(first.issues.map((i) => i.code)).toContain('REPLAN_AFTER_UNDERSTANDING');
    expect(planner.repairDeterministically(proposal, first, context, undefined)).toBeUndefined();
  });

  it('die Reparatur macht eine nicht ausführbare Fähigkeit nicht zulässig: Berechtigungen und Voraussetzungen werden nach der Reparatur erneut geprüft', () => {
    const blocked = new Map(executability);
    blocked.set('staff.notify', { executable: false, reasons: ['Keine Berechtigung.'] });
    const context = ctx({ executability: blocked });
    const proposal = behindUnderstanding(['staff.informed']);
    const first = validatePlan(proposal, context);
    expect(planner.repairDeterministically(proposal, first, context, undefined)).toBeUndefined();
  });
});
