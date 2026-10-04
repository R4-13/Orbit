import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { POLICY_ACTIONS, PlanProposalSchema, type PlanProposal } from '@orbit/shared';
import type { ToolDefinition, ToolRegistry } from '@orbit/agent-core';

/**
 * Amendment 02 §11.2 — structured output of the AI process planner. Like
 * `submit_triage_result`, the model answers by calling a tool whose input IS
 * the schema (`PlanProposalSchema`: nodes, edges, assumptions — no tenant,
 * case, revision or version fields, which the server assigns). The tool does
 * nothing; the deterministic plan validator decides whether the proposal may
 * ever run.
 */
@Injectable()
export class ProcessAgentTools {
  register(registry: ToolRegistry): void {
    registry.register(this.submitProcessPlanTool());
  }

  private submitProcessPlanTool(): ToolDefinition {
    return {
      name: 'submit_process_plan',
      description:
        'Übermittelt den Prozessplan (Knoten, Kanten, offene Anforderungen, Annahmen) für diesen Vorgang. Führt nichts aus; der Plan wird anschließend deterministisch geprüft.',
      inputSchema: PlanProposalSchema as unknown as z.ZodType<PlanProposal>,
      policyAction: POLICY_ACTIONS.PROCESS_PLAN,
      execute: async (input: PlanProposal) => input,
    };
  }
}
