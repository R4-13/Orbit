import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { POLICY_ACTIONS } from '@orbit/shared';
import type { ToolDefinition, ToolExecutionContext, ToolRegistry } from '@orbit/agent-core';
import { ApprovalsService } from '../../approvals/approvals.service';
import { CasesService } from '../../cases/cases.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TasksService } from '../../tasks/tasks.service';

/** Tool names this module registers — the exact allow-list `CopilotRuntimeService` scopes ASK mode to via `ToolRegistry.subset()`. */
export const SONDE_ASK_TOOL_NAMES = [
  'get_dashboard_summary',
  'list_open_approvals',
  'get_case',
  'list_overdue_tasks',
  'list_failed_agent_runs',
] as const;

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
 * category) — die READ-Tools aus dem Master-Dokument. Registriert in der
 * **selben**, app-weiten `ToolRegistry`-Instanz wie die Finance-/Sales-/
 * Communication-Tools (§25: "must reuse... Tool Registry" — keine
 * separate Registry für Sonde), damit Sonde exakt denselben Tool-Registry
 * → Policy-Engine → Tool-Gateway-Pfad durchläuft wie jeder andere Agent
 * auch.
 *
 * `list_overdue_tasks`/`list_failed_agent_runs` ergänzen die ursprünglich
 * ersten drei Tools (`get_dashboard_summary`/`list_open_approvals`/
 * `get_case`) um die restlichen, in SONDE_CONCEPT.md §28 ("Global
 * Questions" — Beispielfrage "Was braucht heute meine Aufmerksamkeit?")
 * namentlich genannten strukturierten Dienste ("Overdue Activities",
 * "Agent Errors") — "Failed Cases" wird dabei bewusst als "Agent-Läufe mit
 * Status FAILED" interpretiert, da `CaseStatus` selbst keinen `FAILED`-
 * Wert kennt. §28 verlangt ausdrücklich nur, dass Sonde diese Fragen
 * **auf Anfrage** beantworten kann (über genau diese Tools) — **keine**
 * automatisch generierten, unaufgeforderten Vorschläge (§27 "Do not
 * automatically interrupt users with unsolicited messages in MVP"); siehe
 * die neuen Vorschlags-Chips in `SondePanel` für die dazu passende,
 * anklickbare statt automatische UI.
 *
 * Alle fünf Tools sind reine Lesezugriffe (kein Seiteneffekt) und teilen
 * sich deshalb `POLICY_ACTIONS.COPILOT_READ` (AUTONOMOUS-Default) —
 * dieselbe Begründung wie `CALENDAR_READ`.
 *
 * `list_failed_agent_runs`/`get_dashboard_summary`'s Agent-Lauf-Abfrage
 * nutzt bewusst `PrismaService` **direkt** statt der eigentlich dafür
 * zuständigen `AgentRunRecorderService` — ein echter, beim ersten e2e-Lauf
 * gefundener Bootstrap-Hänger, kein Stilbruch: `AgentRunRecorderService`
 * injiziert selbst `TOOL_REGISTRY` (braucht die Registry, um Tool-Aufrufe
 * während eines echten Agent-Laufs zu protokollieren), und `TOOL_REGISTRY`s
 * eigene Factory injiziert `SondeTools`, um es zu befüllen — `SondeTools`
 * hätte `AgentRunRecorderService` zu injizieren also einen echten Zyklus
 * geschlossen (`TOOL_REGISTRY` → `SondeTools` → `AgentRunRecorderService`
 * → `TOOL_REGISTRY`), den Nest beim Bootstrap nicht sauber auflöst,
 * sondern den kompletten Modul-Graph beim Start hängen lässt (bestätigt:
 * `bootstrapE2eApp()` überschritt das 20s-Hook-Timeout in praktisch jeder
 * E2E-Suite, die `AgentModule` lädt). `PrismaService` hat keine solche
 * Abhängigkeit — derselbe tenant-gescopte Zugriffsstil wie
 * `AgentRunRecorderService.findAll()` selbst, nur ohne den zyklischen Pfad.
 */
@Injectable()
export class SondeTools {
  constructor(
    private readonly cases: CasesService,
    private readonly tasks: TasksService,
    private readonly approvals: ApprovalsService,
    private readonly prisma: PrismaService,
  ) {}

  register(registry: ToolRegistry): void {
    registry.register(this.dashboardSummaryTool());
    registry.register(this.listOpenApprovalsTool());
    registry.register(this.getCaseTool());
    registry.register(this.listOverdueTasksTool());
    registry.register(this.listFailedAgentRunsTool());
  }

  private dashboardSummaryTool(): ToolDefinition {
    return {
      name: 'get_dashboard_summary',
      description:
        'Liefert eine kompakte Übersicht des aktuellen Stands: Anzahl offener Vorgänge, offener Aufgaben, überfälliger Aufgaben, ausstehender Freigaben und fehlgeschlagener Agent-Läufe.',
      inputSchema: z.object({}),
      policyAction: POLICY_ACTIONS.COPILOT_READ,
      execute: async (_input, context: ToolExecutionContext) => {
        const [cases, openTasks, approvals, failedRunsCount] = await Promise.all([
          this.cases.findAll(context.tenantId, {}),
          this.tasks.findAll(context.tenantId, { status: 'OPEN' }),
          this.approvals.findAll(context.tenantId, { status: 'PENDING' }),
          this.prisma.forTenantId(context.tenantId).agentRun.count({ where: { status: 'FAILED' } }),
        ]);
        const now = Date.now();
        const overdueTasksCount = openTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length;
        return {
          openCasesCount: cases.length,
          openTasksCount: openTasks.length,
          overdueTasksCount,
          pendingApprovalsCount: approvals.length,
          failedRunsCount,
        };
      },
    };
  }

  private listOverdueTasksTool(): ToolDefinition {
    return {
      name: 'list_overdue_tasks',
      description: 'Listet offene Aufgaben (höchstens 10), deren Fälligkeitsdatum bereits verstrichen ist — Titel, Fälligkeitsdatum, zugehöriger Fall.',
      inputSchema: z.object({}),
      policyAction: POLICY_ACTIONS.COPILOT_READ,
      execute: async (_input, context: ToolExecutionContext) => {
        const openTasks = await this.tasks.findAll(context.tenantId, { status: 'OPEN' });
        const now = Date.now();
        return openTasks
          .filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now)
          .sort((a, b) => new Date(a.dueDate as Date).getTime() - new Date(b.dueDate as Date).getTime())
          .slice(0, 10)
          .map((task) => ({ title: task.title, dueDate: task.dueDate, caseId: task.caseId }));
      },
    };
  }

  private listFailedAgentRunsTool(): ToolDefinition {
    return {
      name: 'list_failed_agent_runs',
      description: 'Listet die zuletzt fehlgeschlagenen Agent-Läufe (höchstens 10) — Agent-Typ, Fehlermeldung, Zeitpunkt, zugehöriger Fall.',
      inputSchema: z.object({}),
      policyAction: POLICY_ACTIONS.COPILOT_READ,
      execute: async (_input, context: ToolExecutionContext) => {
        const runs = await this.prisma.forTenantId(context.tenantId).agentRun.findMany({
          where: { status: 'FAILED' },
          orderBy: { startedAt: 'desc' },
          take: 10,
        });
        return runs.map((run) => ({ agentType: run.agentType, errorMessage: run.errorMessage, startedAt: run.startedAt, caseId: run.caseId }));
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
