import { BlueprintDefinitionSchema, type BlueprintDefinition } from './blueprint';
import type { CapabilityDefinition } from './capability';
import { collectReferences, expressionDepth, MAX_EXPRESSION_DEPTH } from './expressions';
import { validatePlan, type PlanIssue } from './plan-validator';

/**
 * Amendment 02 §8.5 / §21.4 — static validation of a Blueprint before it may
 * leave DRAFT. Pure: the capability catalogue is passed in. A blueprint that
 * names an unknown capability, an unreachable graph, an invented parameter or
 * a free-form constraint is rejected here, never at runtime.
 */
export interface BlueprintValidationResult {
  valid: boolean;
  issues: PlanIssue[];
  blueprint?: BlueprintDefinition;
}

export function validateBlueprintDefinition(input: unknown, catalogue: ReadonlyMap<string, CapabilityDefinition>): BlueprintValidationResult {
  const issues: PlanIssue[] = [];
  const error = (code: string, message: string, extra: Partial<PlanIssue> = {}): void => {
    issues.push({ code, severity: 'ERROR', check: extra.check ?? 2, message, ...extra });
  };

  const parsed = BlueprintDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 12)) error('SCHEMA_INVALID', `${issue.path.join('.') || '(root)'}: ${issue.message}`, { check: 1 });
    return { valid: false, issues };
  }
  const blueprint = parsed.data;

  for (const key of blueprint.allowedCapabilities) {
    if (!catalogue.has(key)) error('CAPABILITY_UNKNOWN', `Die Fähigkeit "${key}" existiert nicht im Katalog.`);
  }
  if (new Set(blueprint.allowedCapabilities).size !== blueprint.allowedCapabilities.length) error('CAPABILITY_DUPLICATE', 'allowedCapabilities enthält Duplikate.');

  const factKeys = blueprint.requiredFacts.map((f) => f.key);
  if (new Set(factKeys).size !== factKeys.length) error('REQUIRED_FACT_DUPLICATE', 'requiredFacts enthält doppelte Schlüssel.');
  for (const fact of blueprint.requiredFacts) {
    if (fact.when && expressionDepth(fact.when) > MAX_EXPRESSION_DEPTH) error('EXPRESSION_TOO_DEEP', `Bedingung für "${fact.key}" ist zu tief verschachtelt.`, { check: 1 });
  }

  const resolver = blueprint.dynamicRequirements?.resolverCapability;
  if (resolver) {
    if (!catalogue.has(resolver)) error('RESOLVER_UNKNOWN', `Der Requirement-Resolver "${resolver}" existiert nicht.`);
    else if (!blueprint.allowedCapabilities.includes(resolver)) error('RESOLVER_NOT_ALLOWED', `Der Requirement-Resolver "${resolver}" ist nicht in allowedCapabilities.`);
  }

  if (expressionDepth(blueprint.completionCriteria) > MAX_EXPRESSION_DEPTH) error('EXPRESSION_TOO_DEEP', 'completionCriteria ist zu tief verschachtelt.', { check: 10 });
  const completion = collectReferences(blueprint.completionCriteria);
  for (const capability of completion.capabilities) if (!catalogue.has(capability)) error('COMPLETION_UNKNOWN_CAPABILITY', `completionCriteria verweist auf unbekannte Fähigkeit "${capability}".`, { check: 10 });
  const knownRequirements = new Set(factKeys);
  for (const requirement of completion.requirements) {
    if (!knownRequirements.has(requirement) && !resolver) {
      issues.push({ code: 'COMPLETION_UNKNOWN_REQUIREMENT', severity: 'WARNING', check: 10, message: `completionCriteria nutzt die Anforderung "${requirement}", die nicht in requiredFacts steht und nicht dynamisch ermittelt wird.` });
    }
  }
  if (completion.receiptPurposes.size === 0 && completion.requirements.size === 0 && completion.facts.size === 0) {
    error('COMPLETION_NOT_CHECKABLE', 'completionCriteria muss auf Fakten, Anforderungen oder Nachweise (Receipts) verweisen.', { check: 10 });
  }

  if (blueprint.planMode !== 'AD_HOC' && !blueprint.referenceGraph) {
    error('REFERENCE_GRAPH_MISSING', `planMode ${blueprint.planMode} braucht einen referenceGraph.`, { check: 4 });
  }

  if (blueprint.referenceGraph) {
    // The reference graph must itself pass the plan validator. Executability and policy are tenant matters (checked at
    // planning time), so they are assumed available here; unknown facts that the blueprint declares are collectable.
    const executability = new Map([...catalogue.keys()].map((key) => [key, { executable: true, reasons: [] as string[] }]));
    const policyModes = new Map<string, 'REQUIRE_APPROVAL'>();
    for (const cap of catalogue.values()) {
      policyModes.set(cap.policyAction, 'REQUIRE_APPROVAL');
      for (const action of Object.values(cap.policyActionByPurpose ?? {})) policyModes.set(action, 'REQUIRE_APPROVAL');
    }
    const result = validatePlan(
      {
        goalKeys: blueprint.goals,
        nodes: blueprint.referenceGraph.nodes,
        edges: blueprint.referenceGraph.edges,
        conciseExplanation: blueprint.title,
      },
      {
        blueprint,
        capabilities: catalogue,
        executability,
        knownFactKeys: new Set(),
        collectableFactKeys: new Set(factKeys),
        policyModes,
        limits: { maxSteps: blueprint.limits?.maxSteps ?? 60, maxExternalActions: 10, maxAutoQuestions: blueprint.limits?.maxAutoQuestions ?? 10 },
      },
    );
    for (const issue of result.issues) issues.push({ ...issue, message: `Referenzgraph: ${issue.message}` });
  }

  return { valid: !issues.some((i) => i.severity === 'ERROR'), issues, blueprint };
}
