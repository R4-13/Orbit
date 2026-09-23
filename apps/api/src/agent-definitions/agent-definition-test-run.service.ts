import { Injectable } from '@nestjs/common';
import type { ToolCallOutcome } from '@orbit/agent-core';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AgentDefinitionResolverService } from './agent-definition-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';

export interface TestRunResult {
  agentRunId: string;
  toolCallOutcomes: ToolCallOutcome[];
}

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 2 ("Testlauf/Dry-Run") —
 * generalizes the pattern the /inbox page already established (Phase
 * 19i: simulate a real POST /intake/emails call from the UI) to *any*
 * AgentDefinition, including ones still in DRAFT that no production
 * entry point references yet.
 *
 * Deliberately NOT a special "safe" execution mode: the concept doc's
 * security model explicitly rules that out (a common failure mode in
 * comparable "agent builder" products is running test calls with
 * reduced checks "because it's just a test"). This runs the exact same
 * AgentRuntime.runTurn() -> Policy Engine path as a real call, produces
 * a completely ordinary AgentRun/ToolInvocation record (triggerType:
 * MANUAL is the only difference), and routes any blocked tool call to
 * the same generic Approval Center a production run would.
 */
@Injectable()
export class AgentDefinitionTestRunService {
  constructor(
    private readonly resolver: AgentDefinitionResolverService,
    private readonly runs: AgentRunRecorderService,
    private readonly approvals: ApprovalsService,
  ) {}

  async run(tenantId: string, actorUserId: string, key: string, userMessage: string): Promise<TestRunResult> {
    const { systemPrompt, baseType, runtime } = await this.resolver.resolveForTestRun(tenantId, key);

    const run = await this.runs.start({
      tenantId,
      agentType: baseType,
      triggerType: 'MANUAL',
      input: { userMessage, testRun: true },
    });

    let outcomes: ToolCallOutcome[] = [];
    try {
      const result = await runtime.runTurn(
        { tenantId, agentRunId: run.id, actorUserId },
        { systemPrompt, messages: [{ role: 'user', content: userMessage }] },
      );
      outcomes = result.toolCallOutcomes;
      await this.runs.recordToolCalls(tenantId, run.id, outcomes);
      await this.runs.complete(tenantId, run.id, result);
    } catch (error) {
      await this.runs.fail(tenantId, run.id, error instanceof Error ? error.message : String(error));
      throw error;
    }

    for (const outcome of outcomes) {
      if (outcome.decision === 'ALLOW' || outcome.decision === 'DENY') continue;
      await this.approvals.create(tenantId, {
        entityType: 'FOLLOW_UP',
        entityId: outcome.toolCallId,
        policyAction: outcome.toolName,
        requestedByUserId: actorUserId,
        reason: `Testlauf-Vorschlag „${outcome.toolName}" wartet auf Freigabe.`,
      });
    }

    return { agentRunId: run.id, toolCallOutcomes: outcomes };
  }
}
