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
 * §26/§32 ("PREPARE" capability category) — "creates a proposal", never
 * executes anything final. Deliberately **not** new tools: `draft_email`
 * (`SalesAgentTools`, §17 "Follow-up versenden" precursor — persists an
 * `EmailMessage` with `direction: OUTBOUND` but never sends it),
 * `create_meeting` (`SalesAgentTools` — despite its name, proposes
 * candidate slots via `MeetingsService.proposeSlots()`; its own
 * description already states "die endgültige Bestätigung erfolgt
 * weiterhin durch einen Menschen"), and `create_booking_proposal`
 * (`FinanceAgentTools` — creates a `BookingProposal` row that still
 * needs a human to approve/transfer the invoice) already exist,
 * already have their own test coverage, and already run through the
 * exact same Tool Registry → Policy Engine path any domain agent uses.
 * Reusing them by name here is the direct application of §25 ("must
 * reuse... Tool Registry, do not duplicate") to PREPARE mode — the same
 * principle ASK mode's own tools already followed.
 *
 * `prepare_follow_up` (the fourth capability §32 lists) has no existing
 * equivalent — `FOLLOW_UP_SEND` is about *sending* an already-drafted
 * follow-up (REQUIRE_APPROVAL by default), not proposing one — and is
 * deliberately left out of this first PREPARE-mode cut; see
 * docs/ASSUMPTIONS.md.
 */
export const SONDE_PREPARE_TOOL_NAMES = ['draft_email', 'create_meeting', 'create_booking_proposal'] as const;

/**
 * §26/§32 ("ACT" capability category) — "executes a controlled permitted
 * action". Wieder bewusst **keine neuen Tools**: `create_task`/
 * `create_contact`/`create_lead` (`SalesAgentTools`) und `send_email`
 * (`SalesAgentTools`, sendet die mit `draft_email` zuvor entworfene
 * E-Mail über den echten Mail-Connector) existieren bereits, mit eigener
 * Testabdeckung, über denselben Tool-Registry → Policy-Engine-Pfad.
 *
 * `create_task`/`create_contact`/`create_lead` sind standardmäßig
 * `AUTONOMOUS` — ruft Sonde sie auf, legt genau derselbe Mechanismus,
 * den Finance-/Sales-Agenten schon nutzen, sofort einen echten
 * Datensatz an (kein Sonderpfad, keine reduzierten Prüfungen).
 * `send_email` ist standardmäßig `REQUIRE_APPROVAL`
 * (`POLICY_ACTIONS.FOLLOW_UP_SEND`) — ruft Sonde es auf, versendet es
 * NICHT direkt, sondern erzeugt automatisch eine `FOLLOW_UP`-
 * Freigabeanfrage (`CopilotRuntimeService.runAskTurn()`s bereits
 * bestehende, generische Behandlung jeder Nicht-ALLOW/Nicht-DENY-
 * Entscheidung) — der konkrete, lebende Beweis für §27: "The action must
 * still pass RBAC → Policy Engine → Approval Rules → Workflow Engine.
 * Sonde cannot bypass those layers."
 *
 * `create_meeting` ist hier bewusst nicht noch einmal aufgeführt — es ist
 * bereits Teil von `SONDE_PREPARE_TOOL_NAMES` (siehe dortigen
 * Kommentar); ein Tool in zwei Modus-Subsets gleichzeitig zu führen wäre
 * reine, bedeutungslose Duplikation.
 */
export const SONDE_ACT_TOOL_NAMES = ['create_task', 'create_contact', 'create_lead', 'send_email'] as const;

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
