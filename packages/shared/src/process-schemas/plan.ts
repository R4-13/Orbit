import { z } from 'zod';
import { ExprSchema, OperandSchema } from './expressions';

/**
 * Amendment 02 §8.3 / §11.2 — the generic process grammar. Node types are
 * the closed set below (the technical names may be mapped onto existing
 * workflow nodes, but the semantics stay); a planner can neither add a node
 * type nor an operator. The same node and edge shapes describe a Blueprint's
 * reference graph and a case's concrete plan.
 */
export const PLAN_NODE_TYPES = [
  'INTERPRET',
  'RESOLVE_CONTEXT',
  'EVALUATE_REQUIREMENTS',
  'DECISION',
  'PREPARE',
  'ACTION',
  'APPROVAL',
  'WAIT_EVENT',
  'REASSESS',
  'MANUAL_TASK',
  'COMPLETE',
] as const;
export type PlanNodeType = (typeof PLAN_NODE_TYPES)[number];

export const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export const PlanNodeSchema = z
  .object({
    /** Stable id inside the graph; mapped to a stable runtime identity server-side. */
    id: z.string().regex(NODE_ID),
    type: z.enum(PLAN_NODE_TYPES),
    /** Business title shown in the graph (Amendment 02 §16.6) — never an internal prompt. */
    title: z.string().min(1).max(160),
    purpose: z.string().max(600).optional(),
    capability: z.object({ key: z.string().min(1).max(120), version: z.string().max(40).optional() }).strict().optional(),
    agent: z.object({ key: z.string().min(1).max(120), version: z.string().max(40).optional() }).strict().optional(),
    /** Typed bindings (`fact`, `stepOutput`, `config`, `sourceRef`, literal) — no free expressions. */
    inputs: z.record(z.string().min(1).max(60), OperandSchema).default({}),
    outputSchemaRef: z.string().max(120).optional(),
    preconditions: z.array(ExprSchema).max(10).default([]),
    /** An explicitly optional node may be skipped on failure only if its `onFailure` says so (§12.5). */
    optional: z.boolean().default(false),
    onFailure: z.enum(['FAIL', 'REVIEW', 'SKIP']).default('REVIEW'),
    retry: z.object({ maxAttempts: z.number().int().min(1).max(5) }).strict().optional(),
    timeout: z.object({ hours: z.number().positive().max(24 * 60), policyRef: z.string().max(120).optional() }).strict().optional(),
    /** Static, node-type specific settings, e.g. `purpose: 'CLARIFICATION'` on an ACTION, `eventType` on a WAIT_EVENT. */
    config: z.record(z.string().max(60), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).default({}),
    evidenceRefs: z.array(z.string().max(200)).max(20).default([]),
  })
  .strict();
export type PlanNode = z.infer<typeof PlanNodeSchema>;

export const PlanEdgeSchema = z
  .object({
    id: z.string().regex(NODE_ID),
    source: z.string().regex(NODE_ID),
    target: z.string().regex(NODE_ID),
    label: z.string().max(120).optional(),
    /** Absent = unconditional. */
    condition: ExprSchema.optional(),
  })
  .strict();
export type PlanEdge = z.infer<typeof PlanEdgeSchema>;

export const PLAN_STATUSES = ['PROPOSED', 'VALIDATED', 'AWAITING_APPROVAL', 'ACTIVE', 'SUPERSEDED', 'REJECTED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PlanAssumptionSchema = z
  .object({ text: z.string().min(1).max(400), evidenceRefs: z.array(z.string().max(200)).max(10).default([]), requiresReview: z.boolean() })
  .strict();

/**
 * What a planner (LLM or deterministic instantiation) may RETURN. Identity,
 * tenant, case, revision and versions are deliberately not part of it: they
 * are assigned server-side from the authenticated context (§11.2) — a
 * model-supplied value can never override them.
 */
export const PlanProposalSchema = z
  .object({
    goalKeys: z.array(z.string().min(1).max(120)).min(1).max(10),
    nodes: z.array(PlanNodeSchema).min(1).max(60),
    edges: z.array(PlanEdgeSchema).max(120),
    unresolvedRequirements: z.array(z.string().max(120)).max(30).default([]),
    assumptions: z.array(PlanAssumptionSchema).max(20).default([]),
    conciseExplanation: z.string().min(1).max(800),
  })
  .strict();
export type PlanProposal = z.infer<typeof PlanProposalSchema>;

export interface ProcessPlan extends PlanProposal {
  id: string;
  tenantId: string;
  caseId: string;
  revision: number;
  parentPlanId?: string;
  blueprintRef?: { key: string; version: string };
  basedOnCaseRevision: number;
  status: PlanStatus;
}

/** Hard size limits any plan is validated against (§11.3 item 1/11). */
export const PLAN_LIMITS = { maxNodes: 60, maxEdges: 120 } as const;
