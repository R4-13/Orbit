# Agent-Architektur — Project ORBIT

Diese Datei beschreibt `packages/agent-core` (LLM-/Tool-/Policy-
Infrastruktur) und **wie sie seit Phase 18 tatsächlich verdrahtet ist**.
Für RBAC/Auth (die andere, unabhängige Autorisierungsachse) siehe
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md). Tenant-konfigurierbare
Agenten (Prompt/Tool-Zugriff, `apps/api/src/agent-definitions/`) und
Mehr-Agenten-Orchestrierung (`apps/api/src/workflows/`) sind seit
Phase 20/21 implementiert — Design-Herleitung und Abweichungen vom
ursprünglichen Entwurf: [`docs/AGENT_STUDIO_CONCEPT.md`](AGENT_STUDIO_CONCEPT.md).

## Status

Seit Phase 18 (`docs/ASSUMPTIONS.md`) gibt es ein echtes `AgentModule`
(`apps/api/src/agent/`) und einen echten Einstiegspunkt
(`POST /api/v1/intake/emails`, `apps/api/src/intake/`), der die volle
Schleife **Agent → Tool Registry → Policy Engine → Tool Gateway →
Connector** tatsächlich live gegen Postgres ausführt — verifiziert über
`apps/api/test/intake-workflow.e2e-spec.ts`. Drei der vier in §12
spezifizierten Agenten sind als konkrete Tool-Gruppen + System-Prompts
umgesetzt: **Communication/Intake** (Klassifikation),
**Finance/AP** (Rechnungsverarbeitung), **Sales/CRM** (Lead-Erzeugung).
Der vierte, der **Orchestrator**, existiert nicht als eigener Agent-Typ
mit eigenem LLM-Aufruf, sondern als deterministischer Ablauf in
`IntakeService` selbst (Case anlegen, klassifizieren, an den passenden
Fachagenten weiterreichen) — siehe "Bewusste Vereinfachungen" unten.

**Weiterhin nicht angebunden**: ein echter Trigger. `POST
/api/v1/intake/emails` *simuliert* eine eingehende E-Mail — es gibt
keinen echten Mail-Connector-Webhook, der diesen Endpunkt automatisch
aufruft (kein Microsoft Graph-/Gmail-Zugang, siehe
`docs/KNOWN_LIMITATIONS.md`). Telefonie ist ebenfalls nicht angebunden.

## Bausteine

### LLMProvider (`packages/agent-core/src/llm/`)

Provider-agnostisches Interface:

```ts
interface LLMProvider {
  readonly providerName: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
}
```

`LLMCompletionRequest` trägt `systemPrompt?`, `messages`, die verfügbaren
`tools` (als `LLMToolDefinition[]`) und `maxTokens?`. Zwei
Implementierungen, ausgewählt über `LLM_PROVIDER` (Env-Var, Default
`mock`):

- **`MockLLMProvider`** — die Default-Implementierung dieser Umgebung.
  Kein Algorithmus "was würde ein LLM sagen" — stattdessen eine Warteschlange
  vorab bestimmter Antworten, per `seedResponse()` befüllbar. Eine
  Antwort kann entweder ein fester Wert **oder eine Funktion** sein, die
  die tatsächliche Konversation (inkl. der echten Tool-Ergebnisse
  vorheriger Schritte) liest und daraus ihre Antwort ableitet — das ist,
  was `IntakeService` nutzt, um z. B. `create_booking_proposal` mit dem
  *echten*, gerade erst erzeugten `invoiceId`/`amountGross` aus
  `extract_invoice`s Ergebnis aufzurufen, statt mit einem vorab
  festgelegten Wert. **Wichtig**: `MockLLMProvider` ist ein
  Prozess-weites Singleton (wie `MockOcrProvider`/`MockFinanceConnector`)
  — jeder Aufrufer muss **genau** so viele Antworten vorseeden, wie
  tatsächlich konsumiert werden, sonst bleiben Antworten in der
  Warteschlange liegen und verfälschen den *nächsten*, unabhängigen
  Aufruf. Live gefunden und behoben (siehe ASSUMPTIONS #98) — deshalb
  seedet `IntakeService` nie eine überzählige "end_turn"-Abschlussantwort:
  `MockLLMProvider.complete()` liefert bei leerer Warteschlange ohnehin
  automatisch einen sicheren leeren `end_turn` zurück.
- **`AnthropicLLMProvider`** — echter `@anthropic-ai/sdk`-Wrapper,
  ausgewählt über `LLM_PROVIDER=anthropic`, braucht `ANTHROPIC_API_KEY`.
  **REQUIRES PROVIDER CREDENTIALS** — nie live gegen die echte
  Anthropic-API getestet, aber derselbe Code-Pfad (`AgentModule`,
  `IntakeService`, alle Tools) läuft strukturell identisch damit; nur das
  Skripten der `MockLLMProvider`-Antworten entfällt dann, weil eine
  echte LLM-Antwort selbst entscheidet, welche Tools sie in welcher
  Reihenfolge aufruft.

### Tool Registry (`packages/agent-core/src/tools/`)

Ein Tool ist:

```ts
interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  policyAction: PolicyActionKey;   // aus @orbit/shared/policy.ts
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}
```

Ein einziges Zod-Schema pro Tool dient doppelt: `ToolRegistry.execute()`
validiert eingehende (vom LLM erzeugte) Eingaben zur Laufzeit damit, und
`toLLMToolDefinitions()` leitet daraus (über `zod-to-json-schema`) das
JSON-Schema ab, das dem LLM als Tool-Definition angeboten wird.

`ToolExecutionContext` trägt `tenantId`, `agentRunId` und optional
`actorUserId` (fehlt bei einem echt autonomen Lauf ohne menschlichen
Auslöser — Tools attribuieren ihre Audit-Einträge dann als `actorType:
'AGENT'` statt einen Nutzer zu erfinden).

**15 konkrete Tools** sind registriert
(`apps/api/src/agent/tools/{finance,sales,communication}.tools.ts`), alle
als dünne Wrapper um bereits getestete Phase-7/8-Services — keine
Geschäftslogik wurde dupliziert:

| Tool | Wrappt | Policy Action | Default-Modus |
|---|---|---|---|
| `classify_message` | (Stichwort-Heuristik) | `email.classify` | AUTONOMOUS |
| `extract_invoice` | `InvoicesService.createFromDocument` | `invoice.intake` | AUTONOMOUS |
| `create_booking_proposal` | `InvoicesService.addBookingProposal` | `booking_proposal.create` | AUTONOMOUS |
| `transfer_invoice_to_finance` | `InvoicesService.transfer` | `invoice.transfer_to_fibu` | REQUIRE_APPROVAL |
| `find_contact` / `create_contact` | `ContactsService` | `crm.contact.manage` | AUTONOMOUS |
| `create_company` | `CompaniesService.upsert` | `crm.contact.manage` | AUTONOMOUS |
| `create_lead` | `LeadsService.create` | `lead.create` | AUTONOMOUS |
| `update_opportunity` | `OpportunitiesService` | `crm.activity.log` | AUTONOMOUS |
| `create_task` | `TasksService.create` | `task.create` | AUTONOMOUS |
| `get_calendar_availability` | `CalendarConnector.findAvailability` | `calendar.read` | AUTONOMOUS |
| `create_meeting` | `MeetingsService.proposeSlots` | `meeting.propose` | AUTONOMOUS |
| `log_crm_activity` | `CrmConnector.logActivity` | `crm.activity.log` | AUTONOMOUS |
| `draft_email` / `send_email` | `EmailMessage`/`MailConnector.sendMessage` | `email.draft`/`followup.send` | AUTONOMOUS/REQUIRE_APPROVAL |

`find_customer` aus §14 fehlt bewusst — es gibt kein Customer/AR-Modell
(nur Supplier/AP), siehe `docs/MASTER_SPEC_GAP_ANALYSIS.md` §10.
`find_supplier`/`check_duplicate_invoice` sind nicht als eigene Tools
registriert — `extract_invoice` erledigt beides bereits intern (dieselbe
Methode, die Phase 7 schon live testete) und gibt das Ergebnis
(`supplierId`, `status`) zurück, was ein vorheriger Lookup ohnehin liefern
würde.

### Policy Engine (`packages/agent-core/src/policy/`)

Unverändert eine reine Funktion:

```ts
type PolicyDecision = 'ALLOW' | 'SUGGEST_ONLY' | 'REQUIRE_APPROVAL' | 'DENY';
function decidePolicyAction(mode: PolicyMode): PolicyDecision;
```

`PolicyEnforcementService.resolveMode()` schlägt den tatsächlich
konfigurierten Modus in der `PolicyConfig`-Tabelle nach — **Fail-Safe:
`REQUIRE_APPROVAL`, falls kein Eintrag existiert** (nicht der
Code-Default aus `DEFAULT_POLICY_CONFIG`!). Das hat eine echte
Betriebs-Konsequenz: eine neue `POLICY_ACTIONS`-Ergänzung wirkt für
**bereits existierende** Tenants erst nach einem Reseed/Backfill ihrer
`PolicyConfig`-Zeilen — live erlebt beim Hinzufügen der fünf neuen
Actions in Phase 18 (ASSUMPTIONS #97).

**Wenn `AgentRuntime` einen Tool-Aufruf nicht mit `ALLOW` ausführt**
(`SUGGEST_ONLY`/`REQUIRE_APPROVAL`/`DENY`), führt es das Tool nicht aus —
das ist absichtlich der Aufrufer-Job (`AgentRuntime`s eigener
Code-Kommentar). `IntakeService.createApprovalsForBlockedCalls()`
übernimmt das: jeder nicht-`ALLOW`/nicht-`DENY`-Outcome erzeugt einen
Eintrag im generischen Approval Center (`entityType: 'FOLLOW_UP'`), analog
zu der in Phase 18 auch für die bestehenden menschlichen
Freigabe-Workflows (Supplier/Invoice) nachgerüsteten Wiring (§37 im
Master-Prompt).

### AgentRuntime (`packages/agent-core/src/runtime/`)

Unverändert:

```ts
class AgentRuntime {
  constructor(llm: LLMProvider, tools: ToolRegistry, resolvePolicyMode: PolicyModeResolver);
  runTurn(context, input: RunAgentTurnInput): Promise<AgentTurnResult>;
}
```

`AgentModule` verdrahtet **eine** gemeinsame `ToolRegistry`-Instanz (alle
15 Tools) und **eine** App-weite `AgentRuntime`-Singleton-Instanz —
diese unveränderte Vollausstattung wird aber seit Phase 20 von
`IntakeService` nicht mehr direkt für die drei Live-Aufrufstellen
verwendet, siehe nächster Abschnitt.

**Seit Phase 20: `AgentDefinitionResolverService` baut pro Aufruf eine
eigene, tool-eingeschränkte `AgentRuntime`-Instanz.**
(`apps/api/src/agent-definitions/agent-definition-resolver.service.ts`) —
die konkrete Umsetzung von docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1
("Agenten-Konfiguration"). `AgentRuntime`s Konstruktor-Signatur selbst
ist unverändert (`llm`, `tools`, `resolvePolicyMode`); was sich ändert,
ist *welche* Instanz ein Aufrufer benutzt: `resolve(tenantId, key)`
schlägt die zum `key` gehörige, `ACTIVE` `AgentDefinition`-Zeile nach,
baut über die neue `ToolRegistry.subset(allowedTools)`-Methode
(packages/agent-core) eine gefilterte Registry und konstruiert daraus
eine frische `AgentRuntime` (billig — drei Referenzen, kein I/O). Der
System-Prompt kommt ebenfalls aus dieser Zeile statt aus einem
Literal-String. Admin-CRUD für diese Zeilen (Prompt/Tools/Status
ändern, neue Agenten anlegen, Versionshistorie, Rollback) läuft über
`AgentDefinitionsService` + `/admin/agents` — gated über die neue
`AGENT_MANAGE`-Permission.

## Der Orchestrator: `IntakeService`

`apps/api/src/intake/intake.service.ts` ist der tatsächliche Einstiegspunkt.
Die *Orchestrierung* selbst (welcher Agent als Nächstes läuft) ist
weiterhin dieser hart kodierte if/else-Ablauf — docs/AGENT_STUDIO_CONCEPT.md
Abschnitt 3 (`WorkflowDefinition`) verallgemeinert das erst in einer
späteren Phase. Was seit Phase 20 konfigurierbar ist: jede der drei
Aufrufstellen unten (`classify`/Finance-Agent/Sales-Agent) löst ihren
System-Prompt + erlaubten Tool-Satz über `AgentDefinitionResolverService`
auf (Keys `communication-intake`/`finance-intake`/`sales-intake`) statt
einen Literal-String zu verwenden:

1. Speichert die eingehende Nachricht als `EmailMessage` (`direction:
   INBOUND`), protokolliert `EMAIL_RECEIVED`.
2. Lässt den Communication/Intake-Agent `classify_message` aufrufen
   (eigener `AgentRun`, `agentType: COMMUNICATION`) → `FINANCE`/`SALES`/`OTHER`.
3. Legt bei `FINANCE`/`SALES` einen `Case` an (schließt die in
   `docs/MASTER_SPEC_GAP_ANALYSIS.md` §11 genannte Lücke — **nur für
   diesen Pfad**; die bestehenden direkten Invoice-/Lead-Erstellungsrouten
   bleiben unverändert ohne automatische Case-Anlage, siehe ASSUMPTIONS
   #96) und verknüpft die `EmailMessage` damit.
4. Bei `FINANCE` mit Anhang: lädt die Bytes direkt zu MinIO hoch
   (`StorageService.putObjectBytes()`, server-seitig, kein
   Presigned-URL-Client-Flow — siehe eigener Kommentar dort), berechnet
   den SHA-256-Hash (`Document.checksum`, bisher nie befüllt), legt das
   `Document` an, lässt den Finance-Agent `extract_invoice` und danach
   `create_booking_proposal` aufrufen (zweiter Schritt reagiert auf das
   echte Ergebnis des ersten).
5. Bei `SALES`: lässt den Sales-Agent `create_company` →
   `create_contact` → `create_lead` aufrufen (jeder Schritt reagiert auf
   das reale Ergebnis des vorherigen) — `create_lead` erzeugt wie gehabt
   automatisch eine Folgeaufgabe (Phase 8, unverändert).
6. Persistiert `AgentRun`/`ToolInvocation` für jeden Lauf
   (`AgentRunRecorderService`) und protokolliert `AGENT_RUN_STARTED/
   COMPLETED/FAILED`, `TOOL_INVOKED`, `POLICY_DECISION_MADE`.

## Bewusste Vereinfachungen

- **Kein eigener Orchestrator-Agent-Typ mit eigenem LLM-Aufruf.** §12
  beschreibt den Orchestrator als eigenständigen Agenten ("Case
  erzeugen, zuständigen Agenten bestimmen, Workflow koordinieren"). Diese
  Logik ist in `IntakeService` als normaler, deterministischer
  TypeScript-Code umgesetzt, nicht als weiterer `AgentRuntime.runTurn()`-
  Aufruf — Routing zwischen zwei Agenten braucht hier kein LLM, es folgt
  direkt aus dem `classify_message`-Ergebnis. `AgentType.ORCHESTRATOR`
  existiert im Schema, wird aber aktuell nirgends als `AgentRun.agentType`
  geschrieben.
- **`classify_message` ist eine Stichwort-Heuristik, kein ML-Modell.**
  Bei `LLM_PROVIDER=mock` gibt es ohnehin keine "echte" Klassifikation zu
  simulieren; bei `LLM_PROVIDER=anthropic` würde ein realer LLM-Aufruf
  dieselbe Aufgabe übernehmen können, ohne dass sich am
  Tool-Interface etwas ändert.
- **Kein Trigger außer dem simulierten Endpunkt** — siehe "Status" oben.

## Datenmodell für Agent-Läufe

`AgentRun` und `ToolInvocation` (`packages/domain/prisma/schema.prisma`)
werden seit Phase 18 tatsächlich beschrieben — vorher leer (§10 der
Gap-Analyse), jetzt ein Datensatz pro `AgentRuntime.runTurn()`-Aufruf
bzw. pro darin ausgeführtem/blockiertem Tool-Aufruf.

## Konfigurierbare Agenten & Orchestrierung (seit Phase 20/21)

Zwei zusätzliche, additive Schichten über der oben beschriebenen
Runtime — Details/Design-Herleitung in
[`docs/AGENT_STUDIO_CONCEPT.md`](AGENT_STUDIO_CONCEPT.md):

- **`apps/api/src/agent-definitions/`** — `AgentDefinition`/
  `AgentDefinitionVersion` (Prompt + erlaubte Tool-Namen je Agent,
  versioniert, Rollback-fähig). `AgentDefinitionResolverService.resolve()`
  löst einen `key` (`communication-intake`/`finance-intake`/
  `sales-intake`, oder ein selbst angelegter Agent) zu `{systemPrompt,
  runtime}` auf — `runtime` ist eine frisch konstruierte, auf
  `allowedTools` beschränkte `AgentRuntime`-Instanz (`ToolRegistry.subset()`).
  `IntakeService`s drei Aufrufstellen nutzen das bereits produktiv
  (verhaltenserhaltend gegenüber den vorherigen Literal-Prompts). Admin-UI:
  `/admin/agents` (Bearbeiten, Versionshistorie, neue Agenten anlegen,
  Testlauf gegen `DRAFT`/`ACTIVE`-Definitionen).
- **`apps/api/src/workflows/`** — `WorkflowDefinition`/
  `WorkflowStepDefinition`/`WorkflowRun`/`WorkflowStepRun`: eine lineare
  Schrittfolge von `AgentDefinition`-Referenzen mit optionaler
  Ein-Ebenen-Bedingung (`workflow-path.ts`, eine minimale JSON-Path-artige
  Auflösung wie `$.steps[1].output.classify_message.category`) und
  Werte-Weitergabe zwischen Schritten (`inputMapping`).
  `WorkflowRunnerService.trigger()` läuft komplett **parallel** zu
  `IntakeService` — nichts an `POST /intake/emails` wurde geändert, kein
  automatischer Trigger liest `WorkflowDefinition.triggerType`, jeder
  Lauf startet über den expliziten `POST
  /workflow-definitions/:key/trigger`-Aufruf. Admin-UI: `/admin/workflows`.

Beide Schichten sind über dieselbe `AGENT_MANAGE`-Permission gegated und
lassen die Policy Engine als einzige Ausführungsfreigabe-Instanz
unangetastet — ein Tool, das ein Agent sehen darf, kann trotzdem nur
so autonom laufen, wie `/admin/policies` es erlaubt.

## OpenAI aktivieren (Plattform-Standard der Container)

Der Plattform-Standardprovider wird beim Start aus `LLM_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_MODEL` gebildet
(`AgentModule`, Token `LLM_PROVIDER`) und von `AiProviderResolverService` für jeden Mandanten ohne eigene
BYOK-Verbindung geliefert. Es gibt keinen zweiten Pfad und keine in OpenAI gehosteten Agenten.

- **Wo die Werte stehen:** in der lokalen, gitignorierten Datei `.env.llm.local` im Repo-Root (Muster `.env.*.local`).
  `docker-compose.yml` lädt sie nach `.env` für `api` **und** `worker` (`required: false`). `.env` selbst bleibt auf
  `LLM_PROVIDER=mock`, damit Host-seitige Jest-/E2E-Tests deterministisch den skriptbaren Mock nutzen.
- **Der Schlüssel** gehört ausschließlich dorthin — nicht in den Chat, nicht in `.env.example`, nicht in Quellcode.
- **Übernehmen:** `docker compose up -d --force-recreate api worker` (ein Neubau ist nur nötig, wenn sich Code ändert).
- **Laufzeitnachweis:** `GET /api/v1/ai-providers/status` (Provider, Modell, `executionMode`, Health), `POST /api/v1/ai-providers/verify`
  (echter, minimaler Aufruf) und pro Modellaufruf eine Logzeile `llm.call provider=… model=… executionMode=LIVE ok=… durationMs=…`
  (`LoggingLLMProvider`; protokolliert nie Prompt, Antwort oder Schlüssel). Beim Start steht `llm.provider.selected …` im Log.
- Der Mock ist nur noch aktiv, wenn `LLM_PROVIDER=mock`; die Oberfläche kennzeichnet ihn dann als „Simuliert“.
- **Reasoning-Modelle (gpt-6-luna):** Die Chat-Completions-API lehnt Function-Tools ab, solange das Modell Reasoning nutzt
  („use /v1/responses or set reasoning_effort to 'none'“, live beobachtet). `OPENAI_REASONING_EFFORT=none` setzt das explizit;
  ohne Variable wird nichts gesendet. Folge: für Tool-Aufrufe läuft das Modell ohne Reasoning-Phase. Eine Umstellung des
  Adapters auf die Responses-API wäre die Alternative (offene Entscheidung, siehe IMPLEMENTATION_STATUS). Verbindungen, die
  Mandanten selbst hinterlegen (BYOK, `buildProviderAdapter`), senden bisher keinen `reasoning_effort`.
