import { z } from 'zod';

/**
 * Amendment 02 §14.5 / §17.2 / §21.2 — human interventions are validated
 * commands, never direct mutations. The server derives tenant and user from
 * the authenticated context (never from the payload), checks
 * `expectedCaseRevision` against the current case, re-authorizes and treats a
 * repeated `commandId` as the same command (idempotent).
 */
export const CASE_COMMAND_TYPES = [
  'ADD_FACTS',
  'CORRECT_FACT',
  'RESOLVE_FACT_CONFLICT',
  'EDIT_DRAFT',
  'APPROVE_PLAN',
  'REJECT_PLAN',
  'APPROVE_ACTION',
  'REJECT_ACTION',
  'RECONCILE_ACTION',
  'PAUSE',
  'RESUME',
  'REPLAN',
  'RETRY_STEP',
  'CANCEL',
  'COMPLETE_MANUAL_TASK',
] as const;
export type CaseCommandType = (typeof CASE_COMMAND_TYPES)[number];

const factValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.record(z.unknown()), z.array(z.unknown()).max(50)]);

const factInput = z
  .object({
    key: z.string().min(1).max(120),
    value: factValue,
    valueType: z.string().max(40).optional(),
    unit: z.string().max(40).optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

export const COMMAND_PAYLOAD_SCHEMAS = {
  ADD_FACTS: z.object({ facts: z.array(factInput).min(1).max(20) }).strict(),
  CORRECT_FACT: factInput,
  RESOLVE_FACT_CONFLICT: factInput,
  EDIT_DRAFT: z
    .object({ draftId: z.string().min(1), subject: z.string().min(1).max(300).optional(), bodyText: z.string().min(1).max(20_000).optional() })
    .strict()
    .refine((v) => v.subject !== undefined || v.bodyText !== undefined, 'Betreff oder Text muss geändert werden.'),
  APPROVE_PLAN: z.object({ planId: z.string().min(1) }).strict(),
  REJECT_PLAN: z.object({ planId: z.string().min(1), reason: z.string().max(500).optional() }).strict(),
  APPROVE_ACTION: z.object({ intentId: z.string().min(1) }).strict(),
  REJECT_ACTION: z.object({ intentId: z.string().min(1), reason: z.string().max(500).optional() }).strict(),
  RECONCILE_ACTION: z.object({ intentId: z.string().min(1), happened: z.boolean(), note: z.string().max(500).optional() }).strict(),
  PAUSE: z.object({}).strict(),
  RESUME: z.object({}).strict(),
  REPLAN: z.object({}).strict(),
  RETRY_STEP: z.object({ stepRunId: z.string().min(1) }).strict(),
  CANCEL: z.object({}).strict(),
  COMPLETE_MANUAL_TASK: z.object({ nodeId: z.string().min(1), result: z.record(z.unknown()).default({}) }).strict(),
} as const satisfies Record<CaseCommandType, z.ZodTypeAny>;

export const CaseCommandEnvelopeSchema = z
  .object({
    commandId: z.string().uuid(),
    type: z.enum(CASE_COMMAND_TYPES),
    expectedCaseRevision: z.number().int().positive(),
    targetRef: z.string().max(200).optional(),
    payload: z.record(z.unknown()).default({}),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type CaseCommandEnvelope = z.infer<typeof CaseCommandEnvelopeSchema>;

export type ParsedCaseCommand =
  | { ok: true; envelope: CaseCommandEnvelope; payload: unknown }
  | { ok: false; errors: string[] };

/** Validates the envelope and then the payload against the schema of the command type. */
export function parseCaseCommand(input: unknown): ParsedCaseCommand {
  const envelope = CaseCommandEnvelopeSchema.safeParse(input);
  if (!envelope.success) return { ok: false, errors: envelope.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  const schema = COMMAND_PAYLOAD_SCHEMAS[envelope.data.type];
  const payload = schema.safeParse(envelope.data.payload);
  if (!payload.success) return { ok: false, errors: payload.error.issues.map((i) => `payload.${i.path.join('.') || '(root)'}: ${i.message}`) };
  return { ok: true, envelope: envelope.data, payload: payload.data };
}
