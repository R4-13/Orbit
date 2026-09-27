import { Injectable } from '@nestjs/common';
import type { ToolCallOutcome } from '@orbit/agent-core';
import type { AgentEvaluationCase } from '@orbit/domain';
import { NotFoundError, ValidationFailedError } from '@orbit/shared';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDefinitionResolverService, type AgentCandidate } from './agent-definition-resolver.service';
import type { CreateEvaluationCaseDto } from './dto/create-evaluation-case.dto';

export interface EvaluationCaseResult {
  evaluationCaseId: string;
  name: string;
  critical: boolean;
  agentRunId: string;
  passed: boolean;
  failures: string[];
  toolCallOutcomes: ToolCallOutcome[];
}

/**
 * §17 des Unified-Evolution-Konzepts ("Agent Evaluation Framework"):
 * persisted, re-runnable regression cases per AgentDefinition, plus the
 * publish gate ("Critical evaluations should run before publishing a new
 * agent version") wired into AgentDefinitionsService.update().
 *
 * Deliberately NOT a reduced-checks "safe" execution path — same
 * principle as AgentDefinitionTestRunService: every evaluation run is a
 * completely ordinary AgentRun/ToolInvocation through the real
 * AgentRuntime -> Policy Engine path, including routing a blocked tool
 * call to the normal Approval Center. Running a suite that contains
 * approval-gated expectations therefore does create real, visible
 * Approval rows — an accepted, documented consequence (docs/ASSUMPTIONS.md)
 * rather than a special-cased evaluation mode that would diverge from
 * production behavior.
 */
@Injectable()
export class AgentEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: AgentDefinitionResolverService,
    private readonly runs: AgentRunRecorderService,
    private readonly approvals: ApprovalsService,
  ) {}

  listCases(tenantId: string, agentDefinitionKey: string): Promise<AgentEvaluationCase[]> {
    return this.prisma
      .forTenantId(tenantId)
      .agentEvaluationCase.findMany({ where: { agentDefinitionKey }, orderBy: { createdAt: 'asc' } });
  }

  async createCase(
    tenantId: string,
    actorUserId: string,
    agentDefinitionKey: string,
    input: CreateEvaluationCaseDto,
  ): Promise<AgentEvaluationCase> {
    const created = await this.prisma.forTenantId(tenantId).agentEvaluationCase.create({
      data: {
        tenantId,
        agentDefinitionKey,
        name: input.name,
        userMessage: input.userMessage,
        expectedTools: input.expectedTools ?? [],
        forbiddenTools: input.forbiddenTools ?? [],
        expectedApprovalRequired: input.expectedApprovalRequired ?? null,
        critical: input.critical ?? false,
        createdByUserId: actorUserId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'AGENT_EVALUATION_CASE_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'AgentEvaluationCase',
      entityId: created.id,
      payload: { agentDefinitionKey, name: created.name, critical: created.critical },
    });

    return created;
  }

  async deleteCase(tenantId: string, actorUserId: string, agentDefinitionKey: string, caseId: string): Promise<void> {
    const existing = await this.prisma
      .forTenantId(tenantId)
      .agentEvaluationCase.findFirst({ where: { id: caseId, agentDefinitionKey } });
    if (!existing) {
      throw new NotFoundError('Evaluation case not found.', { agentDefinitionKey, caseId });
    }

    await this.prisma.forTenantId(tenantId).agentEvaluationCase.delete({ where: { id: caseId } });

    await this.audit.record({
      tenantId,
      eventType: 'AGENT_EVALUATION_CASE_DELETED',
      actorType: 'USER',
      actorUserId,
      entityType: 'AgentEvaluationCase',
      entityId: caseId,
      payload: { agentDefinitionKey, name: existing.name },
    });
  }

  /** Runs every saved case for this key against `candidate` — sequential, not parallel, since cases may share a single-instance MockLLMProvider seed queue. */
  async runSuite(
    tenantId: string,
    actorUserId: string,
    agentDefinitionKey: string,
    candidate: AgentCandidate,
  ): Promise<EvaluationCaseResult[]> {
    const cases = await this.listCases(tenantId, agentDefinitionKey);
    const results: EvaluationCaseResult[] = [];
    for (const evaluationCase of cases) {
      results.push(await this.runCase(tenantId, actorUserId, evaluationCase, candidate));
    }
    return results;
  }

  /**
   * Throws ValidationFailedError if any `critical: true` case for this key
   * fails against `candidate`. A no-op when there are no critical cases —
   * an agent with nothing critical defined has nothing to gate on, same
   * "absence means unrestricted" precedent as Retention-Grundlage's "no
   * policy row = unlimited retention".
   */
  async assertCriticalCasesPass(
    tenantId: string,
    actorUserId: string,
    agentDefinitionKey: string,
    candidate: AgentCandidate,
  ): Promise<void> {
    const cases = await this.listCases(tenantId, agentDefinitionKey);
    const critical = cases.filter((c) => c.critical);
    if (critical.length === 0) return;

    const results: EvaluationCaseResult[] = [];
    for (const evaluationCase of critical) {
      results.push(await this.runCase(tenantId, actorUserId, evaluationCase, candidate));
    }

    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) {
      throw new ValidationFailedError(
        'Veröffentlichung blockiert: mindestens ein kritischer Evaluationsfall schlägt fehl.',
        { failed: failed.map((f) => ({ name: f.name, failures: f.failures, agentRunId: f.agentRunId })) },
      );
    }
  }

  private async runCase(
    tenantId: string,
    actorUserId: string,
    evaluationCase: AgentEvaluationCase,
    candidate: AgentCandidate,
  ): Promise<EvaluationCaseResult> {
    const resolved = await this.resolver.resolveCandidate(tenantId, candidate);
    const run = await this.runs.start({
      tenantId,
      agentType: candidate.baseType,
      triggerType: 'MANUAL',
      input: { evaluationCaseId: evaluationCase.id, userMessage: evaluationCase.userMessage, evaluation: true },
    });

    let outcomes: ToolCallOutcome[] = [];
    try {
      const result = await resolved.runtime.runTurn(
        { tenantId, agentRunId: run.id, actorUserId },
        { systemPrompt: resolved.systemPrompt, messages: [{ role: 'user', content: evaluationCase.userMessage }] },
      );
      outcomes = result.toolCallOutcomes;
      await this.runs.recordToolCalls(tenantId, run.id, outcomes);
      await this.runs.complete(tenantId, run.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runs.fail(tenantId, run.id, message);
      return {
        evaluationCaseId: evaluationCase.id,
        name: evaluationCase.name,
        critical: evaluationCase.critical,
        agentRunId: run.id,
        passed: false,
        failures: [`Agent-Lauf fehlgeschlagen: ${message}`],
        toolCallOutcomes: [],
      };
    }

    for (const outcome of outcomes) {
      if (outcome.decision === 'ALLOW' || outcome.decision === 'DENY') continue;
      await this.approvals.create(tenantId, {
        entityType: 'FOLLOW_UP',
        entityId: outcome.toolCallId,
        policyAction: outcome.toolName,
        requestedByUserId: actorUserId,
        reason: `Evaluationsfall „${evaluationCase.name}" — Vorschlag „${outcome.toolName}" wartet auf Freigabe.`,
      });
    }

    const failures = this.evaluateExpectations(evaluationCase, outcomes);
    return {
      evaluationCaseId: evaluationCase.id,
      name: evaluationCase.name,
      critical: evaluationCase.critical,
      agentRunId: run.id,
      passed: failures.length === 0,
      failures,
      toolCallOutcomes: outcomes,
    };
  }

  private evaluateExpectations(evaluationCase: AgentEvaluationCase, outcomes: ToolCallOutcome[]): string[] {
    const failures: string[] = [];
    const called = new Set(outcomes.map((o) => o.toolName));

    for (const tool of evaluationCase.expectedTools) {
      if (!called.has(tool)) failures.push(`Erwartetes Tool "${tool}" wurde nicht aufgerufen.`);
    }
    for (const tool of evaluationCase.forbiddenTools) {
      if (called.has(tool)) failures.push(`Verbotenes Tool "${tool}" wurde aufgerufen.`);
    }

    if (evaluationCase.expectedApprovalRequired !== null) {
      const anyBlocked = outcomes.some((o) => o.decision !== 'ALLOW');
      if (evaluationCase.expectedApprovalRequired && !anyBlocked) {
        failures.push(
          'Es wurde eine Freigabe-Anforderung erwartet, aber alle Tool-Aufrufe liefen autonom (ALLOW), oder es wurde kein Tool aufgerufen.',
        );
      }
      if (!evaluationCase.expectedApprovalRequired && anyBlocked) {
        failures.push('Es wurde erwartet, dass keine Freigabe nötig ist, aber mindestens ein Tool-Aufruf wurde blockiert.');
      }
    }

    return failures;
  }
}
