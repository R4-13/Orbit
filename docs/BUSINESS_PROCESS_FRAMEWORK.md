# Business Process Framework (Amendment 02)

Das Framework steuert Geschäftsvorgänge generisch: Ein Eingang wird semantisch eingestuft, ein **Case** entsteht, ein
**Plan** (aus einem versionierten **Blueprint** oder ad hoc) wird deterministisch geprüft und von einem **Orchestrator**
dauerhaft ausgeführt – mit Freigaben, Warten auf Antworten, Nachweisen und einer interaktiven Ansicht. Es erweitert die
bestehenden Bausteine (AgentRuntime, `AiProviderResolver`, ToolRegistry, Policy, Approvals, Integration Framework) und
ist keine zweite Plattform.

Alle fachlichen Inhalte sind **Daten**: Blueprint-JSON, Testdaten der Preisquelle, Texte. Die Engine kennt nur Knotentypen,
den Capability-Katalog und die Sicherheitsregeln. `REQUEST_FOR_QUOTE` ist der Referenzprozess, keine Sonderlogik.

## Ablauf

```
Eingang → Gates (eigene Mail, Auto-Reply) → Korrelation (Antwort auf bekannten Case?)
        → semantische Triage (KI, IntakeDecision) → Case + Fakten (Herkunft) → Blueprint/Plan
        → Plan-Validator (11 Prüfungen) → Orchestrator: Knoten ausführen
             ├ Policy + Ausführbarkeit direkt vor jedem Knoten
             ├ externe Wirkung: ActionIntent (idempotent) → Freigabe (gebunden an Nutzlast) → Versand → Receipt
             ├ WAIT_EVENT: WaitSubscription, Frist, Wiederaufnahme durch korrelierte Antwort
             └ COMPLETE: nur bei erfüllten Abschlusskriterien
        → Case-Events (lückenlose Sequenz) → Graph-Projektion / SSE → UI
```

## Bausteine (Repository)

| Baustein | Ort |
|---|---|
| Grammatik, Schemas, Validatoren (rein) | `packages/shared/src/process-schemas/` (`expressions`, `plan`, `blueprint`, `capability`, `plan-validator`, `blueprint-validator`, `plan-runtime`, `commands`, `graph`) |
| Persistenz | `ProcessBlueprint`, `TenantProcessActivation`, `ProcessPlan/Node/Edge`, `ActionIntent/Receipt`, `WaitSubscription`, `CaseEvent`, `CaseCommand`, `CaseFact`, `CaseCorrelation` (alle mit RLS) |
| Registry und Katalog | `BlueprintRegistryService`, `CapabilityRegistryService` (`apps/api/src/process/`) |
| Planer | `PlannerService` (deterministisch + `submit_process_plan`) |
| Laufzeit | `OrchestratorService`, `ActionLedgerService`, `PlanStoreService`, `CaseEventsService`, `ProcessSweepService` |
| Menschliche Eingriffe | `CaseCommandsService` (`POST /cases/:id/commands`) |
| Lesesicht | `CaseOrchestrationService` (`GET /cases/:id/orchestration`, `/nodes/:id`, `/events`, `/events/stream`) |
| Referenzprozess | `apps/api/src/process/reference/`, `fixtures/process/*.json` |

## Sicherheitsinvarianten (für jeden Prozess)

1. **Kein Plan wird aus LLM-Text ausgeführt.** Jeder Plan durchläuft `validatePlan`; Fehler → ein Reparaturversuch → `MANUAL_REVIEW`.
2. **Empfänger, Preise, Beträge, Identitäten sind nie feste Werte im Plan** (Prüfung 7); die Antwortadresse stammt aus der Kopfzeile der Eingangsnachricht, nicht aus dem Text.
3. **Jede externe Wirkung steht vorher im Ledger** (stabiler Idempotenzschlüssel), der Versandbeginn wird atomar beansprucht, ein Provider-Beleg ist Pflicht; ein ungewisser Ausgang (`OUTCOME_UNKNOWN`) wird **nie blind wiederholt**, sondern abgeglichen.
4. **Freigaben sind an die unveränderliche Nutzlast gebunden.** Wird ein Entwurf bearbeitet oder der Plan geändert, ist die alte Freigabe ungültig.
5. **Policy und Ausführbarkeit** (Tool, Verbindung, Berechtigung) werden unmittelbar vor jedem Knoten erneut geprüft.
6. **Abschluss nur mit Nachweis:** `COMPLETED` setzt erfüllte, deterministisch geprüfte Abschlusskriterien voraus.
7. **Mandantentrennung** durch `forTenantId` und Postgres-RLS auf allen neuen Tabellen; Events, Graph, Fakten, Receipts sind mandantengebunden.
8. **Fakten sind append-only** mit Herkunft; widersprüchliche Werte werden nie stillschweigend überschrieben.

## Neuen Prozess ergänzen (ohne Kernänderung)

1. Fähigkeiten: vorhandene aus dem Katalog nutzen oder neue Tools registrieren und `CapabilityRegistryService.register()` aufrufen.
2. Blueprint als JSON schreiben (siehe `PROCESS_BLUEPRINT_SCHEMA.md`), unter **Administration → Prozessdefinitionen** importieren, prüfen, veröffentlichen, aktivieren.
3. Der E2E-Test `process-orchestration.e2e-spec.ts` führt genau das mit Fixture-Capabilities (`fx.*`) für zwei Mandanten und zwei Blueprints vor.

## Statuskennzeichnung

Siehe `IMPLEMENTATION_STATUS.md` und `BUSINESS_PROCESS_FRAMEWORK_IMPLEMENTATION_PLAN.md` (Abschnitt Akzeptanzkriterien). Der Bericht unterscheidet
konsequent **implementiert**, **automatisiert getestet** und **live nachgewiesen**.
