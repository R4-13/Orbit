import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { POLICY_ACTIONS } from '@orbit/shared';
import type { ToolDefinition, ToolExecutionContext, ToolRegistry } from '@orbit/agent-core';
import { ApprovalsService } from '../../approvals/approvals.service';
import { CasesService } from '../../cases/cases.service';
import { TasksService } from '../../tasks/tasks.service';

/** Tool names this module registers — the exact allow-list `CopilotRuntimeService` scopes ASK mode to via `ToolRegistry.subset()`. */
export const SONDE_ASK_TOOL_NAMES = ['get_dashboard_summary', 'list_open_approvals', 'get_case'] as const;

/**
 * §26/§32 des Master-Dokuments ("Sonde modes" / "READ" capability
 * category) — die ersten drei, namentlich im Master-Dokument genannten
 * READ-Tools (`get_dashboard_summary`, `list_open_approvals`, `get_case`).
 * Registriert in der **selben**, app-weiten `ToolRegistry`-Instanz wie die
 * Finance-/Sales-/Communication-Tools (§25: "must reuse... Tool Registry"
 * — keine separate Registry für Sonde), damit Sonde exakt denselben
 * Tool-Registry → Policy-Engine → Tool-Gateway-Pfad durchläuft wie jeder
 * andere Agent auch.
 *
 * Alle drei sind reine Lesezugriffe (kein Seiteneffekt) und teilen sich
 * deshalb `POLICY_ACTIONS.COPILOT_READ` (AUTONOMOUS-Default) — dieselbe
 * Begründung wie `CALENDAR_READ`.
 */
@Injectable()
export class SondeTools {
  constructor(
    private readonly cases: CasesService,
    private readonly tasks: TasksService,
    private readonly approvals: ApprovalsService,
  ) {}

  register(registry: ToolRegistry): void {
    registry.register(this.dashboardSummaryTool());
    registry.register(this.listOpenApprovalsTool());
    registry.register(this.getCaseTool());
  }

  private dashboardSummaryTool(): ToolDefinition {
    return {
      name: 'get_dashboard_summary',
      description:
        'Liefert eine kompakte Übersicht des aktuellen Stands: Anzahl offener Vorgänge, offener Aufgaben und ausstehender Freigaben.',
      inputSchema: z.object({}),
      policyAction: POLICY_ACTIONS.COPILOT_READ,
      execute: async (_input, context: ToolExecutionContext) => {
        const [cases, tasks, approvals] = await Promise.all([
          this.cases.findAll(context.tenantId, {}),
          this.tasks.findAll(context.tenantId, { status: 'OPEN' }),
          this.approvals.findAll(context.tenantId, { status: 'PENDING' }),
        ]);
        return {
          openCasesCount: cases.length,
          openTasksCount: tasks.length,
          pendingApprovalsCount: approvals.length,
        };
      },
    };
  }

  private listOpenApprovalsTool(): ToolDefinition {
    return {
      name: 'list_open_approvals',
      description: 'Listet die ausstehenden Freigaben (höchstens 10) mit Aktion, Grund und Zeitpunkt.',
      inputSchema: z.object({}),
      policyAction: POLICY_ACTIONS.COPILOT_READ,
      execute: async (_input, context: ToolExecutionContext) => {
        const approvals = await this.approvals.findAll(context.tenantId, { status: 'PENDING' });
        return approvals.slice(0, 10).map((approval) => ({
          policyAction: approval.policyAction,
          entityType: approval.entityType,
          reason: approval.reason,
          requestedAt: approval.requestedAt,
        }));
      },
    };
  }

  private getCaseTool(): ToolDefinition {
    const inputSchema = z.object({ caseId: z.string().min(1) });
    return {
      name: 'get_case',
      description: 'Liest einen einzelnen Vorgang (Case) anhand seiner ID — Titel, Typ, Status.',
      inputSchema,
      policyAction: POLICY_ACTIONS.COPILOT_READ,
      execute: async (input, context: ToolExecutionContext) => {
        const found = await this.cases.findOne(context.tenantId, input.caseId);
        return { id: found.id, title: found.title, type: found.type, status: found.status };
      },
    };
  }
}
