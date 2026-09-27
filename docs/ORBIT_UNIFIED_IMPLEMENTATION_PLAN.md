# ORBIT Unified Evolution — Implementierungsplan (Phase 0: Gap-Analyse)

**Status: Analyse abgeschlossen, Umsetzung läuft (siehe
`docs/IMPLEMENTATION_STATUS.md` für den jeweils aktuellen Stand je
Phase).** Diese Datei ist die von
[`docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md`](ORBIT_UNIFIED_EVOLUTION_CONCEPT.md)
§74 Phase 0 / §77 geforderte Gap-Analyse gegen den tatsächlichen
Code-Stand (Commit `30bf2ea`, nach Phase 25/Observability + dem
verworfenen ersten Sonde-Konzept). **Ersetzt**
`docs/SONDE_CONCEPT.md`/`docs/SONDE_IMPLEMENTATION_PLAN.md` als
maßgebliches Sonde-Konzept (Nutzer-Anweisung: "ignoriere das letzte
Konzept") — die dort bereits geleistete Detailanalyse zum
Workflow-/Approval-Resume-Befund bleibt aber inhaltlich gültig und wird
hier übernommen, nicht wiederholt neu hergeleitet.

## Autonome Scope-Entscheidung (Nutzer-Anweisung befolgt)

Der Nutzer hat angewiesen, alles umzusetzen, was **kein** Eingreifen
erfordert (z. B. keine Erstellung echter API-Tokens bei Anthropic/OpenAI).
Daraus abgeleitete, eigenständig getroffene Entscheidungen:

- **Provider-Adapter werden vollständig implementiert und mit Unit-
  Tests gegen Mocks verifiziert** (Struktur, Validierung, Fehlerpfade),
  aber **nie live gegen einen echten OpenAI-/Anthropic-Endpunkt
  getestet** — konsistent mit dem bereits etablierten Muster für
  DATEV/HubSpot/Twilio (`REQUIRES PROVIDER CREDENTIALS`).
- **"ORBIT-Managed AI" bleibt in dieser Umgebung ohne echten
  Platform-API-Key** — die Infrastruktur (Connection-Modell,
  Credential-Verschlüsselung, Admin-UI) wird vollständig gebaut, der
  tatsächliche Platform-Schlüssel ist ein späterer, echter
  Betriebsvorgang außerhalb dieser Session.
- **Phase 11 (Real Provider and Connector Validation)** kann in dieser
  Umgebung grundsätzlich nicht abgeschlossen werden — bleibt
  `BLOCKED_BY_EXTERNAL_CREDENTIALS`, wie schon jede bisherige
  Provider-Zeile in `docs/IMPLEMENTATION_STATUS.md`.
- **Google Gemini/Azure/Bedrock-Adapter** (§59, "später") werden
  bewusst **nicht** gebaut — das Konzept selbst markiert sie als "later",
  kein MVP-Bestandteil. Nur Anthropic (bereits vorhanden) + OpenAI (neu,
  §36 "initial catalogue") werden umgesetzt.

## Klassifikations-Übersicht

| # | Bereich (Konzept-§) | Klassifikation | Kurzbegründung |
|---|---|---|---|
| 1 | Kernplattform (§2.1: Multi-Tenancy, RLS, RBAC, API-first) | ALREADY_COMPLETE | Unverändert seit Phase 1-19, siehe `docs/IMPLEMENTATION_STATUS.md` |
| 2 | Finance-/Sales-Workflow (§2.2/2.3) | ALREADY_COMPLETE | Live getestet, unverändert |
| 3 | Connector-Interfaces + Mocks (§2.4) | ALREADY_COMPLETE (Interface), BLOCKED_BY_EXTERNAL_CREDENTIALS (real) | Unverändert |
| 4 | Agent-Plattform (§2.5: LLMProvider, Tool Registry, Policy Engine, Agent Studio) | ALREADY_COMPLETE | Phase 18/20/21 |
| 5 | Async/Observability (§2.6: BullMQ, Tracing) | ALREADY_COMPLETE | Phase 22/25 |
| 6 | **Durable Workflow State + Approval Resume (§3-9)** | **MISSING** | Verifiziert in der vorherigen Sonde-Gap-Analyse: kein Crash-Resume, `ToolCallOutcome` trägt keine Tool-Argumente, `Approval` hat kein Resume-Payload-Feld. **Höchste Priorität**, siehe Detailanalyse unten. |
| 7 | Idempotente Ausführung (§7) | PARTIAL | Webhook-Idempotenz existiert (`WebhookIdempotencyService`, Phase 19g) — aber kein generisches `idempotencyKey`-Muster für Tool-/Connector-Schreibaufrufe |
| 8 | Deterministische vs. LLM-Verantwortung (§8/§9/§16) | ALREADY_COMPLETE | Bereits exakt so umgesetzt: Policy Engine, Tenant-Isolation, Approval-Regeln sind reiner Code, kein Prompt-Anteil |
| 9 | Domain-Level Workflow-Capabilities (§10) | MISSING | `start_invoice_processing_workflow()`-artige High-Level-Tools existieren nicht — bisher nur einzelne granulare Tools |
| 10 | Agent Lifecycle (DRAFT→PUBLISHED→...) (§12) | PARTIAL | `AgentDefinition.status` kennt nur `DRAFT`/`ACTIVE`/`DISABLED` (3 Zustände), nicht die volle 8-stufige Lifecycle aus §12 |
| 11 | Agent-Versionierung (§13) | ALREADY_COMPLETE | `AgentDefinitionVersion` seit Phase 20, inkl. Rollback |
| 12 | Prompt-Layering (§14) | PARTIAL | System-Prompt kommt aus `AgentDefinition`, aber keine explizite mehrschichtige Struktur (Plattform-Regeln/Security getrennt von Tenant-Konfiguration) |
| 13 | Prompt-Injection-Grenze (§15) | ALREADY_COMPLETE | `docs/SECURITY.md` behandelt das bereits konzeptionell; Tool-Ergebnisse fließen nie als Systemanweisung zurück |
| 14 | Agent-Evaluationsframework (§17) | MISSING | Kein formales Regressions-Suite-Konzept für Agent-Verhalten über die bestehenden Unit-/E2E-Tests hinaus |
| 15 | **Sonde Copilot gesamt (§18-34, §71-72)** | **MISSING** | Kein Conversation-Modell, kein Chat-Endpunkt, keine UI — Detailanalyse unten |
| 16 | **Multi-Provider-LLM-Architektur (§35-59, §73)** | **MISSING** (OpenAI-Adapter, Provider-Registry, BYOK-UI), **PARTIAL** (Interface selbst) | Detailanalyse unten |
| 17 | Intake-Architektur (Event-driven, §61) | MISSING (bewusst zurückgestellt) | Braucht echten Mail-Connector-Webhook — `BLOCKED_BY_EXTERNAL_CREDENTIALS` für den produktiven Teil; die Queue-Infrastruktur dafür existiert bereits (Phase 22) |
| 18 | Tenant-Concurrency-Fairness (§62) | MISSING | In `docs/SCALABILITY_CONCEPT.md` bereits als offener Punkt dokumentiert (Alternativen genannt, nichts umgesetzt) |
| 19 | Strukturiertes Logging (§63) | MISSING | Echter, in Phase 25 gefundener Befund: `pino`/`pino-http` sind Dependencies, aber nie verdrahtet — siehe `docs/OBSERVABILITY.md` |
| 20 | Metrics/`/metrics`-Endpoint (§64) | PARTIAL (in Arbeit) | War als Phase 26 bereits begonnen (Dependency installiert), hier fortgeführt |
| 21 | Failed-Work-Operations-Admin-UI (§65) | MISSING | Kein Retry-/Cancel-UI für fehlgeschlagene Jobs |
| 22 | Retention/Privacy (§66) | PARTIAL | DSGVO-Datenexport/-Löschung existiert (Phase 19f), aber keine kategorienspezifische Retention-Policy-Engine |
| 23 | Finance-Prioritäten (§67) | Bereits als Reihenfolge in `docs/MASTER_SPEC_GAP_ANALYSIS.md` reflektiert | Keine Code-Änderung, nur Priorisierungs-Bestätigung |
| 24 | User-facing Workflow-Visibility / Error-UX (§68-69) | PARTIAL | `Case` existiert bereits als business-facing Container; technische Fehler werden aber noch nicht durchgehend in verständliche Business-Zustände übersetzt |
| 25 | Security-Review-Checkliste (§70) | PARTIAL | Viele Einzelpunkte bereits einzeln verifiziert (RLS-Bypass, RBAC, Prompt-Injection-Doku); keine gebündelte, formale Review-Durchführung |
| 26 | Dokumentations-Set (§76) | PARTIAL | `docs/OBSERVABILITY.md` existiert bereits (deckt Teile von `AI_PROVIDER_ARCHITECTURE.md`-Nachbarthemen nicht ab); die übrigen sechs Dateien fehlen noch |

## Detailanalyse: Durable Workflow + Approval Resume (höchste Priorität)

Unverändert aus der vorherigen Analyse übernommen (`docs/SONDE_IMPLEMENTATION_PLAN.md`,
jetzt hier als Phase 1 dieses vereinheitlichten Plans geführt):

- `WorkflowRunnerService.executeRun()` läuft die komplette Schrittfolge
  in einer einzigen In-Memory-`for`-Schleife — kein Crash-/Restart-Resume.
- `ToolCallOutcome` trägt keine Tool-Eingabeargumente — verloren, bevor
  sie in `Approval` ankommen könnten.
- `Approval` hat kein Feld für einen wiederaufnehmbaren Payload.

**Reused**: `WorkflowRun`/`WorkflowStepRun`-Datenmodell (nur erweitert,
nicht ersetzt), `ApprovalsService`, `WorkflowRunQueueService`/BullMQ
(bereits die richtige Infrastruktur für "stoppt sicher, wird später
fortgesetzt").
**New**: `Approval.resumePayload: Json?` + `Approval.workflowRunId`/
`stepOrder`-Referenz, ein `POST /approvals/:id/resume`-Pfad (oder
Erweiterung des bestehenden Decide-Flows), `WorkflowRunnerService`
bekommt eine `resumeFromApproval()`-Methode, die den betroffenen Schritt
mit dem gespeicherten Payload fortsetzt statt den ganzen Lauf neu zu
starten.
**Schema-Änderung**: neue Migration auf `Approval` (additiv, kein
Breaking Change) + RLS-Follow-up-Migration nach etabliertem Muster
(Phase 19g/20/21).
**Risiko**: mittel — Kernlogik der Workflow-Ausführung wird verändert;
volle Regressionsabsicherung durch bestehende
`workflow-orchestration.e2e-spec.ts`/`workflow-async-trigger.e2e-spec.ts`
(müssen unverändert grün bleiben) plus neue Tests für den Resume-Pfad.

## Detailanalyse: Sonde Copilot

Deckt sich mit der vorherigen Analyse (`docs/SONDE_IMPLEMENTATION_PLAN.md`,
"Wiederverwendbar"/"Muss erweitert werden"/"Vollständig neu") — hier nur
die Delta zum vereinheitlichten Konzept:

- **Domain-Level Delegation-Tools** (§10, §30 "DELEGATE") sind jetzt
  explizit als eigene Kategorie benannt, nicht nur implizit — diese
  Tools (`start_invoice_processing_workflow` etc.) sind selbst wieder
  von der Durable-Workflow-Grundlage abhängig, nicht nur Sonde.
- **Provider-Strategie** (§35-59) ist neu gegenüber dem vorherigen
  Sonde-Konzept — Sonde nutzt jetzt die Multi-Provider-Architektur statt
  direkt `AnthropicLLMProvider`.

## Detailanalyse: Multi-Provider-LLM-Architektur

**Reused**: bestehendes `LLMProvider`-Interface als Ausgangspunkt (wird
erweitert, nicht ersetzt — `complete()` bleibt für alle bestehenden
Aufrufer unverändert nutzbar), `CredentialEncryptionService` (Phase 19g,
AES-256-GCM) als Grundlage für `AIProviderConnection.secretReference`
statt eines neuen Verschlüsselungsmechanismus.
**New**: `stream()`-Methode auf `LLMProvider`, `OpenAILLMProvider`
(`@anthropic-ai/sdk`-Analogon: offizielles `openai`-npm-Paket),
Provider-Registry, `AIProviderConnection`/`AIModelProfile`/
`AITenantPolicy`/`AIUsageRecord`-Modelle, `/admin/ai-providers`-Frontend.
**Schema-Änderung**: vier neue Prisma-Modelle, additive Migration + RLS.
**Security-Impact**: neue Secret-Kategorie (Provider-API-Keys) — nutzt
dasselbe bereits geprüfte Verschlüsselungsmuster wie
`Integration.encryptedCredentials`, kein neues Risiko-Muster.
**Test-Impact**: Unit-Tests für Provider-Auswahl/-Validierung/-Fallback-
Policy, E2E nur gegen `MockLLMProvider`/`OpenAILLMProvider` mit
gemocktem HTTP-Client (kein echter API-Call).

## Roadmap (übernimmt §74, mit Klassifikation je Phase)

| Phase | Inhalt | Klassifikation | In dieser Session umsetzbar? |
|---|---|---|---|
| 0 | Gap-Analyse (dieses Dokument) | — | ✅ erledigt |
| 1 | Durable Orchestration (Workflow-State, Approval-Resume, Idempotenz) | ✅ erledigt (Approval-Resume + Pause-Semantik; generische Connector-Idempotenz-Keys bewusst nicht Teil dieser Stufe) | ✅ Ja — siehe `docs/IMPLEMENTATION_STATUS.md` |
| 2 | Operational Hardening (Logging, Metrics, Failed-Jobs-UI, Tenant-Concurrency, Retention-Grundlage) | ✅ erledigt (Metrics + Logging + Tenant-Concurrency + Failed-Work-Retry + Retention-Grundlage) | ✅ Ja — siehe `docs/IMPLEMENTATION_STATUS.md` |
| 3 | Agent Governance (Lifecycle, Prompt-Layering, Evaluationsframework) | PARTIAL/MISSING | ✅ Ja |
| 4 | LLM Provider Platform (OpenAI-Adapter, Provider-Registry, BYOK-Modell, Admin-UI) | MISSING | ✅ Ja (strukturell, ohne Live-Test) |
| 5 | Sonde Conversation Foundation | MISSING | ✅ Ja |
| 6 | Sonde Read Mode | MISSING | ✅ Ja |
| 7 | Sonde Streaming UX | MISSING | ✅ Ja (SSE-Infrastruktur ja; echtes Streaming von `AnthropicLLMProvider`/`OpenAILLMProvider` nur strukturell, da kein Live-Provider) |
| 8 | Sonde Prepare Mode | MISSING | ✅ Ja |
| 9 | Sonde Safe Actions | MISSING | ✅ Ja |
| 10 | Sonde Workflow Delegation | MISSING | ✅ Ja (abhängig von Phase 1) |
| 11 | Real Provider and Connector Validation | BLOCKED_BY_EXTERNAL_CREDENTIALS | ❌ Nein — braucht echte Zugangsdaten |
| 12 | Hardening and Pilot Readiness (Security-/Load-Tests) | PARTIAL | ⚠️ Teilweise — Security-/Regressionstests ja, echte Lasttests gegen produktionsnahe Infrastruktur nicht sinnvoll in dieser Umgebung |

**Abweichung von §74 bewusst vorgenommen**: Phase 4 (Provider Platform)
wird **vor** Sonde konkret gebraucht (Sonde nutzt die Provider-Abstraktion
für Streaming), aber die Reihenfolge 1→2→3→4→5... bleibt wie im Konzept
vorgeschlagen — keine Umstellung nötig, nur bestätigt.

## Nächste Schritte

**Phase 1 (Durable Orchestration) und Phase 2 (Operational Hardening)
sind abgeschlossen** — siehe `docs/IMPLEMENTATION_STATUS.md` und
`docs/ASSUMPTIONS.md` #200-243 für die getroffenen Detailentscheidungen
(Retention-Grundlage zuletzt: #237-243, konservativer Scope ohne
automatischen Scheduler, siehe dort). Weiter mit Phase 3 (Agent
Governance: Lifecycle, Prompt-Layering, Evaluationsframework), danach
Phase 4-10 der Reihe nach, jeweils mit vollständiger Verifikation
(Lint/Typecheck/Unit/E2E) und Dokumentations-Update nach jeder Phase,
exakt wie bei jeder vorherigen Phase dieses Projekts. Phase 11 bleibt
dauerhaft offen (externe Zugangsdaten), Phase 12 wird so weit
umgesetzt, wie ohne Produktionsinfrastruktur sinnvoll möglich.
