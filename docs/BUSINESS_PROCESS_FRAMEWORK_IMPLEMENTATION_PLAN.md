# Business Process Framework — Repository-Audit und Umsetzungsplan (Amendment 02, Rev. 1.1)

Phase BP-0 des Amendments (`ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_02_BUSINESS_PROCESS_ORCHESTRATION_FRAMEWORK`,
Version 1.1, 04.10.2026). Stand dieses Dokuments: Audit am 2026-10-04 gegen Commit `b1ece22`.
Die Status-Spalte wird mit jedem Increment aktualisiert; der aktuelle Gesamtstand steht in
`docs/IMPLEMENTATION_STATUS.md`.

Statuswerte: `ALREADY_COMPLETE`, `PARTIAL`, `MISSING`, `BLOCKED_BY_EXTERNAL_CREDENTIALS`.
Nachweisstufen im Abschlussbericht (strikt getrennt): **implementiert** · **automatisiert getestet** · **live nachgewiesen**.

## 1. Grenzen des Audits (ehrlich)

- `ORBIT_MASTER_SPECIFICATION_v3.md` liegt weder im Repository noch in `Downloads`; vorhanden ist
  `docs/ORBIT_MASTER_SPECIFICATION.md` (v1.0), `docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md` und Amendment 01 v2
  (aus `Downloads` gelesen). Master-v3-Verweise des Amendments werden gegen diese Dokumente aufgelöst.
- Die Schemas/Klassen, die das Amendment nennt (`WorkflowEvent`, `PolicyDecision`, `AIProviderResolver`,
  Modellprofile `FAST_CLASSIFICATION` …), existieren **nicht** unter diesen Namen — siehe Tabelle 3.
- Keine ORBIT-weite LLM-Verbindung: `LLM_PROVIDER=mock`, `ANTHROPIC_API_KEY` leer. Live-Triage/-Planung ist
  `BLOCKED_BY_EXTERNAL_CREDENTIALS`; Schema, Runtime, UI und Mock-Contract-Tests sind es nicht.
- Gmail ist nur mit `gmail.readonly` verbunden. Echter Versand braucht den `gmail.send`-Scope **und eine erneute
  Google-Einwilligung durch den Nutzer** — `BLOCKED_BY_EXTERNAL_CREDENTIALS` für den Live-Versand, nicht für Code/Tests.

## 2. Verifizierte Ausgangslage (Auszug, mit Dateien)

| Befund | Beleg |
|---|---|
| Triage ist eine **Keyword-Heuristik**, auch mit echtem Provider (das Tool berechnet neu, ignoriert die LLM-Einschätzung) | `apps/api/src/agent/tools/triage.tools.ts`, `communication.tools.ts` (`FINANCE_KEYWORDS`, `SALES_KEYWORDS`, `MARKETING_PATTERNS`) |
| Im Mock-Modus erzwingt `IntakeService` Tool-Aufrufe (Produktivcode) | `apps/api/src/intake/intake.service.ts` (`this.llm instanceof MockLLMProvider`) |
| Echte Provider existieren (Anthropic, OpenAI), BYOK pro Tenant funktional, aber kein Key hinterlegt | `packages/agent-core/src/llm/*`, `apps/api/src/ai-providers/*`, `.env` |
| Kein Modellprofil-Konzept (nur `ANTHROPIC_MODEL`/`OPENAI_MODEL`) | `packages/config/src/env.ts`, `AIProviderConnection.model` |
| Tool-Ergebnisse: nur geworfene Exceptions galten als Fehler | `packages/agent-core/src/runtime/agent-runtime.ts` (vor Gate 1) |
| `WorkflowStepRun` hat **keinen Status**, keine Attempts, keinen Fehler | `schema.prisma` `WorkflowStepRun` |
| `WorkflowRun.status` nutzt `AgentRunStatus` (RUNNING, WAITING_FOR_APPROVAL, COMPLETED, FAILED, REJECTED) | `schema.prisma` |
| Workflow-Engine: sequentielle Schritte je `AgentDefinition`, JSON-Pfad-Mapping, Bedingungen, Approval-Pause/Resume, Queue/Worker, Retry | `apps/api/src/workflows/*`, `apps/api/worker/workflow-run.processor.ts` |
| Approvals: nur `entityType/entityId/policyAction/status` — **keine Payload-/Versions-/Hash-Bindung** | `schema.prisma` `Approval`, `FollowUpResumeService` |
| `EmailMessage`: nur 500-Zeichen-`bodyPreview`, **keine** Thread-ID, Message-ID, In-Reply-To, References, Content-Hash | `schema.prisma` `EmailMessage`, `gmail-connector.service.ts` (`InboundEmail`) |
| Gmail: Registry behauptet `email.send`, Implementierung nur `gmail.readonly`; kein Senden, kein Thread-Lesen | `google-oauth.config.ts`, `connector-registry.ts` |
| `MAIL_CONNECTOR` ist ein Mock; Tool `send_email` ist `REQUIRE_APPROVAL` und läuft gegen den Mock | `connectors.module.ts`, `sales.tools.ts` |
| Mock-CRM: Zustand nur im Arbeitsspeicher, Referenzen (`crmExternalId`) liegen in Postgres | `packages/integration-core/src/crm/mock-crm-connector.ts`, `contacts.service.ts` |
| Kein SSE außer Sonde (POST-basiert, `fetch`-Reader, Bearer-Header) | `copilot.controller.ts`, `use-copilot.ts` |
| Keine Graph-Bibliothek im Repo; handgebaute SVG-Komponenten vorhanden | `apps/web/package.json`, `packages/ui` |
| Fall-Detailseite ohne Tabs; Inbox-Spalte „Zugewiesener Agent" lebt in der **Dashboard**-„Unified Inbox"-Karte | `cases/[id]/page.tsx`, `dashboard/page.tsx` (~L371-410) |
| Sonde-Panel ohne Kontextobjekt (nur `onClose`) | `components/shell/sonde-panel.tsx` |
| Keine Tabs/Drawer/Dialog in `packages/ui` | `packages/ui/src/index.ts` |
| Playwright: 4 Specs, echter Login gegen laufenden Stack | `apps/web/e2e/*` |
| Queues: `workflow-runs`, `channel-sync` (BullMQ); Tenant-Concurrency-Semaphor | `apps/api/src/queue/*` |

## 3. Abweichungen Amendment ↔ Repository (Namensauflösung)

| Amendment | Repository-Realität | Entscheidung |
|---|---|---|
| `AIProviderResolver` | `AiProviderResolverService` | wiederverwenden |
| `WorkflowEvent`, `PolicyDecision` | nicht vorhanden (Policy-Entscheidung steckt in `ToolInvocation.policyMode`) | neu: `CaseEvent` (§21.3); `PolicyDecision` als Feld/Snapshot im `ActionIntent` |
| Tool Gateway | `ToolRegistry.execute()` + `AgentRuntime.executeToolCall()` | Gateway = diese beiden, erweitert um Ergebnisvertrag (Gate 1) |
| Capability Registry | nicht vorhanden; `ToolDefinition.policyAction` + Connector-`capabilities` | neue **Sicht** (kein zweiter Registry-Speicher), Metadaten an `ToolDefinition` |
| `IntakeEnvelope` | `NormalizedIntakeEvent` + `IntakeEvent` | erweitern (Thread-/Message-IDs, Hash, Richtung) |
| `UniversalCase` | `Case` (Typ nur FINANCE/SALES/…, Status OPEN/IN_PROGRESS/WAITING_APPROVAL/DONE/CANCELLED) | `Case` erweitern, Status-Mapping-Tabelle (§12.1) |
| Neue Status `WAITING_FOR_INFORMATION` … | `CaseStatus` kennt sie nicht | additive Enum-Erweiterung + zentrale Mapping-Funktion |

## 4. Reihenfolge (verbindlich nach Auftrag: Gates vor Features)

### Phase G — Fehler-/Statusgates (vor allem Neuen)

| Gate | Inhalt | Akzeptanz | Dateien | Stand (implementiert / automatisiert getestet / live) |
|---|---|---|---|---|
| G1 | Tool-Ergebnisvertrag `SUCCEEDED/FAILED/OUTCOME_UNKNOWN` (zurückgegebene Fehler **und** Exceptions); `WorkflowStepRun` bekommt Status/Fehler/Attempts; Run/Intake-Fehlerkette | BP-23, §25.2 Pflichtgate | `agent-core/tools/tool-result.ts`, `agent-runtime.ts`, `workflow-runner.service.ts`, `intake.service.ts`, Migration `…150000` | ✅ / ✅ (Unit + e2e) / siehe G5 |
| G2 | Mock-/Test-SoR **dauerhaft, tenantgebunden, existenzgeprüft** (der Präfix-Fix aus `b1ece22` genügt §12.5 **nicht** und wurde ersetzt) | §25.2 „Bekannter Absender nach Neustart", Fremd-/Unbekannt-IDs abgelehnt | `mock_crm_records` + RLS, `PersistentMockCrmConnector`, Backfill `…151000` | ✅ / ✅ (`mock-crm-durability.e2e`, 4 Tests) / Test-SoR, kein echtes CRM |
| G3 | Historisch falschen Erfolg auditiert korrigieren (§24.3) | Audit-Event, nichts gelöscht, kein Neustart des Workflows | `FalseSuccessRepairService`, `scripts/repair-false-success.ts`, `docs/repairs/*` | ✅ / ✅ (`false-success-repair.e2e`, 4 Tests) / ✅ am echten Datensatz ausgeführt und per SQL belegt |
| G4 | Integrationsanzeige nach §19.4: drei getrennte Aussagen; „Fachlicher Prozess erfolgreich getestet" nur mit konkretem Run, verifizierten Schritten/Tools, Ausführungsmodus je Komponente, Build | BP-27 | `ConnectorStatusService`, `ExecutionEvidenceService`, `integrations/page.tsx` | ✅ / ✅ (14 Unit-Tests) / live im Browser: siehe `IMPLEMENTATION_STATUS.md` |
| G5 | E2E-Test der gesamten Kette Tool → StepRun → WorkflowRun → IntakeEvent → Badge (zurückgegebener Fehler, Exception, ungewisses Ergebnis) | §25.2 | `apps/api/test/failure-propagation.e2e-spec.ts` | ✅ / ✅ (4 Tests) / nicht live erzwingbar (kein echter Provider-Fehler provozierbar) |

### Phase BP-1 — Semantischer Intake (BP-01, 02, 11–13)
Triage-Schema (`TriageResult`, zod, zentral in `@orbit/shared`), Triage über `AiProviderResolverService` + `AgentRuntime`
(strukturierte Ausgabe über ein Schema-Tool, Repair/Retry, `PENDING_TRIAGE` bei Ausfall), Keyword-Logik nur noch als
Sicherheits-/Routing-Hinweis, ehrlicher AI-Status (Konfiguration ≠ Betriebsmodus ≠ Health), `IntakeDecision`,
`Case`-Erweiterung, `CaseFact`+Revisionen, Correlation-Basis (Gmail `threadId`/`Message-ID`/`In-Reply-To`),
Eigen-Mail-/Auto-Responder-Erkennung. Mock liefert fixturespezifische strukturierte Ergebnisse.
**Live: BLOCKED_BY_EXTERNAL_CREDENTIALS** (kein LLM-Key).

### Phase BP-2 — Generic Process Core (BP-03–06, 19–22)
Blueprint-Schema + Registry + Lifecycle + Tenant-Aktivierung; Capability-Sicht; Requirements Resolver; Planner
(strukturiert) + deterministischer Plan Validator; Persistenz für Plan/Nodes/Edges/Revisionen; `ActionIntent`/`ActionReceipt`
(Ledger, Idempotenz); `CaseEvent` Inbox/Outbox; Wait-Subscriptions; Limits; Approval-Bindung (Payload-Hash, Planrevision).
Erweiterung der bestehenden Engine, keine zweite.

### Phase BP-3 — Referenzprozess + interaktive UI (BP-07–10, 14–18, 26)
Konfigurierbare Angebots-Requirements, Test-SoR (Preise/Katalog als Fixtures), `quote.create/render`, `email.send` über
echtes Gmail-Senden, Antwortfortsetzung; **gleichzeitig** Graph-Projektion + API, SSE, Case-Tab „Orchestrierung",
Knotendetails, Commands, Timeline-Alternative, Inbox-/Dashboard-Link statt „Zugewiesener Agent", Testbereich
„Kein Geschäftsprozess ausgelöst". Graph-Bibliothek: `@xyflow/react` (Auswahl nach Audit: keine vorhanden; React-19-kompatibel).

### Phase BP-4 — Abnahme + Generalität (BP-24, 25, 29)
Drei Referenzpfade, Antwort-/Resume-Zyklus, Restart-/Concurrency-/Duplikat-/Security-Tests, zweiter Tenant + zweiter Blueprint
ohne Kernänderung, Ad-hoc → Review.

## 5. Akzeptanzkriterien → Plan (Status wird fortlaufend gepflegt)

| ID | Status vor Start | Zuordnung |
|---|---|---|
| BP-01 | PARTIAL (Provider-Code real; Triage = Keywords; kein Key) → live BLOCKED | BP-1 |
| BP-02 | PARTIAL (`IntakeEvent`/`Case` ohne Facts/Decisions) | BP-1 |
| BP-03 | MISSING | BP-2 |
| BP-04 | MISSING | BP-2 |
| BP-05 | MISSING | BP-2 |
| BP-06 | MISSING | BP-2/3 |
| BP-07 | MISSING (kein Gmail-Senden) → live BLOCKED (Scope/Einwilligung) | BP-3 |
| BP-08 | MISSING | BP-3 |
| BP-09 | MISSING | BP-3 |
| BP-10 | PARTIAL (Policy/Approval vorhanden, keine Bindung) | BP-2/3 |
| BP-11 | PARTIAL (NON_ACTIONABLE stoppt Workflow) | BP-1 |
| BP-12 | MISSING (kein Testbereich/Produktivfilter) | BP-1/3 |
| BP-13 | PARTIAL (UNKNOWN_REQUIRES_REVIEW → Task) | BP-1 |
| BP-14 | MISSING („Zugewiesener Agent" auf Dashboard) | BP-3 |
| BP-15–17 | MISSING | BP-3 |
| BP-18 | PARTIAL (Sonde nutzt gleiche Policy) | BP-3 |
| BP-19 | PARTIAL (BullMQ/Postgres vorhanden, keine Wait/Resume-Subscriptions) | BP-2 |
| BP-20/21 | MISSING (kein Ledger) | BP-2 |
| BP-22 | MISSING | BP-2 |
| BP-23 | PARTIAL → **Gate G1/G5** | G |
| BP-24/25 | MISSING | BP-4 |
| BP-26 | MISSING | BP-3 |
| BP-27 | PARTIAL → **G2–G4** | G |
| BP-28 | ALREADY_COMPLETE (Zahlungen gesperrt, RLS, Policy-Locks) | laufend prüfen |
| BP-29 | PARTIAL | laufend |
| BP-30 | PARTIAL | laufend |

## 6. Migration/Risiko

- Alle Prisma-Änderungen additiv; neue Tabellen mit `tenant_id`, RLS-Policy und Eintrag in `TENANT_SCOPED_MODELS`.
- Neue Runtime per Tenant-/Blueprint-Feature-Flag; bestehende `finance-invoice-intake`/`sales-lead-intake`-Workflows laufen unverändert weiter.
- Risiko Gmail-Send: Scope-Erweiterung erzwingt Re-Consent → `AUTH_REQUIRED`-Pfad (Amendment 01 §10) wird genutzt, nichts wird stillschweigend verbunden.
- Risiko Umfang: jedes Increment einzeln lint-/typecheck-/testverifiziert und committet; Statusbericht trennt implementiert / automatisiert getestet / live.
