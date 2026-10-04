import { z } from 'zod';
import { ExprSchema } from './expressions';
import { PlanEdgeSchema, PlanNodeSchema } from './plan';

/**
 * Amendment 02 §8 — the versioned, declarative Process Blueprint. It is not a
 * prompt document: it names goals, triggers, facts, allowed capabilities,
 * waits, constraints and deterministic completion criteria. Unknown
 * execution-relevant keys are rejected (`.strict()`); purely descriptive
 * extras belong in `metadata` (§8.6).
 */
export const BLUEPRINT_SCHEMA_VERSION = '1.0' as const;

export const BLUEPRINT_STATUSES = ['DRAFT', 'VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED', 'SUSPENDED', 'DEPRECATED', 'ARCHIVED'] as const;
export type BlueprintStatus = (typeof BLUEPRINT_STATUSES)[number];

/** §8.2 lifecycle. Only PUBLISHED (and tenant-activated) may start production runs; a published version is immutable. */
export const BLUEPRINT_TRANSITIONS: Record<BlueprintStatus, readonly BlueprintStatus[]> = {
  DRAFT: ['VALIDATING'],
  VALIDATING: ['DRAFT', 'TESTING'],
  TESTING: ['DRAFT', 'STAGED'],
  STAGED: ['DRAFT', 'PUBLISHED'],
  PUBLISHED: ['SUSPENDED', 'DEPRECATED'],
  SUSPENDED: ['PUBLISHED', 'DEPRECATED'],
  DEPRECATED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionBlueprint(from: BlueprintStatus, to: BlueprintStatus): boolean {
  return BLUEPRINT_TRANSITIONS[from].includes(to);
}

/**
 * §8.5: "constraints werden auf bekannte technische Validatoren/Policies abgebildet; freie Schlüssel ohne
 * Implementierung werden abgelehnt." Each key here has a deterministic implementation in the plan validator / runtime.
 */
export const KNOWN_CONSTRAINTS = [
  'forbid_unverified_prices',
  'require_policy_before_writes',
  'prevent_duplicate_deliveries',
  'require_human_resolution_for_fact_conflicts',
] as const;
export type KnownConstraint = (typeof KNOWN_CONSTRAINTS)[number];

/** Named fact validations a requirement may reference; each is implemented in the requirements resolver. */
export const KNOWN_FACT_VALIDATIONS = ['verified_reply_target'] as const;

export const PLAN_MODES = ['FIXED', 'CONSTRAINED_ADAPTIVE', 'AD_HOC'] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

const constraintsShape = Object.fromEntries(KNOWN_CONSTRAINTS.map((key) => [key, z.boolean().optional()])) as Record<KnownConstraint, z.ZodOptional<z.ZodBoolean>>;

export const RequiredFactSchema = z
  .object({
    key: z.string().min(1).max(120),
    /** Value type from the fact-type registry (`email`, `string`, `object`, `money`, …). */
    type: z.string().min(1).max(40),
    validation: z.enum(KNOWN_FACT_VALIDATIONS).optional(),
    /** Conditional requirement: only required when this holds. */
    when: ExprSchema.optional(),
    /** Business wording for the clarification question. */
    question: z.string().max(300).optional(),
  })
  .strict();

export const LimitsSchema = z
  .object({
    maxPlannerCalls: z.number().int().positive().max(50).optional(),
    maxReplans: z.number().int().min(0).max(20).optional(),
    maxSteps: z.number().int().positive().max(200).optional(),
    maxAutoQuestions: z.number().int().min(0).max(10).optional(),
    maxReminders: z.number().int().min(0).max(10).optional(),
    maxRuntimeHours: z.number().positive().max(24 * 90).optional(),
  })
  .strict();

export const BlueprintDefinitionSchema = z
  .object({
    schemaVersion: z.literal(BLUEPRINT_SCHEMA_VERSION),
    key: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'Schlüssel: Großbuchstaben, Ziffern, Unterstrich.'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version im Format MAJOR.MINOR.PATCH.'),
    /** Accepted for compatibility with the documented YAML form; the stored lifecycle status lives on the registry row. */
    status: z.enum(BLUEPRINT_STATUSES).optional(),
    title: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    goals: z.array(z.string().min(1).max(120)).min(1).max(10),
    triggers: z.array(z.object({ type: z.literal('communication.received'), direction: z.enum(['INBOUND', 'OUTBOUND']).optional() }).strict()).min(1).max(5),
    intentHints: z.array(z.string().min(1).max(120)).max(20).default([]),
    requiredFacts: z.array(RequiredFactSchema).max(50).default([]),
    dynamicRequirements: z.object({ resolverCapability: z.string().min(1).max(120) }).strict().optional(),
    allowedCapabilities: z.array(z.string().min(1).max(120)).min(1).max(40),
    /** Highest autonomy this process may ever reach; the effective policy can only be stricter (§14.2). */
    maxAutonomy: z.enum(['DISABLED', 'SUGGEST_ONLY', 'REQUIRE_APPROVAL', 'AUTONOMOUS']).optional(),
    planMode: z.enum(PLAN_MODES),
    /** The base graph the planner instantiates or adapts (required for FIXED and CONSTRAINED_ADAPTIVE). */
    referenceGraph: z.object({ nodes: z.array(PlanNodeSchema).min(1).max(60), edges: z.array(PlanEdgeSchema).max(120) }).strict().optional(),
    constraints: z.object(constraintsShape).strict().default({}),
    limits: LimitsSchema.optional(),
    waitRules: z
      .array(
        z
          .object({
            eventType: z.literal('communication.received'),
            correlation: z.literal('SAME_CASE'),
            timeoutPolicyRef: z.string().max(120).optional(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    completionCriteria: ExprSchema,
    /** Descriptive extras only (owner, revision notes, quality notes) — never read by the runtime. */
    metadata: z.record(z.string().max(60), z.unknown()).optional(),
  })
  .strict();

export type BlueprintDefinition = z.infer<typeof BlueprintDefinitionSchema>;
