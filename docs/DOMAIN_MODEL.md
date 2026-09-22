# Domain Model — Project ORBIT

Diese Datei beschreibt die 25 Prisma-Modelle
(`packages/domain/prisma/schema.prisma`), ihre Beziehungen und die
fachliche Idee dahinter — als Ergänzung zum reinen Schema-Code, nicht als
Ersatz dafür. Für die exakten Feldtypen/Constraints ist das Schema selbst
immer die Quelle der Wahrheit; diese Datei erklärt das *Warum* der
Struktur. Für die Sicherheitsmechanismen rund um Multi-Tenancy siehe
[`docs/SECURITY.md`](SECURITY.md); für den Implementierungsstand siehe
[`docs/IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Grundprinzipien

- **Jede tenant-gebundene Tabelle trägt `tenant_id`** (+ Index, meist
  zusätzlich in einem zusammengesetzten Index mit dem häufigsten
  Filterfeld, z. B. `[tenantId, status]`). Keine Ausnahme außer den drei
  in `docs/SECURITY.md` Abschnitt 1 genannten Tabellen ohne eigene
  Spalte (`role_permissions`, `user_roles`, `refresh_tokens`), die ihren
  Tenant nur indirekt über die Elterntabelle erreichen.
- **Geldbeträge sind immer `Decimal(14,2)`, nie `Float`** — verhindert
  Rundungsfehler in der Finanzbuchhaltung (`amountNet`, `amountGross`,
  `vatAmount`, `BookingProposal.amount`, `Opportunity.value`).
- **`Case` ist der fachübergreifende Anker**: jeder eingehende
  Finance- oder Sales-Vorgang bekommt einen `Case`, an dem sich
  `Task`, `Document`, `EmailMessage`, `Invoice`, `Lead` und `AgentRun`
  optional aufhängen (alle mit `caseId String?` — ein `Case` ist ein
  *Kontext*, keine Voraussetzung; die direkten Fach-Workflows,
  z. B. `POST /invoices` ohne Case, funktionieren unabhängig davon,
  siehe `docs/ASSUMPTIONS.md` #96).
- **`AuditLog` hat bewusst keine Foreign Key auf `User`** — muss
  unabhängig vom Nutzer-Lifecycle lesbar bleiben.

## 1. Tenant, Auth, RBAC

```mermaid
erDiagram
    TENANT ||--o{ USER : "hat"
    TENANT ||--o{ ROLE : "hat"
    TENANT ||--o{ POLICY_CONFIG : "hat"
    TENANT ||--o{ AUDIT_LOG : "hat"
    USER ||--o{ REFRESH_TOKEN : "besitzt"
    USER ||--o{ USER_ROLE : "hat"
    ROLE ||--o{ USER_ROLE : "zugewiesen an"
    ROLE ||--o{ ROLE_PERMISSION : "hat"

    TENANT {
        string id PK
        string slug UK
        TenantStatus status
        datetime deletionRequestedAt "§52 DSGVO-Löschworkflow"
    }
    USER {
        string id PK
        string tenantId FK
        string email UK
        UserStatus status
    }
    ROLE {
        string id PK
        string tenantId FK
        string name
        boolean isSystemDefault
    }
    ROLE_PERMISSION {
        string roleId FK
        string permission
    }
    USER_ROLE {
        string userId FK
        string roleId FK
    }
    REFRESH_TOKEN {
        string userId FK
        string tokenHash UK
        datetime expiresAt
    }
    POLICY_CONFIG {
        string tenantId FK
        string action
        PolicyMode mode
        boolean locked
    }
    AUDIT_LOG {
        string tenantId FK
        string eventType
        ActorType actorType
        string entityType
        string entityId
    }
```

`Role`/`RolePermission`/`UserRole` sind bewusst **tenant-scoped**, nicht
global — jeder Tenant bekommt beim Bootstrap eigene Rollen-Zeilen, aus
`DEFAULT_ROLE_PERMISSIONS` (`@orbit/shared`) geseedet, aber danach pro
Tenant unabhängig anpassbar (§9 des Master-Prompts, "White-Label-fähige
RBAC"). `PolicyConfig` ist die separate Achse für Agent-Autonomie (siehe
`docs/AGENT_ARCHITECTURE.md`) — **nicht** dasselbe wie RBAC, auch wenn
beide "wer darf was" beantworten.

## 2. Cases, Tasks, Dokumente, Kommunikation

```mermaid
erDiagram
    CASE ||--o{ TASK : "hat"
    CASE ||--o{ DOCUMENT : "hat"
    CASE ||--o{ EMAIL_MESSAGE : "hat"
    CASE ||--o{ INVOICE : "hat (Finance)"
    CASE ||--o{ LEAD : "hat (Sales)"
    CASE ||--o{ AGENT_RUN : "hat"
    DOCUMENT ||--o{ INVOICE : "belegt"
    USER ||--o{ CASE : "zugewiesen (optional)"
    USER ||--o{ TASK : "zugewiesen (optional)"

    CASE {
        string id PK
        string tenantId FK
        CaseType type "FINANCE | SALES"
        CaseStatus status
        string assigneeId FK
    }
    TASK {
        string id PK
        string caseId FK
        TaskStatus status
        TaskSource source "USER | AGENT"
    }
    DOCUMENT {
        string id PK
        string caseId FK
        string storageKey
        string checksum
    }
    EMAIL_MESSAGE {
        string id PK
        string caseId FK
        EmailDirection direction
        string classification
    }
```

`Document` trägt nur Metadaten — die Datei selbst liegt in S3/MinIO,
referenziert über `storageKey` (path-traversal-sicher aus UUID +
bereinigtem Dateinamen gebaut). `checksum` (SHA-256) wird nur für
Uploads über den serverseitigen `putObjectBytes()`-Pfad berechnet
(Agent-Intake, Phase 18) — Dokumente über den älteren
Presigned-URL-Client-Upload-Pfad haben aktuell kein `checksum`.

## 3. Finance

```mermaid
erDiagram
    SUPPLIER ||--o{ INVOICE : "liefert"
    INVOICE ||--o{ BOOKING_PROPOSAL : "hat"
    INVOICE ||--o{ FINANCE_TRANSFER : "hat"
    INVOICE ||--o| INVOICE : "Dublette von (self-ref)"
    INVOICE ||--o| DOCUMENT : "belegt durch"

    SUPPLIER {
        string id PK
        string name
        string iban
        SupplierStatus status "PENDING_APPROVAL | ACTIVE | BLOCKED"
        string externalFinanceId
    }
    INVOICE {
        string id PK
        string supplierId FK
        string documentId FK
        string duplicateOfInvoiceId FK
        decimal amountGross
        InvoiceStatus status
        float confidenceScore
        json extractedData
    }
    BOOKING_PROPOSAL {
        string id PK
        string invoiceId FK
        string accountCode
        decimal amount
        BookingProposalStatus status
    }
    FINANCE_TRANSFER {
        string id PK
        string invoiceId FK
        string connector
        FinanceTransferStatus status
    }
```

**Statusfluss `Invoice`**: `RECEIVED → EXTRACTED → (DUPLICATE_SUSPECTED |
PENDING_APPROVAL) → APPROVED → TRANSFERRED` (oder `REJECTED` /
`TRANSFER_FAILED` als Abzweigungen). Die `duplicateOfInvoiceId`-Selbst-
Referenz trägt die Dublettenprüfung — eine als Dublette erkannte Rechnung
zeigt per FK auf das vermutete Original, statt eines separaten
Vergleichs-Datensatzes.

**`Supplier.status` startet immer bei `PENDING_APPROVAL`** (Policy-Action
`supplier.create`, hart mindestens `REQUIRE_APPROVAL` — ein Lieferant,
den der Tenant nie freigegeben hat, darf nie Zahlungen erhalten, §17 des
Master-Prompts).

## 4. Sales / CRM

```mermaid
erDiagram
    COMPANY ||--o{ CONTACT : "beschäftigt"
    COMPANY ||--o{ LEAD : "hat"
    COMPANY ||--o{ OPPORTUNITY : "hat"
    CONTACT ||--o{ LEAD : "ist"
    CONTACT ||--o{ MEETING : "nimmt teil"
    LEAD ||--o{ OPPORTUNITY : "konvertiert zu"
    OPPORTUNITY ||--o{ MEETING : "hat"

    COMPANY {
        string id PK
        string name
        string crmExternalId
    }
    CONTACT {
        string id PK
        string companyId FK
        string email
    }
    LEAD {
        string id PK
        string contactId FK
        string companyId FK
        LeadSource source
        LeadStatus status
    }
    OPPORTUNITY {
        string id PK
        string leadId FK
        string companyId FK
        string contactId FK
        OpportunityStage stage
        decimal value
    }
    MEETING {
        string id PK
        string contactId FK
        string opportunityId FK
        MeetingStatus status
        json proposedSlots
    }
```

Eine `Lead.contactId` ist **Pflicht** (`Contact` muss existieren, bevor
ein Lead angelegt werden kann — `LeadsService.create()` wirft
`NotFoundError`, wenn nicht), `companyId` ist optional (ein Lead kann von
einem Einzelkontakt ohne bekannte Firma stammen). Jede Lead-Erzeugung
erzeugt automatisch eine Folge-`Task` (§7 des Master-Prompts).

## 5. Approvals (generische Freigabe-Warteschlange)

```mermaid
erDiagram
    APPROVAL {
        string id PK
        string tenantId FK
        ApprovalEntityType entityType "INVOICE | SUPPLIER | BOOKING_PROPOSAL | FOLLOW_UP | MEETING"
        string entityId
        string policyAction
        ApprovalStatus status
    }
```

`Approval` hat **keine** eigene Foreign Key auf die jeweilige Entität —
`entityType` + `entityId` sind ein polymorpher Verweis (wie
`AuditLog.entityType`/`entityId`). Entscheidungen (`approve`/`reject`)
passieren immer auf dem Endpunkt der besitzenden Entität
(`PATCH /suppliers/:id/approve`, `PATCH /invoices/:id/approve`), die
intern `ApprovalsService.markDecided()` aufruft — es gibt bewusst keinen
generischen "decide"-Endpunkt hier (siehe Kommentar in
`ApprovalsService`). **Aktuell erzeugen nur `SUPPLIER` und `INVOICE`
tatsächlich Approval-Zeilen** aus echten Service-Aufrufen; `FOLLOW_UP`
kommt vom Agent Runtime (blockierte Tool-Aufrufe, siehe
`docs/AGENT_ARCHITECTURE.md`); `BOOKING_PROPOSAL` und `MEETING` sind im
`ApprovalEntityType`-Enum vorgesehen, aber im Code (noch) nirgends
tatsächlich erzeugt.

## 6. Integrationen, Agent Runtime und Webhooks

```mermaid
erDiagram
    TENANT ||--o{ INTEGRATION : "konfiguriert"
    TENANT ||--o{ WEBHOOK_EVENT : "empfängt (künftig)"
    CASE ||--o{ AGENT_RUN : "hat"
    AGENT_RUN ||--o{ TOOL_INVOCATION : "führt aus"

    INTEGRATION {
        string id PK
        string tenantId FK
        IntegrationConnectorType connectorType
        IntegrationStatus status
        bytes encryptedCredentials "AES-256-GCM, nie über die API lesbar"
        json config
    }
    AGENT_RUN {
        string id PK
        string caseId FK
        AgentType agentType "ORCHESTRATOR | COMMUNICATION | FINANCE | SALES"
        AgentRunTriggerType triggerType
        AgentRunStatus status
        json output
    }
    TOOL_INVOCATION {
        string id PK
        string agentRunId FK
        string toolName
        string policyAction
        PolicyMode policyMode
        ToolInvocationStatus status
    }
    WEBHOOK_EVENT {
        string id PK
        string tenantId FK
        string source "z. B. microsoft, hubspot, twilio"
        string externalEventId "unique mit (tenantId, source)"
        datetime receivedAt
    }
```

`AgentType.ORCHESTRATOR` existiert im Enum, wird aber aktuell nie als
eigener `AgentRun` erzeugt — das Routing zwischen Finance-/Sales-Agent
ist deterministischer Code (`IntakeService`), kein eigener LLM-Lauf
(`docs/ASSUMPTIONS.md` #99). `Integration.encryptedCredentials` wird
seit Phase 19g tatsächlich beschrieben (`IntegrationsModule` +
`CredentialEncryptionService`) — siehe `docs/SECURITY.md` Abschnitt 4.
`WebhookEvent` ist reine Idempotenz-Infrastruktur für einen künftigen
echten Webhook-Empfänger (noch keiner vorhanden, jeder Connector bleibt
ein Mock) — der eindeutige Index auf `(tenantId, source,
externalEventId)` macht Duplikaterkennung atomar auf DB-Ebene.

## Enum-Übersicht

Für alle in den Diagrammen referenzierten Enums (`TenantStatus`,
`UserStatus`, `CaseType`/`CaseStatus`, `TaskStatus`/`TaskSource`,
`InvoiceStatus`, `SupplierStatus`, `BookingProposalStatus`,
`FinanceTransferStatus`, `ApprovalEntityType`/`ApprovalStatus`,
`LeadSource`/`LeadStatus`, `OpportunityStage`, `MeetingStatus`,
`IntegrationConnectorType`/`IntegrationStatus`, `AgentType`,
`AgentRunTriggerType`/`AgentRunStatus`, `ToolInvocationStatus`,
`PolicyMode`, `ActorType`) ist `packages/domain/prisma/schema.prisma`
selbst die vollständige, aktuelle Quelle — sie hier zu duplizieren würde
bei jeder Schema-Änderung sofort veralten. Businessfreundliche
deutsche Labels für die UI-Anzeige jedes Enum-Werts stehen in
`apps/web/src/lib/status-labels.ts`.
