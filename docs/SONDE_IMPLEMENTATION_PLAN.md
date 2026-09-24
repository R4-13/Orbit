# Sonde — Implementierungsplan (Gap-Analyse)

**Status: Analyse abgeschlossen, Umsetzung noch nicht begonnen.** Dies ist
die in [`docs/SONDE_CONCEPT.md`](SONDE_CONCEPT.md) §52 ("Required
Implementation Approach") geforderte Gap-Analyse gegen den tatsächlichen
Code-Stand (Phase 25, Commit `84da518`), bevor irgendein Sonde-Code
geschrieben wird. Referenziert `docs/AGENT_ARCHITECTURE.md`,
`docs/AGENT_STUDIO_CONCEPT.md`, `docs/SCALABILITY_CONCEPT.md`,
`docs/IMPLEMENTATION_STATUS.md`.

## Kritischer Befund zuerst (§52 Punkt 4+5)

Das Konzept verlangt explizit, vor jeder Umsetzung zu verifizieren, ob (a)
ein Workflow einen Prozess-Neustart überlebt und (b) eine Freigabe einen
pausierten Ablauf automatisch fortsetzen kann. Beide Fragen sind gegen den
tatsächlichen Code eindeutig mit **Nein** zu beantworten:

### (a) Kein Workflow-Resume nach Prozess-Neustart

`WorkflowRunnerService.executeRun()`
([workflow-runner.service.ts:116-190](../apps/api/src/workflows/workflow-runner.service.ts))
läuft die komplette Schrittfolge eines `WorkflowRun` in einer einzigen
`for`-Schleife **innerhalb eines Funktionsaufrufs** — auch im
Async-/Queue-Pfad (`executeQueuedRun()` ruft dieselbe private Methode).
Stürzt der Worker-Prozess mitten in dieser Schleife ab (Deploy, Crash,
OOM), bleibt der `WorkflowRun`-Datensatz für immer im Status `RUNNING`
stehen — nur die bis dahin bereits abgeschlossenen `WorkflowStepRun`-Zeilen
sind persistiert. Es gibt keinen Mechanismus, der einen unterbrochenen
Lauf beim Neustart erkennt oder fortsetzt (kein Checkpoint, kein
"pick up where it left off").

### (b) Kein Approval-Resume

Bereits im bestehenden Code als bekannte, dokumentierte Lücke festgehalten
([`apps/web/src/app/(app)/approvals/page.tsx:37-40`](../apps/web/src/app/(app)/approvals/page.tsx)):

> "FOLLOW_UP entries (agent tool calls blocked by the Policy Engine) have
> no endpoint at all yet: the Agent Runtime never persists the blocked
> call's arguments for a later resume, so there is nothing to actually
> execute on approval — see docs/MASTER_SPEC_GAP_ANALYSIS.md §37. Shown
> read-only."

Konkret fehlt mehr als nur ein Endpunkt:

- `ToolCallOutcome`
  ([agent-runtime.ts:20-26](../packages/agent-core/src/runtime/agent-runtime.ts))
  trägt `toolCallId`/`toolName`/`decision`/`output`/`error` — **nicht**
  die vom LLM erzeugten Eingabeargumente des blockierten Aufrufs. Diese
  gehen bereits auf dem Weg von `AgentRuntime` zu `IntakeService`/
  `WorkflowRunnerService` verloren.
- `Approval`
  ([schema.prisma:628-647](../packages/domain/prisma/schema.prisma))
  hat kein Feld für einen wiederaufnehmbaren Payload (z. B.
  `toolInput: Json?`, Referenz auf `agentRunId`/`workflowRunId` +
  `stepOrder`).
- Selbst mit gespeicherten Argumenten bräuchte ein Workflow-eingebetteter
  blockierter Aufruf eine Fortsetzung **an genau der Stelle** im
  `WorkflowRun` (welcher Schritt, welcher `context.steps[...]`-Zustand) —
  nicht nur einen isolierten Tool-Retry.

**Konsequenz:** Das Konzept selbst zieht daraus in §53 den richtigen
Schluss — "Durable Workflow + Approval Resume" steht nicht zufällig ganz
oben in der empfohlenen Reihenfolge, sondern ist eine echte,
verifizierte Voraussetzung für Sonde-Modus **ACT**/**DELEGATE** mit
Freigabe-Pflicht (§25 des Konzepts: "After approval the durable workflow
must automatically resume"). Ohne diese Grundlage könnte Sonde Aktionen
zwar *vorschlagen* und *anfordern*, eine erteilte Freigabe hätte aber
keine Wirkung — dieselbe Lücke, die heute schon für `FOLLOW_UP`-Einträge
besteht, würde nur um eine Chat-Oberfläche herum sichtbarer, nicht
behoben.

## Wiederverwendbar (keine Neuentwicklung nötig)

| Baustein | Fundstelle | Für Sonde relevant als |
|---|---|---|
| `LLMProvider`-Interface + `AnthropicLLMProvider`/`MockLLMProvider` | `packages/agent-core/src/llm/` | Basis für `stream()`-Erweiterung (§19) — additiv, `complete()` bleibt für bestehende Agenten unverändert |
| `ToolRegistry` + `.subset()` | `packages/agent-core/src/tools/` | Exakt der Mechanismus für §21/§22 (Capability-Filterung nach Permission ∩ Policy ∩ Sonde-Kontext) |
| Policy Engine (`decidePolicyAction`, `PolicyEnforcementService`) | `packages/agent-core/src/policy/`, `apps/api/src/policy/` | Unverändert als einzige Ausführungsfreigabe-Instanz — Sonde braucht keine eigene Autorisierungslogik (§25, §36) |
| `AgentRuntime.runTurn()` | `packages/agent-core/src/runtime/` | Basis für `CopilotRuntime` (§20) — Sonde baut *darauf auf*, ersetzt es nicht |
| `AgentDefinitionResolverService` + `AgentDefinition`/`-Version` | `apps/api/src/agent-definitions/` | Für die in §21 geforderte `sonde_copilot`-`AgentDefinition` — kein neues Konfigurationsmodell nötig |
| `WorkflowRunnerService`/`WorkflowDefinition` | `apps/api/src/workflows/` | Ziel von §23/§8 "DELEGATE" (`start_invoice_workflow` etc.) — **erst nutzbar, wenn der Resume-Befund oben behoben ist** |
| `ApprovalsService`/Approval Center | `apps/api/src/approvals/`, `/approvals`-Frontend | Basis für §25 — Datenmodell muss erweitert werden (siehe unten), UI-Pattern (Action Cards, Freigabe-Status) wiederverwendbar |
| Queue/Worker-Infrastruktur (BullMQ/Redis) | `apps/api/src/queue/`, `apps/api/worker/` | Für §32 "Long-Running Actions" — bereits die Grundlage, auf der Sonde's `DELEGATE`-Modus aufsetzen soll (genau der Grund, warum diese Infrastruktur in Phase 22 *vor* Sonde gebaut wurde, siehe Projekt-Memory) |
| OpenTelemetry-Tracing | `apps/api/src/tracing.ts` | §41 verlangt Tracing über die komplette Copilot-Kette — Instrumentierung bereits vorhanden, neue Spans (Conversation/Copilot-Layer) fügen sich ein, kein neues Setup nötig |
| RBAC/Permissions (`PermissionsGuard`, `RequirePermissions`) | `apps/api/src/auth/guards/` | Für §36/§37 — Sonde-Endpunkte gaten sich genauso wie jeder andere Controller |
| Audit-Infrastruktur (`AuditService`) | `apps/api/src/audit/` | Für §38 — neue Event-Typen (`CONVERSATION_MESSAGE_SENT` etc.) additiv wie bei jeder vorherigen Phase |

## Muss erweitert werden

- **`ToolCallOutcome` + Persistenz-Pfad**: um die tatsächlichen
  Tool-Eingabeargumente ergänzen, bis in `Approval`/`ToolInvocation`
  durchgereicht — Voraussetzung für Resume (siehe kritischer Befund).
- **`Approval`-Modell**: neues Feld für einen wiederaufnehmbaren Payload
  (`toolInput: Json?` + Referenz auf `agentRunId` **oder**
  `workflowRunId`+`stepOrder`) plus ein neuer Endpunkt, der bei
  `entityType: FOLLOW_UP`-Genehmigung den Tool-Aufruf tatsächlich
  ausführt bzw. den `WorkflowRun` fortsetzt.
- **`WorkflowRunnerService`**: braucht eine Fortsetzungsfähigkeit
  (`resumeFromStep`-artiger Parameter, in `docs/SCALABILITY_CONCEPT.md`
  unter "Offene Fragen" bereits als Idempotenz-Frage vorgemerkt) — nicht
  zwingend vollen Crash-Recovery-Support für *jeden* Absturz-Zeitpunkt,
  aber mindestens für den expliziten Fall "wartet auf Freigabe".
- **`LLMProvider`-Interface**: additive `stream()`-Methode (§19) —
  bestehende `complete()`-Aufrufer (IntakeService, WorkflowRunnerService)
  bleiben unverändert.
- **`AnthropicLLMProvider`**: müsste die Anthropic-Streaming-API
  tatsächlich nutzen — bisher nie gegen echte Anthropic-Credentials
  getestet (`docs/IMPLEMENTATION_STATUS.md`: REQUIRES PROVIDER
  CREDENTIALS). Ein echter `ANTHROPIC_API_KEY` wird für Sonde ab Phase 4
  (Streaming) zwingend nötig, nicht mehr optional wie bisher.

## Vollständig neu

Deckt sich mit dem Konzept selbst (§10, §11, §14/15, §30): `CopilotModule`/
`ConversationModule`/`ContextModule`, `Conversation`/`ConversationMessage`/
`ConversationSummary`/`ConversationContext`/`ConversationAction`/
`ConversationReference` als neue Prisma-Modelle (+ RLS-Migration nach
demselben Muster wie jedes vorherige neue Tabellen-Set, z. B. Phase 19g/20),
`CopilotContextService` + Context-Provider je Entity-Typ, `CopilotRuntime`,
neue REST-/SSE-Endpunkte unter `/api/v1/copilot/*`, `SondeCopilot`-
Frontend-Komponente (rechtes Panel, global im Layout eingehängt).

## Offene Rückfragen (bevor Phase 1 beginnt)

1. **Reihenfolge bestätigen**: Konzept §53 empfiehlt "Durable Workflow +
   Approval Resume" *vor* jeder Conversation-Backend-Arbeit — durch die
   obige Verifikation als echte, nicht nur vorsorgliche Voraussetzung
   bestätigt. Soll das als eigene, vorgezogene Phase 0 behandelt werden
   (kleinerer, in sich abgeschlossener Umfang: `Approval`-Erweiterung +
   ein Resume-Endpunkt, **ohne** Conversation-Modell), bevor die
   eigentliche Sonde-Implementierung (Phasen 1-10 aus dem Konzept)
   beginnt?
2. **`ANTHROPIC_API_KEY`**: Phase 4 (Streaming) und jede realistische
   Nutzung von Sonde brauchen ein echtes LLM — `MockLLMProvider` kann
   keine freie Konversation führen (nur vorskriptete Antworten). Steht
   ein Anthropic-API-Schlüssel für diese Umgebung zur Verfügung, oder
   soll bis dahin nur mit `MockLLMProvider` (stark eingeschränkt
   testbar) weitergearbeitet werden?
3. **Umfang von Phase 0/1**: Soll ich direkt mit Phase 0 (Resume-
   Grundlage) beginnen, oder zunächst nur das Prisma-Datenmodell für
   `Conversation`/etc. (Phase 1 laut Konzept) entwerfen und zur
   Durchsicht vorlegen, bevor Migrationen laufen?

## Nächste Schritte

Warte auf Rückmeldung zu den drei Punkten oben, dann Umsetzung in der im
Konzept vorgeschlagenen Reihenfolge (§53), phasenweise mit Lint/Typecheck/
Tests nach jeder Phase (§52 Punkt 10/11), `docs/ASSUMPTIONS.md`/
`docs/IMPLEMENTATION_STATUS.md` nach jeder Phase aktualisiert — dasselbe
Vorgehen wie bei jeder vorherigen Phase dieses Projekts.
