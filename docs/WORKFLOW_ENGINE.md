# Workflow-Engine und Prozess-Orchestrator

ORBIT hat zwei zusammenarbeitende Laufzeitebenen, die dieselben Grundbausteine nutzen:

| | Durable Workflow Engine (bestehend) | Prozess-Orchestrator (Amendment 02) |
|---|---|---|
| Zweck | feste Domänen-Workflows (`finance-invoice-intake`, `sales-lead-intake`), konfigurierbar im Agent Studio | generische Geschäftsvorgänge mit Plan, Warten, Freigaben, Nachweisen |
| Definition | `WorkflowDefinition`/`Step` (DB) | `ProcessBlueprint` (versioniert) + `ProcessPlan` (je Case) |
| Zustand | `WorkflowRun`, `WorkflowStepRun` (Status je Schritt) | `ProcessPlanNode`, `ActionIntent/Receipt`, `WaitSubscription`, `CaseEvent` |
| Start | `IntakeService` (Kategorie → Workflow) | `IntakeService`, wenn für die Kategorie ein **aktiver Blueprint** existiert; sonst bleibt der Workflow unverändert |

Gemeinsam: `ToolRegistry`, Tool-Ergebnisvertrag (`SUCCEEDED`/`FAILED`/`OUTCOME_UNKNOWN`), Policy, Approvals, Audit, BullMQ-Worker, PostgreSQL als Zustandsspeicher.
Die Fehler-/Statusgates (Phase G) gelten für beide: ein zurückgegebener Tool-Fehler wird nie als Erfolg gezählt.

Der Orchestrator führt Knoten aus, indem er die Fähigkeit auf ein registriertes Tool abbildet (`toolBindings`), Eingaben aus Fakten und
Schrittergebnissen bindet, die Policy je Zweck prüft und das Ergebnis über den Tool-Vertrag normalisiert. Er ist kein zweiter Agent-Runtime-Pfad:
modellgestützte Teilschritte (Triage, Extraktion, Planung) laufen über `AiProviderResolver` + `AgentRuntime` mit je einem Schema-Tool.

Migration bestehender Workflows auf Blueprints ist möglich, aber nicht erzwungen; bis dahin laufen beide nebeneinander.
