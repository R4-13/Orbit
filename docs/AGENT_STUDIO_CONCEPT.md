# Agent-Konfiguration, Agent Studio & Orchestrierung — Konzept

**Status dieser Datei: Konzept/Design, keine Implementierung.** Der
Nutzer hat explizit nach einem Konzept gefragt, nicht nach Code — nichts
in diesem Dokument ist gebaut. Es beschreibt, wie sich die drei
angeforderten Fähigkeiten sauber auf die bestehende, in
[`docs/AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md) beschriebene
Agent-Runtime aufsetzen lassen, ohne deren bereits bewährte Bausteine
(`LLMProvider`, `ToolRegistry`, `PolicyEngine`, `AgentRuntime`) zu
ersetzen. Referenzierte Datei-/Zeilenangaben beziehen sich auf den
Stand nach Phase 19i.

## Warum diese drei Lücken real sind

Der Auftraggeber hat drei Fähigkeiten benannt, die im ursprünglichen
66-Abschnitte-Master-Prompt nicht vorkamen und die auch nach
vollständiger Umsetzung aller dort spezifizierten Punkte fehlen:

1. **Agenten-Konfiguration** — Fähigkeiten/Prompt/API-Zugriff eines
   Agenten anpassen.
2. **Agent Studio** — neue Agenten definieren.
3. **Orchestrierung** — mehrere Agenten in einem Prozess verketten,
   inkl. Parameterübergabe zwischen ihnen.

Ein Blick auf den aktuellen Code bestätigt: alle drei sind heute
**vollständig statisch, hart im Code verankert**, nicht
Tenant-konfigurierbar:

- **Prompts sind Literal-Strings.** `IntakeService.classify()`
  (`apps/api/src/intake/intake.service.ts:146-148`) enthält den
  System-Prompt des Communication-Agents direkt als String-Literal im
  TypeScript-Code. Dasselbe gilt für die Finance-/Sales-Prompts an den
  jeweiligen Aufrufstellen. Es gibt keine Datenbanktabelle, keinen
  Endpunkt, keine Oberfläche, die diese Prompts zur Laufzeit zeigt oder
  ändert.
- **Jeder Agent sieht jedes Tool.** `AgentModule`
  (`apps/api/src/agent/agent.module.ts:23-35`, eigener Kommentar dort)
  verdrahtet bewusst **eine einzige, gemeinsame `ToolRegistry`** mit
  allen 15 Tools — nicht eine gefilterte Registry pro Agent-Persona.
  Die "Persona" ergibt sich einzig aus dem System-Prompt, nicht aus
  einer echten Fähigkeits-Einschränkung: der Sales-Agent bekommt vom
  LLM technisch dieselben Tool-Definitionen angeboten wie der
  Finance-Agent (inkl. `transfer_invoice_to_fibu`). Das ist heute
  ungefährlich, weil die Policy Engine jeden Tool-Aufruf unabhängig von
  der Persona prüft — aber es ist keine Fähigkeits-**Konfiguration**,
  nur eine zufällige Nicht-Nutzung.
- **Es gibt keine neuen Agenten, nur die vier festen `AgentType`-Werte**
  (`ORCHESTRATOR | COMMUNICATION | FINANCE | SALES`,
  `packages/domain/prisma/schema.prisma:193-198`) — ein geschlossenes
  Enum, kein von Tenants erweiterbares Konzept.
- **Orchestrierung ist deterministischer TypeScript-Code, kein
  Datenmodell.** `IntakeService` (siehe AGENT_ARCHITECTURE.md, Abschnitt
  "Der Orchestrator") entscheidet über if/else-Verzweigung, welcher
  Agent als Nächstes drankommt, und reicht Werte aus dem Ergebnis eines
  Tool-Aufrufs manuell als Literal in den nächsten `messages`-Eintrag
  durch (z. B. Zeile ~304: `Neue Interessenten-E-Mail: ${subject}...`).
  `AgentType.ORCHESTRATOR` existiert im Schema, wird aber nirgends
  tatsächlich als `AgentRun.agentType` geschrieben — der "Orchestrator"
  ist nur ein Name im Enum, kein laufender Code-Pfad.

Diese drei Lücken sind also nicht einfach vergessen — sie sind eine
**bewusste MVP-Vereinfachung**, die für den heutigen, festen
Drei-Agenten-Umfang tragfähig war, aber genau an der Stelle bricht, an
der ein Tenant selbst neue Agenten definieren oder bestehende anpassen
soll.

## Leitprinzip: Erweitern, nicht ersetzen

Alle drei Fähigkeiten lassen sich als **zusätzliche Konfigurationsebene
über** `LLMProvider`/`ToolRegistry`/`AgentRuntime`/`PolicyEngine`
beschreiben, nicht als deren Ersatz:

```
                    ┌─────────────────────────────┐
                    │   NEU: AgentDefinition        │  ← Konfiguration (1)
                    │   (Prompt, Tool-Capability,   │    + Agent Studio (2)
                    │   Trigger-Typen, Version)      │
                    └───────────────┬───────────────┘
                                    │ resolviert zu
                                    ▼
                    ┌─────────────────────────────┐
                    │  AgentRuntime.runTurn()        │  ← UNVERÄNDERT
                    │  (packages/agent-core)         │
                    └───────────────┬───────────────┘
                                    │ prüft jeden Tool-Aufruf über
                                    ▼
                    ┌─────────────────────────────┐
                    │  PolicyEngine                  │  ← UNVERÄNDERT,
                    │  (resolveMode je Tenant+Action)│    bleibt die
                    └─────────────────────────────┘    einzige Ausführungs-
                                                         Instanz (§17)

                    ┌─────────────────────────────┐
                    │   NEU: WorkflowDefinition      │  ← Orchestrierung (3)
                    │   (Schrittfolge von            │
                    │   AgentDefinitions +            │
                    │   Feld-Mapping dazwischen)      │
                    └─────────────────────────────┘
```

Die Policy Engine bleibt **die einzige Instanz, die einen Tool-Aufruf
tatsächlich freigibt** — Agent-Konfiguration und Agent Studio können
einem Agenten nur *anbieten*, welche Tools er sehen darf (Reduktion der
Angriffsfläche), sie können aber nie eine Policy-Sperre umgehen. Ein
selbst definierter Agent, dem man das `transfer_invoice_to_fibu`-Tool
gibt, kann es trotzdem nur mit `REQUIRE_APPROVAL` ausführen (Default),
weil die Policy Engine das unabhängig vom Aufrufer entscheidet — siehe
"Sicherheitsmodell" unten.

---

## 1. Agenten-Konfiguration

### Datenmodell (Vorschlag)

```prisma
enum AgentDefinitionStatus {
  DRAFT      // wird bearbeitet/getestet, läuft in keinem echten Workflow
  ACTIVE     // von WorkflowDefinitions/Intake referenzierbar
  DISABLED   // vorübergehend deaktiviert, Historie bleibt erhalten
}

model AgentDefinition {
  id              String                 @id @default(uuid())
  tenantId        String                 @map("tenant_id")
  key             String                 // stabiler Slug, z. B. "sales-intake"
  name            String                 // Anzeigename, z. B. "Sales Intake Agent"
  description     String?
  baseType        AgentType              @map("base_type") // bestehendes Enum, siehe unten
  systemPrompt    String                 @map("system_prompt")
  allowedTools    String[]               @map("allowed_tools") // Namen aus ToolRegistry
  triggerTypes    AgentRunTriggerType[]  @map("trigger_types")  // bestehendes Enum
  status          AgentDefinitionStatus  @default(DRAFT)
  version         Int                    @default(1)
  createdByUserId String?                @map("created_by_user_id")
  updatedByUserId String?                @map("updated_by_user_id")
  createdAt       DateTime               @default(now()) @map("created_at")
  updatedAt       DateTime               @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, key])
  @@map("agent_definitions")
}

/// Append-only Historie — jede Änderung an Prompt/Tools erzeugt eine neue
/// Zeile, nie ein Update der Vorgänger-Version. Ermöglicht Rollback und
/// eine nachvollziehbare Diff-Ansicht im Studio.
model AgentDefinitionVersion {
  id                String   @id @default(uuid())
  tenantId          String   @map("tenant_id")
  agentDefinitionId String   @map("agent_definition_id")
  version           Int
  systemPrompt      String   @map("system_prompt")
  allowedTools      String[] @map("allowed_tools")
  changeNote        String?  @map("change_note")
  changedByUserId   String?  @map("changed_by_user_id")
  createdAt         DateTime @default(now()) @map("created_at")

  tenant           Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agentDefinition  AgentDefinition  @relation(fields: [agentDefinitionId], references: [id], onDelete: Cascade)

  @@index([agentDefinitionId])
  @@map("agent_definition_versions")
}
```

Begründungen für die wichtigsten Entscheidungen:

- **`allowedTools: String[]` referenziert Tool-**Namen**, nicht
  Policy-Actions.** Ein Tool-Name (`extract_invoice`) ist granularer als
  eine Policy-Action (`invoice.intake`) — mehrere Tools können
  theoretisch dieselbe Action teilen (aktuell nicht der Fall, aber die
  bestehende `ToolDefinition.policyAction`-Zuordnung in
  `packages/agent-core` erlaubt es strukturell). Ein Tool-Name ist damit
  die präzisere, unmissverständlichere Konfigurationseinheit — Policy
  bleibt weiterhin die *Ausführungs*-Freigabe, `allowedTools` nur die
  *Sichtbarkeits*-Einschränkung.
- **`AgentDefinitionVersion` statt In-Place-Update.** Konsistent mit dem
  bereits etablierten Muster für sicherheitsrelevante
  Konfigurationsänderungen (`PolicyConfigService` protokolliert jede
  Änderung als `POLICY_CONFIG_UPDATED`-Audit-Event statt nur den
  aktuellen Wert zu überschreiben, siehe Phase 19h). Ein geänderter
  System-Prompt ist mindestens so sicherheitsrelevant wie eine
  geänderte Policy-Stufe — Rollback-Fähigkeit ("das lief gestern noch
  richtig, was wurde geändert?") ist hier kein Nice-to-have.
- **`baseType: AgentType` bleibt das bestehende, geschlossene Enum** —
  nicht durch ein neues offenes Freitext-Feld ersetzt. Grund: `AgentRun`
  (bereits produktiv, siehe §38/`/activity`) nutzt `agentType` für
  Filterung/Reporting; ein völlig freies neues Enum würde jede
  bestehende Auswertung brechen. Für "echte" neue, fachlich völlig
  andersartige Agenten (nicht nur eine Prompt-Variante eines der drei
  bestehenden) empfiehlt dieses Konzept, `AgentType` um **einen**
  generischen `CUSTOM`-Wert zu erweitern statt beliebig viele neue
  Enum-Werte zu erlauben — die eigentliche Differenzierung passiert über
  `AgentDefinition.key`/`.name`, nicht über das Enum.

### Laufzeit-Anbindung

Heute übersetzt jede Aufrufstelle (`IntakeService`) Prompt + Tool-Auswahl
direkt in Literale. Mit `AgentDefinition` übernimmt das ein neuer,
schlanker Übersetzungsdienst:

```ts
// packages/agent-core/src/tools/tool-registry.ts — neue Methode,
// rein additiv, ändert nichts an der bestehenden Registry-API:
class ToolRegistry {
  subset(toolNames: string[]): ToolRegistry {
    // wirft, wenn toolNames einen unbekannten Namen enthält — Fail-Fast
    // beim Speichern einer AgentDefinition, nicht erst beim Lauf.
  }
}

// apps/api/src/agent/agent-definition-resolver.service.ts — neu:
class AgentDefinitionResolverService {
  async resolve(tenantId: string, key: string): Promise<{
    systemPrompt: string;
    tools: ToolRegistry; // bereits über .subset() gefiltert
  }> {
    const def = await this.agentDefinitions.findActive(tenantId, key);
    return { systemPrompt: def.systemPrompt, tools: this.toolRegistry.subset(def.allowedTools) };
  }
}
```

`AgentRuntime.runTurn()` selbst ändert sich **nicht** — es bekommt
weiterhin eine `ToolRegistry`-Instanz übergeben, nur eben eine gefilterte
statt der bisher immer vollständigen. Das ist exakt die Erweiterung, auf
die der bestehende Code-Kommentar in `agent.module.ts` bereits
hinweist ("per-persona filtering would need its own mechanism this MVP
doesn't need yet").

### API-Oberfläche (Vorschlag)

Analog zum bereits etablierten `/admin/policies`-Muster (Phase 19h):

| Endpunkt | Zweck |
|---|---|
| `GET /agent-definitions` | Liste je Tenant (inkl. `status`, `version`) |
| `GET /agent-definitions/:key` | Detail inkl. aktuellem Prompt/Tools |
| `POST /agent-definitions` | Neu anlegen (`status: DRAFT`) — siehe Agent Studio unten |
| `PATCH /agent-definitions/:key` | Prompt/Tools/Status ändern → erzeugt neue `AgentDefinitionVersion` |
| `GET /agent-definitions/:key/versions` | Historie |
| `POST /agent-definitions/:key/rollback/:version` | Setzt den aktuellen Stand auf eine frühere Version zurück (selbst wieder als neue Version protokolliert, nie ein Hard-Delete der Historie) |
| `GET /tools` | Katalog aller in `ToolRegistry` registrierten Tools (Name, Beschreibung, zugehörige Policy-Action, Input-Schema) — Grundlage für die Tool-Auswahl im Studio |

Gated über eine neue Permission `PERMISSIONS.AGENT_MANAGE` (`'agent.manage'`),
analog zu `POLICY_MANAGE` in der `Administration`-Navigationssektion
platziert (siehe `apps/web/src/app/(app)/layout.tsx:53`).

---

## 2. Agent Studio

Agent Studio ist **kein separates Backend-Modul**, sondern die
Frontend-Oberfläche über genau demselben `AgentDefinition`-CRUD aus
Abschnitt 1 — "neuen Agenten definieren" heißt technisch nichts anderes
als "eine neue `AgentDefinition`-Zeile mit `status: DRAFT` anlegen". Der
einzige echte Zusatzbaustein ist eine **Testlauf-Funktion**, ohne die
ein neu geschriebener Prompt nie vor der Aktivierung geprüft werden
könnte.

### Testlauf (Dry-Run)

Das Projekt hat dieses UX-Muster bereits einmal gebaut und live
verifiziert: die `/inbox`-Seite (Phase 19i) simuliert eine eingehende
E-Mail direkt aus dem UI gegen den echten `POST /intake/emails`-Endpunkt
(siehe [`docs/MASTER_SPEC_GAP_ANALYSIS.md`](MASTER_SPEC_GAP_ANALYSIS.md)
§34) — der Agent-Lauf dahinter ist vollständig echt, nur der Auslöser
ist manuell. Agent Studio verallgemeinert genau dieses Muster auf eine
beliebige, noch nicht aktivierte `AgentDefinition`:

```
POST /agent-definitions/:key/test-run
Body: { "input": { "subject": "...", "bodyText": "..." } }
```

- Läuft **immer** gegen `status: DRAFT`- oder `ACTIVE`-Definitionen,
  erzeugt einen ganz normalen `AgentRun`/`ToolInvocation`-Datensatz
  (keine Sonderbehandlung im Datenmodell — ein Testlauf unterscheidet
  sich von einem echten Lauf nur durch `triggerType: MANUAL` und einen
  Hinweis im Frontend, nicht durch eine eigene Tabelle).
- Respektiert die Policy Engine **unverändert** — ein Testlauf ist kein
  Freifahrtschein, um Policy-Sperren zu umgehen; ein blockierter
  Tool-Aufruf landet auch beim Testen im generischen Approval Center
  (`entityType: 'FOLLOW_UP'`, bestehende Mechanik aus Phase 18/§37) statt
  automatisch "durchgewunken" zu werden. Das ist bewusst so gewählt: ein
  Testlauf soll das reale Verhalten prüfen, nicht ein privilegiertes
  Abweichen davon.
- Zeigt im Frontend denselben Aufbau wie die bereits bestehende
  `/activity`-Detailansicht (Tool-Aufruf-Liste mit Status) — kein neues
  UI-Konzept, nur eine neue Aufrufstelle für vorhandene Komponenten.

### Tool-Auswahl im Studio

Die Oberfläche liest `GET /tools` (siehe oben) und zeigt eine
Checkbox-Liste (Tool-Name, Kurzbeschreibung, zugehörige Policy-Action
inkl. deren aktuellem Modus aus `/admin/policies` als Kontext-Hinweis —
"dieses Tool ist aktuell auf REQUIRE_APPROVAL gestellt"). Das macht die
Konsequenz einer Tool-Auswahl sofort sichtbar, ohne dass ein Autor
zwischen Agent Studio und Policy-Administration hin- und herspringen
muss, um zu verstehen, was ein gewähltes Tool tatsächlich darf.

### Warum kein eigenes "Studio"-Backend-Modul

Ein separates `AgentStudioModule` würde nur denselben
`AgentDefinition`-CRUD duplizieren, den auch die
Konfigurations-Oberfläche aus Abschnitt 1 braucht — beide sind derselbe
Datensatz in unterschiedlichen `status`-Zuständen (`DRAFT` = wird im
Studio entworfen, `ACTIVE` = wird über die Konfigurations-Ansicht
gepflegt). Eine künstliche Modul-Trennung entlang von "neu anlegen" vs.
"bestehendes bearbeiten" hätte keine fachliche Grundlage — es ist
derselbe Lebenszyklus eines einzigen Datensatzes.

---

## 3. Orchestrierung

### Datenmodell (Vorschlag)

```prisma
enum WorkflowDefinitionStatus {
  DRAFT
  ACTIVE
  DISABLED
}

model WorkflowDefinition {
  id          String                    @id @default(uuid())
  tenantId    String                    @map("tenant_id")
  key         String
  name        String
  triggerType AgentRunTriggerType       @map("trigger_type") // bestehendes Enum
  status      WorkflowDefinitionStatus  @default(DRAFT)
  version     Int                       @default(1)
  createdAt   DateTime                  @default(now()) @map("created_at")
  updatedAt   DateTime                  @updatedAt @map("updated_at")

  tenant Tenant                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  steps  WorkflowStepDefinition[]

  @@unique([tenantId, key])
  // Fachliche Invariante (in der Service-Schicht durchgesetzt, nicht per
  // DB-Constraint): höchstens eine ACTIVE WorkflowDefinition pro
  // (tenantId, triggerType) — sonst wäre nicht eindeutig, welcher
  // Workflow bei einer eingehenden E-Mail startet.
  @@map("workflow_definitions")
}

model WorkflowStepDefinition {
  id                   String   @id @default(uuid())
  tenantId             String   @map("tenant_id")
  workflowDefinitionId String   @map("workflow_definition_id")
  order                Int
  agentDefinitionKey   String   @map("agent_definition_key")
  /// JSON-Path-artiges Mapping: Feld im Input dieses Schritts ->
  /// Fundstelle im AgentRun-Output eines vorherigen Schritts.
  /// Beispiel: { "companyName": "$.steps[0].output.company.name" }
  inputMapping         Json?    @map("input_mapping")
  /// Optional: einfache Bedingung gegen den Output des vorherigen
  /// Schritts, z. B. { "field": "$.steps[0].output.category", "equals": "SALES" }.
  /// Fehlt condition, läuft der Schritt immer.
  condition            Json?

  tenant             Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  workflowDefinition WorkflowDefinition @relation(fields: [workflowDefinitionId], references: [id], onDelete: Cascade)

  @@unique([workflowDefinitionId, order])
  @@map("workflow_step_definitions")
}

model WorkflowRun {
  id                   String         @id @default(uuid())
  tenantId             String         @map("tenant_id")
  workflowDefinitionId String         @map("workflow_definition_id")
  caseId               String?        @map("case_id") // dieselbe Verknüpfung wie AgentRun.caseId
  status               AgentRunStatus @default(RUNNING) // bestehendes Enum wiederverwendet
  startedAt            DateTime       @default(now()) @map("started_at")
  completedAt          DateTime?      @map("completed_at")

  tenant   Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  stepRuns WorkflowStepRun[]

  @@map("workflow_runs")
}

/// Verknüpft einen ausgeführten Schritt mit dem AgentRun, den er erzeugt
/// hat — kein Duplikat der AgentRun/ToolInvocation-Daten, nur eine
/// Zuordnungstabelle.
model WorkflowStepRun {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  workflowRunId String   @map("workflow_run_id")
  stepOrder     Int      @map("step_order")
  agentRunId    String   @map("agent_run_id")
  skipped       Boolean  @default(false) // true, wenn `condition` nicht erfüllt war
  createdAt     DateTime @default(now()) @map("created_at")

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  workflowRun WorkflowRun @relation(fields: [workflowRunId], references: [id], onDelete: Cascade)
  agentRun    AgentRun    @relation(fields: [agentRunId], references: [id], onDelete: Cascade)

  @@map("workflow_step_runs")
}
```

Bewusst **kein** generischer Workflow-Engine-Anspruch (keine
Parallel-Zweige, keine Schleifen, keine Wartezustände/Sub-Prozesse) —
das wäre ein eigenständiges, deutlich größeres System (vergleichbar mit
Temporal/Camunda) und stünde im Widerspruch zu §60 der ursprünglichen
Nicht-Ziele dieses MVP (keine Queue-/Worker-Infrastruktur). Eine
**lineare Schrittfolge mit optionaler Ein-Ebenen-Bedingung** deckt exakt
das ab, was `IntakeService` heute bereits tut (klassifizieren →
verzweigen → Fachagent), nur konfigurierbar statt hart kodiert.

### Warum eine Granularität "ein Schritt = ein `AgentRuntime.runTurn()`-Aufruf"

Ein `WorkflowStepDefinition` entspricht **nicht** einem einzelnen
Tool-Aufruf, sondern einem kompletten Agenten-"Turn" — also demselben,
was heute bereits ein `AgentRun` mit potenziell mehreren
`ToolInvocation`-Zeilen abbildet (z. B. erledigt der heutige,
hart-kodierte Finance-Pfad `extract_invoice` **und**
`create_booking_proposal` innerhalb *eines* Agenten-Laufs, weil das LLM
im selben Turn nacheinander beide Tools aufruft). Diese Granularität
1:1 zu übernehmen bedeutet: die Migration des bestehenden
Finance-/Sales-Ablaufs in eine `WorkflowDefinition` verändert nichts an
der bestehenden `AgentRun`/`ToolInvocation`-Struktur, sondern fügt nur
eine neue, darüberliegende `WorkflowRun`/`WorkflowStepRun`-Schicht
hinzu, die referenziert statt dupliziert.

### Parameterübergabe zwischen Agenten

`inputMapping` löst die vom Nutzer explizit genannte Frage ("wie und
welche Parameter ein Agent einem anderen Agenten übergibt"). Konkretes
Beispiel — der heute hart kodierte Sales-Ablauf
(`create_company` → `create_contact` → `create_lead`, jeder Schritt
reagiert auf das reale Ergebnis des vorherigen, siehe
AGENT_ARCHITECTURE.md) als `WorkflowDefinition` mit **drei** Schritten
(heute: ein einziger Agenten-Turn mit drei verketteten Tool-Aufrufen
innerhalb der `MockLLMProvider`-Antwortfunktion — als Workflow explizit
gemacht):

```json
{
  "steps": [
    { "order": 1, "agentDefinitionKey": "sales-create-company",
      "inputMapping": { "companyName": "$.trigger.input.subject" } },
    { "order": 2, "agentDefinitionKey": "sales-create-contact",
      "inputMapping": { "companyId": "$.steps[1].output.create_company.id",
                         "email": "$.trigger.input.fromAddress" } },
    { "order": 3, "agentDefinitionKey": "sales-create-lead",
      "inputMapping": { "contactId": "$.steps[2].output.create_contact.id",
                         "companyId": "$.steps[1].output.create_company.id" } }
  ]
}
```

Ein `WorkflowRunner`-Service (neu, `apps/api/src/workflows/`, analog zu
`IntakeService` aufgebaut) wertet `inputMapping` mit einer **minimalen**
JSON-Path-Untermenge aus (nur `$.trigger.input.*` und
`$.steps[N].output.<toolName>.<feld>` — bewusst kein vollständiger
JSON-Path-Interpreter, um keine neue Abhängigkeit für eine
Mini-Ausdruckssprache einzuführen) und reicht das Ergebnis als
strukturierten Teil des `user`-Message-Inhalts an
`AgentRuntime.runTurn()` des nächsten Schritts weiter — exakt das
Muster, das `IntakeService` heute schon manuell in TypeScript
nachbildet (z. B. `create_booking_proposal` reagiert auf das echte
`invoiceId` aus `extract_invoice`s Ergebnis).

### Migration des bestehenden Intake-Ablaufs

Kein "Big Bang"-Ersatz von `IntakeService`. Vorgeschlagener Weg:

1. `WorkflowRunner` wird **zusätzlich** zu `IntakeService` gebaut, nicht
   anstelle davon.
2. Die drei bestehenden hart-kodierten Abläufe (Communication-Klassifikation,
   Finance-Pfad, Sales-Pfad) werden 1:1 als drei `AgentDefinition`- und
   eine `WorkflowDefinition`-Zeile nachgebildet (Seed-Daten, analog zum
   bestehenden `DEFAULT_POLICY_CONFIG`-Muster) — das Ergebnis muss beim
   Testlauf exakt dieselben `AgentRun`/`ToolInvocation`-Datensätze wie
   der heutige `IntakeService`-Pfad erzeugen, bevor irgendetwas
   umgeschaltet wird.
3. Erst wenn diese Gleichheit über die bestehende E2E-Suite
   (`intake-workflow.e2e-spec.ts`) für beide Implementierungen
   nachgewiesen ist, wird `POST /intake/emails` intern auf
   `WorkflowRunner` umgestellt — `IntakeService` als eigenständige
   Klasse kann danach entfallen, ihr Verhalten lebt als Daten
   (`WorkflowDefinition`) statt als Code weiter.

Dieser stufenweise Weg vermeidet das Risiko, den einzigen heute
produktiv funktionierenden End-to-End-Agentenpfad des gesamten Systems
in einem Schritt gegen einen neuen, noch unbewiesenen generischen
Mechanismus einzutauschen.

---

## Sicherheitsmodell (verbindlich für jede spätere Umsetzung)

1. **Policy Engine bleibt die einzige Ausführungsinstanz.** Weder
   `AgentDefinition.allowedTools` noch `WorkflowStepDefinition` dürfen
   jemals einen eigenen Ausführungspfad bekommen, der an
   `PolicyEnforcementService.resolveMode()` vorbeiführt. Tool-Sichtbarkeit
   (was ein Agent *sehen* darf) und Tool-Ausführung (was tatsächlich
   *passiert*) bleiben zwei getrennte Prüfungen — dieselbe Trennung, die
   heute schon zwischen RBAC (wer darf was in der API) und Policy Engine
   (wie autonom darf ein Agent handeln) besteht, jetzt um eine dritte,
   orthogonale Achse ergänzt (was kann ein Agent überhaupt).
2. **`locked`-Policy-Actions bleiben gesperrt, unabhängig von
   `AgentDefinition`.** Ein selbst gebauter Agent, der
   `transfer_invoice_to_fibu` oder ein hypothetisches
   `payment.execute`-Tool in `allowedTools` bekommt, kann diese
   trotzdem nie über die in `DEFAULT_POLICY_CONFIG` (§17,
   `packages/shared/src/policy.ts`) festgelegte Obergrenze hinaus
   autonom ausführen — Agent Studio erzeugt keine neuen Rechte, nur
   neue *Anfragen*, die genau wie heute vom Approval Center abgefangen
   werden.
3. **`AGENT_MANAGE` ist eine sicherheitsrelevante Berechtigung.** Wer
   einen System-Prompt ändern oder einem Agenten ein neues Tool geben
   kann, beeinflusst mittelbar, welche Tool-Aufrufe überhaupt erst
   *vorgeschlagen* werden — vergleichbare Tragweite wie `POLICY_MANAGE`.
   Empfehlung: dieselbe Rollen-Sensibilität wie `POLICY_MANAGE` (für
   `TENANT_ADMIN` erreichbar, siehe `DEFAULT_ROLE_PERMISSIONS` in
   `packages/shared/src/permissions.ts`), nicht auf `SYSTEM_ADMIN`
   beschränkt wie `TENANT_MANAGE` — Agent-Konfiguration ist eher
   operative Fachkonfiguration als ein DSGVO-Grenzfall.
4. **Prompt-Injection-Reichweite wächst mit der Anzahl der Agenten,
   nicht mit diesem Feature selbst.** Der in
   [`docs/MASTER_SPEC_GAP_ANALYSIS.md`](MASTER_SPEC_GAP_ANALYSIS.md)
   §51 dokumentierte Befund (Nutzerinhalt fließt bereits heute über
   `IntakeService.classify()` in einen `user`-Message-Inhalt) gilt für
   jede neue `AgentDefinition` genauso. Agent Studio sollte beim
   Speichern eines Prompts einen Hinweis zeigen ("dieser Prompt läuft
   gegen potenziell nutzer-kontrollierten Input — Anweisungen im
   E-Mail-Text/Dokument selbst haben keine Autorität über diesen
   System-Prompt"), ersetzt aber keine eigentliche technische Absicherung
   — die bleibt in §51 als offener Punkt verzeichnet.
5. **Testläufe sind keine Ausnahme von alledem** (siehe Abschnitt 2) —
   ein häufiger Fehler in vergleichbaren "Agent Builder"-Produkten ist,
   Testläufe gegen echte Daten mit reduzierten Sicherheitsprüfungen
   laufen zu lassen, "weil es ja nur ein Test ist". Hier ausdrücklich
   ausgeschlossen.

## Offene Fragen für eine spätere Umsetzungsentscheidung

Diese Punkte sind bewusst nicht in diesem Konzept entschieden, weil sie
über eine reine Architektur-Frage hinausgehen und eine Produktentscheidung
brauchen:

- **Wie viele `AgentDefinition`-Zeilen darf ein Tenant anlegen?** Ohne
  ein Limit könnte ein Tenant beliebig viele, nie aktivierte
  `DRAFT`-Agenten anhäufen — vermutlich unproblematisch (nur
  Tabellenzeilen, kein Laufzeit-Overhead), aber eine UI mit
  Pagination/Suche braucht das ab einer gewissen Anzahl.
- **Wer darf `WorkflowDefinition.triggerType: EMAIL` auf `ACTIVE`
  setzen?** Das ersetzt faktisch den produktiven Intake-Pfad für den
  gesamten Tenant — vermutlich eine strengere Freigabe als das bloße
  Anlegen/Testen einer `AgentDefinition` verdient (ggf. eigene
  Bestätigung analog zum Tenant-Löschworkflow aus §52, nicht nur ein
  einfacher Speichern-Klick).
- **Sollen `AgentDefinition`s über Tenants hinweg teilbar sein** (ein
  "Marketplace" vorkonfigurierter Agenten)? Das heutige Datenmodell ist
  strikt pro Tenant (`tenantId` auf jeder Zeile, konsistent mit der
  RLS-Isolation aus §8) — eine Cross-Tenant-Bibliothek wäre ein
  eigenständiges, deutlich späteres Feature mit eigenen
  Sicherheitsfragen (verhindert z. B., dass ein geteilter Prompt
  versehentlich tenant-spezifische Annahmen enthält).
- **Model-/Temperatur-Auswahl pro Agent?** Aktuell ist `LLM_PROVIDER`
  (mock/anthropic) + `ANTHROPIC_MODEL` global pro Deployment, nicht pro
  Agent konfigurierbar. Wäre eine naheliegende vierte Konfigurationsachse
  neben Prompt/Tools/Trigger, aber nicht Teil der vom Nutzer explizit
  genannten Anforderungen — hier nur als Erweiterungspunkt vermerkt,
  nicht ausgearbeitet.
