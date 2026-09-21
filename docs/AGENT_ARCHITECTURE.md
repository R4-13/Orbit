# Agent-Architektur — Project ORBIT

Diese Datei beschreibt `packages/agent-core`: die LLM-/Tool-/Policy-
Infrastruktur für autonome Agenten, und — ebenso wichtig — **wie weit sie
tatsächlich in die laufenden Finance-/Sales-Workflows verdrahtet ist**.
Für RBAC/Auth (die andere, unabhängige Autorisierungsachse) siehe
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

## Ehrlicher Status zuerst

`packages/agent-core` ist eine vollständig gebaute, unit-getestete
Bibliothek (20 Tests, siehe `docs/IMPLEMENTATION_STATUS.md`) — aber es
gibt **kein `AgentModule`** in `apps/api` und **keinen HTTP-Endpunkt**, der
die volle Schleife (LLM → Tool-Aufruf → Policy-Entscheidung → Tool-
Ausführung) tatsächlich laufen lässt. `AgentRuntime`, `ToolRegistry` und
jeder `LLMProvider` (Mock wie `AnthropicLLMProvider`) werden aktuell
**nirgends** aus `apps/api/src` heraus importiert oder instanziiert.

Die einzige Stelle, an der Agent-Core-Code in einem echten Request-Pfad
läuft, ist `packages/agent-core`s reine Entscheidungsfunktion
`decidePolicyAction(mode)` — importiert und aufgerufen von
`apps/api/src/policy/policy-enforcement.service.ts`, das wiederum nur von
`SuppliersService.findOrCreate()` (für die Policy-Action
`SUPPLIER_CREATE`) genutzt wird. Der komplette Finance-Workflow
(Rechnung → Buchungsvorschlag → Freigabe → Transfer) und der Sales-
Workflow (Lead → Termin) laufen als **direkte, RBAC-gated Service-Aufrufe**
— kein Agent, kein LLM, keine Tool Registry beteiligt (siehe
`invoices.service.ts`s eigener Kommentar dazu: Freigabe/Transfer sind
"ein Mensch, der bereits die Berechtigung hat", nicht Agent-Autonomie).

Das ist kein Bug, sondern der aktuelle, bewusste Stand: die Bausteine für
echte agentische Automatisierung existieren und sind einzeln verifiziert,
aber ihre Verdrahtung zu einem laufenden "der Agent liest eingehende
E-Mails und handelt autonom"-Feature (§7 des Master-Spec, `AgentModule`)
ist noch nicht erfolgt. Die folgenden Abschnitte beschreiben die
Bausteine so, wie sie **heute funktionieren würden, wenn sie verdrahtet
wären** — als Grundlage für diese künftige Arbeit.

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
Implementierungen: `MockLLMProvider` (deterministisch, für Tests) und
`AnthropicLLMProvider` (echter `@anthropic-ai/sdk`-Wrapper — ausgewählt
über `LLM_PROVIDER=anthropic`, braucht `ANTHROPIC_API_KEY`; **REQUIRES
PROVIDER CREDENTIALS**, nie live gegen die echte Anthropic-API getestet).

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
JSON-Schema ab, das dem LLM als Tool-Definition angeboten wird — beide
können nie auseinanderlaufen, weil es dieselbe Quelle ist.

`ToolExecutionContext` trägt `tenantId` + `agentRunId` — jedes Tool weiß,
für welchen Tenant und im Rahmen welches `AgentRun`-Datensatzes es läuft.

### Policy Engine (`packages/agent-core/src/policy/`)

Keine Klasse, bewusst eine einzige reine Funktion:

```ts
type PolicyDecision = 'ALLOW' | 'SUGGEST_ONLY' | 'REQUIRE_APPROVAL' | 'DENY';

function decidePolicyAction(mode: PolicyMode): PolicyDecision;
// DISABLED → DENY, SUGGEST_ONLY → SUGGEST_ONLY,
// REQUIRE_APPROVAL → REQUIRE_APPROVAL, AUTONOMOUS → ALLOW
```

`PolicyMode` (`DISABLED|SUGGEST_ONLY|REQUIRE_APPROVAL|AUTONOMOUS`) und die
`POLICY_ACTIONS`-Liste (elf Actions, z. B. `invoice.transfer_to_fibu`,
`supplier.create`, `payment.execute`) leben in
`packages/shared/src/policy.ts` — der "single source of truth", die
sowohl `apps/api` als auch `packages/agent-core` importieren.
`DEFAULT_POLICY_CONFIG` legt pro Action den Werkskonfigurationsmodus fest;
zwei Actions sind `locked` (ein Tenant-Admin kann sie nicht unter
`REQUIRE_APPROVAL` absenken), `payment.execute` ist für den MVP hart auf
`DISABLED` gesetzt (§60 Nicht-Ziele: keine automatische Bankzahlung).

Das eigentliche **Nachschlagen**, welchen Modus ein Tenant für eine Action
konfiguriert hat (`PolicyConfig`-Tabelle), gehört bewusst nicht zu
agent-core — das ist DB-Zugriff und lebt in `apps/api`s
`PolicyEnforcementService.resolveMode()` (Fail-Safe-Default
`REQUIRE_APPROVAL`, falls kein Eintrag existiert). `AgentRuntime` nimmt
diesen Lookup als injizierte `PolicyModeResolver`-Funktion entgegen, statt
selbst zu wissen, wie eine Datenbank aussieht.

### AgentRuntime (`packages/agent-core/src/runtime/`)

```ts
class AgentRuntime {
  constructor(llm: LLMProvider, tools: ToolRegistry, resolvePolicyMode: PolicyModeResolver);
  runTurn(context, input: RunAgentTurnInput): Promise<AgentTurnResult>;
}
```

`runTurn()` orchestriert die Schleife aus dem Grundprinzip (max. 5
Iterationen, konfigurierbar): `llm.complete()` aufrufen, für jeden
zurückgegebenen Tool-Call den Policy-Modus auflösen,
`decidePolicyAction()` anwenden, das Tool **nur bei `ALLOW`** über
`ToolRegistry.execute()` tatsächlich ausführen, und für `SUGGEST_ONLY`/
`REQUIRE_APPROVAL`/`DENY` stattdessen eine entsprechend markierte
Outcome zurückgeben statt das Tool anzufassen. Das Ergebnis
(`AgentTurnResult`) trägt den finalen Text (falls das LLM einen
zurückgab) plus die Liste aller Tool-Call-Outcomes.

## Datenmodell für Agent-Läufe

`AgentRun` (ein Lauf, mit `agentType`, `triggerType`, `status`, `input`/
`output` als JSON) und `ToolInvocation` (jeder einzelne Tool-Aufruf
innerhalb eines Laufs, inkl. der getroffenen Policy-Entscheidung) sind
bereits als Prisma-Modelle vorhanden (`packages/domain/prisma/schema.prisma`)
— aber da kein Code sie aktuell beschreibt (kein `AgentModule`), sind
beide Tabellen in der Praxis leer. Sie sind für genau den Moment
vorbereitet, in dem `AgentRuntime` tatsächlich verdrahtet wird.

## Nächste Schritte für eine echte Verdrahtung

Nicht in dieser Phase umgesetzt, aber die logische Fortsetzung:

1. Ein `AgentModule` in `apps/api`, das `AgentRuntime` mit einem echten
   `LLMProvider` (per `LLM_PROVIDER`-Env-Var), einer `ToolRegistry` voller
   konkreter Tools (je eins pro `POLICY_ACTIONS`-Eintrag, aufrufend in die
   bestehenden Services wie `InvoicesService`/`LeadsService`) und einem
   `PolicyModeResolver` (der bereits existierenden
   `PolicyEnforcementService.resolveMode()`-Logik) zusammensetzt.
2. Ein Trigger — z. B. ein Mail-Connector-Webhook oder ein BullMQ-Job im
   Worker-Prozess (`apps/api/worker`, aktuell noch ohne Queue-Consumer) —,
   der `AgentRuntime.runTurn()` tatsächlich aufruft.
3. `AgentRun`/`ToolInvocation`-Persistenz an den entsprechenden Stellen in
   `AgentRuntime` bzw. dem neuen `AgentModule` ergänzen.
