import { wrapUntrustedContent } from '@orbit/agent-core';

/**
 * Minimal JSON-Path-artige Auflösung für WorkflowStepDefinition.inputMapping/
 * .condition (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3) — bewusst **kein**
 * vollständiger JSON-Path-Interpreter (keine Wildcards, Filter, Slices),
 * um keine neue Abhängigkeit für eine Mini-Ausdruckssprache einzuführen.
 * Unterstützt genau zwei Formen:
 *   - "$.trigger.input.<feld>"
 *   - "$.steps[<order>].output.<toolName>.<feld>"
 */
export interface WorkflowStepOutput {
  /** Tool-Name -> dessen Rückgabewert, für jeden Tool-Aufruf dieses Schritts. */
  output: Record<string, unknown>;
}

export interface WorkflowPathContext {
  trigger: { input: Record<string, unknown> };
  /** Schlüssel = WorkflowStepDefinition.order (1-basiert). */
  steps: Record<number, WorkflowStepOutput>;
}

const TOKEN_PATTERN = /^(\w+)(\[(\d+)\])?$/;

/** Returns `undefined` for any malformed or non-existent path — callers treat that as "no value", never throw. */
export function resolveWorkflowPath(context: WorkflowPathContext, path: string): unknown {
  const parts = path.trim().replace(/^\$\.?/, '').split('.').filter(Boolean);

  let current: unknown = context;
  for (const part of parts) {
    const match = TOKEN_PATTERN.exec(part);
    if (!match) return undefined;
    const [, key, , indexStr] = match;

    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key as string];

    if (indexStr !== undefined) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[indexStr];
    }
  }
  return current;
}

export interface WorkflowStepConditionExpr {
  field: string;
  equals: string;
}

export function evaluateWorkflowCondition(context: WorkflowPathContext, condition: WorkflowStepConditionExpr): boolean {
  return resolveWorkflowPath(context, condition.field) === condition.equals;
}

/**
 * Resolves every entry of a step's `inputMapping` into a flat object and
 * serializes it as the step's user-message content — the same "structured
 * value flows into the next agent's message" pattern IntakeService already
 * does manually today (see AGENT_ARCHITECTURE.md, "Der Orchestrator"), just
 * data-driven instead of hard-coded. With no mapping at all (typically the
 * workflow's first step), the full trigger input is passed through as-is.
 *
 * The whole serialized object is wrapped via `wrapUntrustedContent()`
 * before being returned (docs/ASSUMPTIONS.md, formerly #246's open follow-up).
 * Trigger input can come from a trusted, authenticated API caller today, but
 * a step's inputMapping can equally pull a prior step's raw tool output
 * (`$.steps[N].output...`) into the message — and that output may itself
 * originate from untrusted external content (an email body, a document) a
 * tool fetched. Scoping the wrap field-by-field would require re-auditing
 * every current and future tool for whether its output can carry untrusted
 * text; wrapping the whole message unconditionally sidesteps that and costs
 * nothing structurally, since this content was already meant to be read as
 * data by the next agent, never as instructions.
 */
export function buildWorkflowStepMessage(context: WorkflowPathContext, inputMapping: Record<string, string> | null | undefined): string {
  if (!inputMapping || Object.keys(inputMapping).length === 0) {
    return wrapUntrustedContent(JSON.stringify(context.trigger.input));
  }
  const resolved: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(inputMapping)) {
    resolved[field] = resolveWorkflowPath(context, path);
  }
  return wrapUntrustedContent(JSON.stringify(resolved));
}
