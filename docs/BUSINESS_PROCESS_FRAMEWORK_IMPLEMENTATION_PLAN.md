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

## 5. Akzeptanzkriterien → Stand (implementiert / automatisiert getestet / live nachgewiesen)

Drei Aussagen, bewusst getrennt: **implementiert** (Code vorhanden), **automatisiert getestet** (Unit/E2E, Modell und Mail als Doubles), **live** (im laufenden Docker-System mit echtem Modell nachgewiesen). Fehlende externe Voraussetzungen stehen als Blocker, nie als „live“.

| ID | Implementiert | Automatisiert getestet | Live nachgewiesen | Offen / Blocker |
|---|---|---|---|---|
| BP-01 | ja | ja (Mock-getrennt, Fixtures) | **ja** – Triage mit `gpt-6-luna` (`mode=LIVE`, Newsletter/Anfrage/Injection) am 2026-10-04 | Modellprofile/Evaluationskatalog fehlen |
| BP-02 | ja | ja (`case-facts-and-correlation`) | ja (Anfrage → Case mit Fakten live) |  |
| BP-03 | ja (Registry, Lebenszyklus, Hash, Aktivierung) | ja (`process-orchestration`) | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ |  |
| BP-04 | ja (Planer/Capability-Bindung) | ja (Validator + E2E zwei Prozesse) | – | KI-Planer live nur durch Stichproben |
| BP-05 | ja (11 Prüfungen) | ja (47+ Unit, E2E Ad-hoc-Gate) | – |  |
| BP-06 | ja (Blueprint-`requiredFacts`, Regeln und Preise als Daten) | ja (`reference-process`) | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ | Preisquelle = Test-SoR |
| BP-07 | ja (Rückfrage-Entwurf, Freigabe, Gmail-Versand) | ja (mit Mail-Double), Gmail-Versand per Unit | **BLOCKIERT** für echten Versand: braucht Zustimmung „Sendeberechtigung erteilen“ (`gmail.send`); im Testbetrieb **simuliert** | Echter Versand nicht live belegt |
| BP-08 | ja (Korrelation, WaitSubscription, Fortsetzung) | ja (`reference-process`, Sweep) | simuliert live; echte Antwort-Mail nicht ausgelöst |  |
| BP-09 | ja (Preis → Angebot → PDF → Freigabe → Versand) | ja | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ | Versand simuliert |
| BP-10 | ja (Policy je Zweck, Freigabe an Nutzlast-Hash) | ja | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ |  |
| BP-11 | ja | ja (`triage-resilience`) | **ja** (Newsletter: keine Aktion) |  |
| BP-12 | ja (API + UI-Bereich, Produktivstandard „ausgeblendet“) | API getestet; Sichtbarkeit per Konfig | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ |  |
| BP-13 | ja | ja | **ja** (Prompt-Injection → Prüfung) |  |
| BP-14 | ja (Dashboard/Case) | Typecheck/Lint; Playwright (Spalte „Orchestrierung“, Bereich „Kein Geschäftsprozess ausgelöst“) | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ | Posteingangs-Tabelle: Link über Mail-Zeile in Dashboard |
| BP-15 | ja (Ebenen Gesamt/Tatsächlich/Definition, Kantenstatus) | ja (`case-orchestration-view`) | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ |  |
| BP-16 | ja (Details, Vorschau, Evidenz, Receipts) | ja | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ |  |
| BP-17 | ja (alle Commands) | ja (Commands, 409, Replay) | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ |  |
| BP-18 | ja (Server prüft Berechtigung/Revision) | ja (Berechtigungen, Fremdmandant; `case-context.service.spec`) | **ja** – Sonde beantwortet Fragen im Vorgang aus dem serverseitigen Kontext (nur lesend, führt keine Commands aus) | Sonde-Command-Ausführung bewusst nicht umgesetzt |
| BP-19 | ja (Sweep, Lease, Events in Postgres) | ja (Restart/Frist/Lease) | – |  |
| BP-20 | ja (Ledger, Exactly-once-Dispatch) | ja (parallele advance, Replay) | – |  |
| BP-21 | ja | ja (`OUTCOME_UNKNOWN`, Abgleich) | nicht live erzwingbar |  |
| BP-22 | ja (Revisionen, Diff, Freigabe-Invalidierung) | ja (Edit → neue Freigabe, Plan-Gate) | – | Replan-Loop-Schleifen nur über Revisionen |
| BP-23 | ja | ja (Tool → Node → Case → Intake → Graph → Badge) | Teil live (Gate G) |  |
| BP-24 | ja | ja (zweiter Mandant + zweiter Blueprint, Fixture-Capabilities) | – |  |
| BP-25 | ja | ja (Ad-hoc-Plan, Bestätigung, Ablehnung) | – |  |
| BP-26 | ja (Liste als Alternative, ARIA, Responsivität) | Typecheck/Lint; Playwright (390 px ohne horizontales Scrollen, schreibgeschützter Nutzer ohne Aktionen) | **ja, mit simuliertem Versand** – Abschnitt „Live-Nachweis“ | – |
| BP-27 | ja | ja | Teil live (Gate G, KI-Status) |  |
| BP-28 | ja | bestehende Tests grün | – |  |
| BP-29 | ja | ja (siehe Abschlussbericht) | – |  |
| BP-30 | ja | – | – | diese Datei, `IMPLEMENTATION_STATUS.md`, `KNOWN_LIMITATIONS.md` |

## 5a. Live-Nachweis (2026-10-04, Docker-Stack, echtes Modell `gpt-6-luna`, Versand **simuliert**)

Durchgeführt im laufenden System über die Oberfläche bzw. die HTTP-API des Demo-Mandanten (Build `3b21576` und folgende; API-/Worker-Container mit `LLM_PROVIDER=openai`, `OUTBOUND_MAIL_MODE=simulated`).

| Pfad / Nachweis | Ergebnis |
|---|---|
| **Pfad 1 – kein Geschäftsprozess** | Newsletter → `NON_ACTIONABLE` (KI `gpt-6-luna`, Sicherheit 97 %), erscheint nur unter „Kein Geschäftsprozess ausgelöst“, Aktion: *Keine*. Prompt-Injection-Mail → Risikoflags `PROMPT_INJECTION_SUSPECTED`/`PHISHING_SUSPECTED`, Prüfung, keine Aktion. |
| **Pfad 2 – unvollständig → Rückfrage → Antwort → Angebot** | Eingabe im Posteingang (Fenster, ohne Menge/Adresse) → Triage live → Case auf Blueprint → Extraktion live (SKU `FENSTER-STD` mit Beleg) → Rückfrage-Entwurf mit genau den zwei offenen Fragen an die Kopfzeilen-Adresse → Freigabe im Dialog (Empfänger/Betreff/Text sichtbar) → Versand **simuliert** (Beleg `sim-…`) → Antwort über „Antwort simulieren“ durch den normalen Eingang mit In-Reply-To → Zuordnung `IN_REPLY_TO`, **keine zweite Triage** → Extraktion der Antwort live (14 Stück, Lieferadresse) → Preis 14 × 395,00 € (Staffel) = 5.530,00 € netto, 6.580,70 € brutto → Angebot `ANG-2026-0001` + PDF → Freigabe mit Betragsvorschau → Versand simuliert → Case **Abgeschlossen** mit Nachweis. |
| **Pfad 3 – vollständig → Angebot** | Anfrage (2 Haustüren, Lieferadresse) → keine Rückfrage (Schritte übersprungen) → Angebot `ANG-2026-0002` über 4.498,20 € brutto → Freigabe → **Abgeschlossen**. |
| Oberfläche | Orchestrierungs-Tab (Liste/Graph, Zustände mit Symbol und Wort, Live/Simuliert je Schritt), Knotendetails mit Nachweis, Dashboard-Spalte „Orchestrierung“ statt „Zugewiesener Agent“, Bereich „Kein Geschäftsprozess ausgelöst“, Prozessdefinitionen (Capabilities mit Ausführbarkeit), Sonde mit Case-Kontext (antwortet ehrlich: „simuliert versendet – kein tatsächlicher Versand bestätigt“). Playwright-Abnahme `apps/web/e2e/orchestration.spec.ts` (5 Tests, inkl. 390 px ohne horizontales Scrollen, schreibgeschützter Nutzer ohne Aktionen) gegen den laufenden Stack grün. |
| Modell-Evaluation | 16 Fälle live (siehe `docs/evaluation/README.md`): 13/16 → 16/16 nach Prompt-Regel, **kein unabhängiger Holdout**. |

**Nicht live bewiesen / Blocker**

* **Echter Gmail-Versand und echte Antwort-Mail:** blockiert durch die fehlende Zustimmung `gmail.send` („Sendeberechtigung erteilen“ unter Integrationen) und `OUTBOUND_MAIL_MODE=gmail`. Implementiert und per Unit-/E2E-Test mit Doubles belegt, aber **nicht live**.
* Preisquelle ist ein Test-SoR; `OUTCOME_UNKNOWN`, Worker-Neustart während einer Wartephase und Fremdmandanten-Zugriff sind automatisiert, nicht live erzwungen.
* Sonde führt keine Commands aus (nur erklären/zusammenfassen).

## 6. Migration/Risiko

- Alle Prisma-Änderungen additiv; neue Tabellen mit `tenant_id`, RLS-Policy und Eintrag in `TENANT_SCOPED_MODELS`.
- Neue Runtime per Tenant-/Blueprint-Feature-Flag; bestehende `finance-invoice-intake`/`sales-lead-intake`-Workflows laufen unverändert weiter.
- Risiko Gmail-Send: Scope-Erweiterung erzwingt Re-Consent → `AUTH_REQUIRED`-Pfad (Amendment 01 §10) wird genutzt, nichts wird stillschweigend verbunden.
- Risiko Umfang: jedes Increment einzeln lint-/typecheck-/testverifiziert und committet; Statusbericht trennt implementiert / automatisiert getestet / live.
