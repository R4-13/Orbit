# ORBIT MASTER SPECIFICATION
## Complete Product, Architecture and Development Specification for Claude Code

**Version:** 1.0  
**Status:** Authoritative Development Specification  
**Date:** 2026-09-27  
**Internal Project Codename:** ORBIT  
**Important:** ORBIT is a temporary internal project name only. It is not a final company or product name.  
**Copilot Working Title:** Sonde  
**Important:** Sonde is also a temporary working title only.

---

# 0. Authority of this document

This file is the **single source of truth** for further development of Project ORBIT.

It consolidates and supersedes development guidance previously contained in separate documents such as:

- the original Master Development Prompt,
- Product / Business Context,
- `SONDE_COPILOT_CONCEPT.md`,
- `Orbit_Feedback_concept.md`,
- `ORBIT_Unified_Evolution_Concept.md`,
- earlier partial architecture and implementation notes.

If an older concept, prompt or note conflicts with this document, **this document takes precedence**.

Older files may remain for historical reference only.

---

# 1. Role of Claude Code

Claude Code shall act as an experienced autonomous software engineering team, covering:

- Principal Software Architect
- Senior Backend Engineer
- Senior Frontend Engineer
- AI / Agentic Systems Engineer
- Integration Architect
- DevOps Engineer
- Security Engineer
- QA / Test Engineer
- UX Engineer
- Technical Writer

Claude Code must not merely propose code. It must inspect the repository, compare the implementation against this specification, create a gap analysis and implementation plan, implement missing functionality, run migrations, linting, type checking, unit tests, integration tests, E2E tests and production builds, fix reproducible regressions, and document actual status honestly.

The objective is a **coherent, testable, extensible, secure and demonstrable B2B SaaS platform**, not a collection of disconnected demos.

---

# 2. Product vision

Project ORBIT is intended to become a cloud-based AI automation platform for small and medium-sized companies.

The product exists to reduce the amount of human labour required for repetitive administrative work.

The fundamental product principle is:

> **The product does not primarily answer questions. It performs administrative work.**

The platform should:

```text
detect business events
↓
understand the event
↓
classify the event
↓
determine the required business process
↓
execute routine steps
↓
request human input only when required
↓
interact with existing business systems
↓
document every material action
```

---

# 3. Target customer and value proposition

Initial target: German and European SMEs, with a working focus on companies of roughly 20–250 employees.

Typical characteristics:

- limited internal IT capacity,
- significant administrative workload,
- finance/accounting staff,
- sales staff,
- Microsoft 365 or Google Workspace,
- DATEV, Lexware Office or another finance/accounting system,
- CRM software or basic sales processes,
- recurring email- and document-driven workflows.

Value is created through:

- capacity gain,
- avoided hiring,
- possible direct administrative cost reduction,
- faster processing,
- fewer manual transfer errors,
- transparency and auditability.

ORBIT should become:

> **An AI operating layer for administrative business processes.**

Existing systems remain Systems of Record.

Examples:

```text
DATEV = accounting system of record
HubSpot = CRM system of record
Microsoft 365 / Google Workspace = mail/calendar system of record
ORBIT = system of intelligence + orchestration
```

ORBIT is not intended to become a full ERP, accounting system, CRM, email platform or generic chatbot.

---

# 4. Core MVP domains

Primary business domains:

```text
Finance / Accounts Payable
Sales Administration
```

Supporting channels:

```text
Email
Calendar
Telephone
Documents
CRM
Finance / Accounting Systems
```

## 4.1 Finance workflow

```text
Invoice arrives
↓
ORBIT detects invoice
↓
document is stored
↓
invoice data is extracted
↓
supplier is identified
↓
duplicate check
↓
bank-account-change detection
↓
basic accounting validation
↓
booking proposal
↓
policy evaluation
↓
human approval if required
↓
transfer to accounting system
↓
audit trail
↓
workflow completed
```

Extract at least:

```text
supplierName
supplierAddress
supplierVATId
invoiceNumber
invoiceDate
customerName
netAmount
taxAmount
grossAmount
currency
iban
dueDate
paymentTerms
lineItems
```

Validation should include supplier matching, duplicate detection, document hash, mathematical consistency, VAT plausibility, changed-bank-account detection and historical accounting-assignment suggestions.

Default autonomy:

| Action | Default |
|---|---|
| Classify invoice | AUTONOMOUS |
| Extract invoice | AUTONOMOUS |
| Match supplier | AUTONOMOUS |
| Duplicate check | AUTONOMOUS |
| Create booking proposal | AUTONOMOUS |
| Transfer invoice to accounting | REQUIRE_APPROVAL |
| New supplier creation | REQUIRE_APPROVAL |
| Supplier bank-account change | REQUIRE_APPROVAL |
| Payment execution | DISABLED |

No autonomous bank payment is part of the MVP.

## 4.2 Sales workflow

```text
Prospect email or call
↓
ORBIT understands request
↓
contact identified
↓
company identified
↓
CRM checked
↓
lead created
↓
task created
↓
meeting proposed / scheduled
↓
follow-up prepared
↓
CRM updated
↓
audit trail
↓
workflow completed
```

The objective is to remove administrative work from sales, not to replace human selling.

---

# 5. Current implementation to preserve

Claude Code must verify the repository, but the current implementation reportedly includes:

- pooled multi-tenant architecture,
- `tenant_id`,
- Postgres RLS on most business tables,
- application-layer tenant filtering,
- Prisma data model,
- JWT authentication,
- six roles and granular permissions,
- `/api/v1` and OpenAPI,
- Next.js frontend,
- browser-tested Finance workflow,
- browser-tested Sales workflow,
- Finance/Mail/Calendar/CRM/Telephony connector interfaces with mocks,
- AES-256-GCM credential encryption,
- webhook idempotency,
- Redis rate limiting,
- data export/user deactivation/two-step tenant deletion,
- configurable autonomy policies,
- Dashboard, Finance, Sales, Approval Center, Cases, Activity, Inbox, Integrations and Admin pages,
- Docker Compose,
- BullMQ/Redis worker separation,
- health checks,
- OpenTelemetry/Jaeger,
- CI,
- demo data,
- AgentRuntime,
- Tool Registry,
- Agent Studio,
- multi-step asynchronous agent workflows.

Do not rebuild working components unnecessarily.

---

# 6. Technical stack

Frontend:

```text
Next.js
React
TypeScript
Tailwind CSS
shadcn/ui or equivalent
```

Backend:

```text
Node.js
TypeScript
NestJS
Prisma
PostgreSQL
```

Async / caching:

```text
Redis
BullMQ
```

Storage:

```text
S3-compatible object storage
MinIO locally
```

Monorepo:

```text
pnpm workspaces
```

Preferred architecture: **modular monolith plus worker processes**. Avoid a microservice zoo.

Preferred repository structure:

```text
/apps
  /web
  /api
  /worker

/packages
  /domain
  /agent-core
  /integration-core
  /workflow-core
  /shared
  /config
  /ui
  /testing

/docs
/infra
/scripts
```

---

# 7. Core backend modules

The platform should contain or evolve toward:

```text
AuthModule
TenantModule
UserModule
CaseModule
TaskModule
DocumentModule
CommunicationModule
FinanceModule
SalesModule
ApprovalModule
PolicyModule
AgentModule
WorkflowModule
IntegrationModule
NotificationModule
AuditModule
MetricsModule
AdminModule
CopilotModule
ConversationModule
ContextModule
AIProviderModule
```

---

# 8. Multi-tenancy, roles and permissions

Every relevant business object must belong to a tenant.

Every relevant table should include:

```text
tenantId
```

Tenant isolation must be enforced by:

1. application logic,
2. PostgreSQL RLS where technically practical.

No endpoint, job, agent, workflow, query or context provider may bypass tenant isolation.

Recommended roles:

```text
TENANT_ADMIN
FINANCE_USER
SALES_USER
APPROVER
VIEWER
SYSTEM_ADMIN
```

Example permissions:

```text
invoice.read
invoice.approve
booking.create
crm.contact.read
crm.contact.create
crm.lead.create
email.send
calendar.create
integration.configure
ai.provider.configure
agent.configure
workflow.retry
```

Permissions must be enforced in application code, never by the LLM.

---

# 9. Core data model

At minimum support:

## Organisation
`Tenant`, `User`, `Role`, `Permission`

## Communication
`Conversation`, `Message`, `EmailMessage`, `Call`, `CallTranscript`, `Attachment`

## Documents
`Document`, `DocumentVersion`, `DocumentExtraction`

## Finance
`Supplier`, `Customer`, `Invoice`, `InvoiceLine`, `BookingProposal`, `OpenItem`, `PaymentReference`, `FinanceTransaction`

## Sales
`Company`, `Contact`, `Lead`, `Opportunity`, `Activity`, `Meeting`, `FollowUp`

## Workflow
`Case`, `Task`, `Approval`, `PolicyDecision`, `WorkflowDefinition`, `WorkflowRun`, `WorkflowStepRun`, `WorkflowEvent`

## AI / Agent
`AgentDefinition`, `AgentDefinitionVersion`, `AgentRun`, `AgentStep`, `ToolInvocation`, `LLMInteraction`, `ConfidenceScore`

## Integration
`Integration`, `IntegrationCredential`, `IntegrationEvent`, `WebhookEvent`, `ConnectorSync`

## Copilot
`Conversation`, `ConversationMessage`, `ConversationSummary`, `ConversationContext`, `ConversationAction`, `ConversationReference`

## AI Provider
`AIProviderConnection`, `AIModelProfile`, `AITenantPolicy`, `AIUsageRecord`, `AIProviderHealth`

## Audit
`AuditEvent`

Use UUIDs.

A `Case` is the user-facing business container and can link source communication, documents, tasks, approvals, workflows, agents, external references and audit events.

---

# 10. Highest-priority improvement: durable workflow orchestration

Every long-running business workflow must be durable and resumable.

A workflow must survive:

```text
API restart
worker restart
deployment
browser closure
user logout
delayed approval
connector outage
LLM outage
queue retry
```

No workflow may depend on:

- active browser state,
- active HTTP requests,
- in-memory process state,
- an active LLM conversation.

Recommended workflow states:

```text
RECEIVED
CLASSIFIED
READY
RUNNING
WAITING_FOR_APPROVAL
WAITING_FOR_EXTERNAL_SYSTEM
RETRY_PENDING
MANUAL_REVIEW
COMPLETED
FAILED
REJECTED
CANCELLED
```

Persist at least:

```text
workflowRunId
tenantId
workflowDefinitionKey
workflowDefinitionVersion
caseId
currentState
currentStep
input
completedSteps
pendingStep
stepOutputs
approvalReferences
externalReferences
retryCount
nextRetryAt
failureCode
failureDetail
correlationId
startedAt
updatedAt
completedAt
```

---

# 11. Approval resume and idempotency

Correct approval behaviour:

```text
Workflow
↓
Policy = REQUIRE_APPROVAL
↓
Approval created
↓
Workflow = WAITING_FOR_APPROVAL
↓
execution stops safely
```

Later:

```text
APPROVAL_GRANTED
↓
Workflow Engine loads workflow
↓
validates state
↓
restores context
↓
continues next valid step
```

The user must not manually restart the process.

Every external side-effect step must be idempotent.

Use where applicable:

```text
workflowRunId
workflowStepRunId
idempotencyKey
externalReferenceId
providerRequestId
correlationId
```

Retries must not create duplicate leads, invoices, meetings, emails or accounting transfers.

---

# 12. Orchestration philosophy

Do not build a free-running super-agent that owns business workflow state.

Preferred:

```text
Deterministic workflow orchestration
+
LLM intelligence where interpretation is needed
```

Use AI for:

```text
classification
extraction
summarisation
drafting
recommendations
ambiguous intent
semantic matching
```

Use deterministic code for:

```text
workflow state
permissions
approvals
tenant boundaries
financial safety
retries
completion criteria
idempotency
external execution
```

Separation of responsibilities:

```text
Workflow Engine = durable business state
Agent Runtime = AI interpretation/tool loop
Policy Engine = autonomy/approval
Approval Engine = human decisions
Tool Gateway = validated execution
Connector = external-system communication
LLM = intelligence, not authoritative process state
```

---

# 13. Agent Runtime, Tool Registry and Tool Gateway

The Agent Runtime should:

```text
build agent context
invoke LLM
receive structured output/tool request
validate tool request
route through Tool Registry
record AgentRun
record ToolInvocation
return structured result
```

Every tool must have:

```text
unique key
typed input schema
typed output schema
policy action
permission requirements
implementation
audit metadata
```

Execution path:

```text
Agent / Copilot
↓
Tool Request
↓
Schema Validation
↓
Permission Check
↓
Policy Engine
↓
Approval if needed
↓
Tool Gateway
↓
Domain Service / Connector
```

High-level agents and Sonde should prefer domain-level capabilities:

```text
start_invoice_processing_workflow
start_sales_lead_workflow
start_follow_up_workflow
```

instead of manually chaining every low-level tool.



# 14. Policy Engine and Approval Engine

Supported policy modes:

```text
DISABLED
SUGGEST_ONLY
REQUIRE_APPROVAL
AUTONOMOUS
```

Policies are tenant-configurable.

Critical platform safety ceilings remain immutable.

Examples:

```text
payment.execute = DISABLED in MVP
supplier.bank_change = REQUIRE_APPROVAL
```

Approval records should include:

```text
tenant
business object
requested action
requesting workflow
requesting agent
reason
risk
policy decision
status
createdAt
resolvedAt
resolvedBy
```

Statuses:

```text
PENDING
APPROVED
REJECTED
EDITED_AND_APPROVED
CANCELLED
```

Approval decisions must emit workflow events.

---

# 15. Agent Studio and governance

Agent Studio remains an advanced capability for:

```text
ORBIT Product Team
Implementation Partner
Advanced Tenant Admin
```

Normal business users should not need to configure prompts or tools.

Agent lifecycle:

```text
DRAFT
VALIDATING
TESTING
STAGED
PUBLISHED
SUSPENDED
DEPRECATED
ARCHIVED
```

Only `PUBLISHED` versions may run in production business workflows.

Persist per agent version:

```text
agentKey
version
prompt
allowedTools
modelProfile
model settings where applicable
createdBy
createdAt
publishedBy
publishedAt
status
changeDescription
```

Published versions are immutable. Changes create a new version.

---

# 16. Prompt architecture and prompt injection defence

All agents and Sonde must use a common layered prompt architecture:

```text
1. Immutable Platform Instructions
2. Immutable Security Instructions
3. Product Agent Definition
4. Tenant Configuration
5. User / Service Identity + Permissions
6. Trusted Business Context
7. Untrusted External Content
8. Current Task / User Request
```

Tenant admins may never overwrite layers 1 or 2.

All content from:

```text
emails
PDFs
CRM notes
call transcripts
uploaded documents
webhook text
```

is untrusted.

External content must never alter:

- system rules,
- permissions,
- policy,
- allowed tools,
- provider configuration,
- tenant boundaries.

Critical business rules must not exist only in prompts.

The following must live in deterministic application code:

```text
payment restrictions
bank-change approval
tenant isolation
permissions
duplicate detection
workflow state transitions
approval requirements
critical finance limits
```

---

# 17. Agent evaluation framework

Expand the existing Agent Studio test-run capability into formal evaluation.

Each evaluation case may define:

```text
input
trusted context
untrusted content
expected intent
expected schema
expected tool category
allowed tools
forbidden tools
expected approval
expected workflow outcome
```

Create regression suites for:

```text
invoice classification
invoice extraction
supplier matching
duplicate detection
bank-change detection
sales intent
lead creation
follow-up drafting
tool selection
permission boundaries
prompt-injection resistance
```

Critical tests must pass before publishing a new agent version.

---

# 18. LLM provider strategy

ORBIT must technically support multiple LLM providers while keeping the customer experience simple.

Recommended commercial and technical model:

## 18.1 ORBIT-Managed AI — default

```text
Customer subscribes to ORBIT
↓
ORBIT manages provider account(s)
↓
ORBIT maps use cases to validated model profiles
↓
customer needs no API key
```

This is the default for normal SME customers.

Benefits:

- simple onboarding,
- centrally tested models,
- central support,
- consistent quality,
- controlled security,
- predictable behaviour,
- easier commercial pricing and metering.

## 18.2 Customer-Managed AI / BYOK — optional

Advanced / enterprise tenants may optionally provide their own approved provider credentials.

Use cases:

- enterprise provider agreement,
- internal compliance,
- procurement requirements,
- direct provider billing,
- internal cloud strategy,
- provider preference.

BYOK is optional, never mandatory for ordinary customers.

---

# 19. Vetted provider catalogue

Do not initially allow:

```text
arbitrary provider
arbitrary HTTP endpoint
arbitrary base URL
arbitrary model name
```

Initial approved providers:

```text
Anthropic
OpenAI
```

Potential later adapters:

```text
Google Gemini
Azure OpenAI
Amazon Bedrock
Google Vertex AI
Mistral
approved EU / sovereign providers
```

Every provider requires a tested adapter.

---

# 20. LLM provider abstraction

The provider layer should support an interface conceptually equivalent to:

```typescript
interface LLMProvider {
  providerKey(): string;

  validateConfiguration(
    config: ProviderConnectionConfig
  ): Promise<ProviderValidationResult>;

  listSupportedModels(
    config?: ProviderConnectionConfig
  ): Promise<SupportedModel[]>;

  complete(request: LLMRequest): Promise<LLMResponse>;

  stream(request: LLMRequest): AsyncIterable<LLMStreamEvent>;

  healthCheck(): Promise<ProviderHealthResult>;

  estimateCapabilities(model: string): ModelCapabilities;
}
```

Business code must not directly import Anthropic, OpenAI or future provider SDKs.

Provider adapters:

```text
MockLLMProvider
AnthropicLLMProvider
OpenAILLMProvider
GoogleGeminiLLMProvider      later
AzureOpenAILLMProvider       later
BedrockLLMProvider           later
```

---

# 21. Provider credentials and data model

Do not model credentials as one universal `apiKey` string.

Support:

```text
API_KEY
SERVICE_ACCOUNT
OAUTH
CLOUD_IAM
MANAGED_PLATFORM
```

Recommended entities:

```text
AIProviderConnection
AIModelProfile
AITenantPolicy
AIUsageRecord
AIProviderHealth
```

Suggested `AIProviderConnection`:

```text
id
tenantId?
providerKey
connectionMode
credentialType
secretReference
status
lastValidatedAt
lastValidationResult
createdBy
createdAt
updatedAt
```

Connection modes:

```text
PLATFORM_MANAGED
TENANT_MANAGED
```

Credentials must:

- never be returned to the browser after save,
- never be stored plaintext,
- never appear in logs,
- never appear in AgentRun payloads,
- never be sent to the LLM.

Preferred production pattern:

```text
database stores secret reference
↓
Secret Manager / Vault stores secret
```

Existing encrypted credential storage may remain for MVP if secure, but the architecture must permit migration to a secret manager.

---

# 22. AI administration UI

Create an administration area such as:

```text
Administration
→ AI & Models
```

Possible route:

```text
/admin/ai-providers
```

Standard customer view:

```text
AI Mode

● ORBIT Managed AI
○ Customer Managed AI
```

If ORBIT Managed AI:

```text
Status: Active
No API key required
```

If Customer Managed AI:

```text
Provider
Credential Type
Credential Input
Test Connection
Connection Status
Approved Model Profile
```

Never display the full saved credential after save.

Platform admins may receive a deeper route such as:

```text
/admin/platform/ai
```

with:

```text
supported providers
platform provider connections
validated models
model profiles
provider health
usage
cost
tenant overrides
fallback policy
model deprecation
```

---

# 23. Model profiles and provider routing

Do not hard-code model names in business logic.

Use logical model profiles:

```text
COPILOT_INTERACTIVE
FAST_CLASSIFICATION
DOCUMENT_EXTRACTION
COMPLEX_REASONING
BUSINESS_DRAFTING
AGENT_TOOL_USE
```

Map:

```text
profile
→ provider
→ approved model
→ parameters
```

ORBIT Product Team controls:

```text
supported provider adapters
approved models
capability mapping
default profiles
security requirements
deprecation handling
```

Tenant Admin may control, if enabled:

```text
ORBIT Managed vs BYOK
approved provider
credential
approved model profile
budget threshold
```

Normal users do not select providers.

---

# 24. Provider fallback and usage metering

Support explicit fallback policies:

```text
NO_FALLBACK
SAME_PROVIDER_FALLBACK
APPROVED_CROSS_PROVIDER_FALLBACK
```

For BYOK, default:

```text
NO_FALLBACK
```

Do not silently send customer data to another provider.

Track:

```text
tenantId
provider
modelProfile
modelId
agentKey
workflowKey
conversationId?
input tokens/units
output tokens/units
request count
latency
estimated cost
timestamp
```

Support tenant-aware limits:

```text
monthly AI usage limit
warning threshold
max concurrent agent runs
max concurrent copilot runs
max message size
max context size
```

---

# 25. Sonde — application-wide copilot

Sonde is the application-wide conversational interface to ORBIT.

Sonde is not a second agent platform.

It must reuse:

```text
Agent Runtime
Tool Registry
Policy Engine
Approval Engine
Workflow Engine
Connector Layer
Audit
Observability
LLM Provider Layer
```

Principle:

> **Sonde talks to the user. ORBIT does the work.**

Sonde should understand:

- authenticated user,
- tenant,
- permissions,
- current page,
- selected object,
- case/workflow context,
- available actions,
- relevant business context.

Sonde may:

```text
explain
search
summarise
analyse
navigate
recommend
prepare
initiate actions
execute permitted simple actions
delegate complex work to workflows
monitor workflow progress
```

---

# 26. Sonde modes

## ASK

Read-only.

Examples:

```text
Was braucht heute meine Aufmerksamkeit?
Warum wurde diese Rechnung gestoppt?
Welche Rechnungen warten auf meine Freigabe?
Fasse die Kommunikation mit Muster GmbH zusammen.
```

## PREPARE

Creates a proposal.

Examples:

```text
Schreib eine Antwort an diesen Kunden.
Bereite ein Follow-up vor.
Erstelle einen Terminvorschlag.
Erstelle einen Buchungsvorschlag.
```

## ACT

Executes a controlled permitted action.

Examples:

```text
Erstelle daraus einen Lead.
Lege eine Aufgabe für morgen an.
Vereinbare den Termin am Donnerstag.
```

## DELEGATE

Starts a durable domain workflow.

Examples:

```text
Verarbeite diese Rechnung.
Bearbeite diese fünf Rechnungen.
Starte den Sales-Follow-up-Prozess.
```

## NAVIGATE

Finds and opens relevant ORBIT objects.

---

# 27. Sonde example

User is on:

```text
Invoice RE-2026-4711
Supplier Müller GmbH
Amount €8,419.20
Status Approval Required
```

User:

> Warum wurde diese Rechnung gestoppt?

Sonde may respond with a factual operational explanation based on structured data.

User:

> Genehmige die Rechnung.

The action must still pass:

```text
RBAC
↓
Policy Engine
↓
Approval Rules
↓
Workflow Engine
```

Sonde cannot bypass those layers.

---

# 28. Sonde UI

Desktop:

```text
Application                          Sonde
────────────────────┬─────────────────────────
                    │
Current Screen      │ Conversation
                    │
Business Object     │ User / Assistant
                    │ Action Cards
                    │ Status
                    │ Input
────────────────────┴─────────────────────────
```

Use a collapsible right-side panel.

Recommended:

```text
collapsed: icon
normal: ~400–480 px
expanded: up to ~40% width
```

Mobile:

```text
floating Sonde button
↓
bottom sheet
↓
full-screen conversation
```

---

# 29. Sonde backend and conversation model

Use:

```text
CopilotModule
ConversationModule
ContextModule
```

Do not duplicate AgentModule.

Conversation entities:

```text
Conversation
ConversationMessage
ConversationSummary
ConversationContext
ConversationAction
ConversationReference
```

Suggested `Conversation`:

```text
id
tenantId
userId
title
status
createdAt
updatedAt
lastMessageAt
```

Suggested `ConversationMessage`:

```text
id
conversationId
tenantId
userId
role
content
status
agentRunId?
createdAt
```

Roles:

```text
USER
ASSISTANT
SYSTEM_EVENT
```

Do not store hidden chain-of-thought.

---

# 30. Sonde context

Support:

```text
route
pageType
entityType
entityId
caseId
workflowRunId
selectedObjects
timestamp
```

Browser-provided context must be validated server-side.

Implement context providers:

```text
InvoiceContextProvider
SupplierContextProvider
LeadContextProvider
OpportunityContextProvider
CaseContextProvider
TaskContextProvider
ApprovalContextProvider
DashboardContextProvider
```

Interface:

```typescript
interface CopilotContextProvider {
  supports(context): boolean;
  load(context, user): Promise<SafeCopilotContext>;
}
```

Operational facts must come from structured, permission-aware services.

Vector search must not be the source of truth for:

```text
invoice amount
approval status
supplier bank account
lead status
opportunity value
workflow state
```

---

# 31. Sonde memory

Use:

```text
recent messages
+
conversation summary
+
relevant application context
```

Do not send unlimited history.

MVP memory remains conversation-scoped.

No hidden permanent psychological user profile.

---

# 32. Sonde tool access and capabilities

Available Sonde capabilities are the intersection of:

```text
Sonde allowed capabilities
∩
AgentDefinition
∩
Tenant-enabled capabilities
∩
User permissions
∩
Current context
∩
Policy Engine
```

Capability categories:

## READ

```text
get_invoice
get_supplier
get_case
get_tasks
list_open_approvals
search_contacts
get_dashboard_summary
```

## PREPARE

```text
draft_email
prepare_follow_up
prepare_meeting
prepare_booking_proposal
```

## ACT

```text
create_task
create_contact
create_lead
create_meeting
send_email
```

## DELEGATE

```text
start_invoice_processing_workflow
start_sales_lead_workflow
start_follow_up_workflow
```

## NAVIGATE

```text
open_invoice
open_lead
open_case
open_approval
```

Sonde must not manually reimplement domain workflows where a durable domain workflow exists.

---

# 33. Sonde action cards, streaming and API

Use structured action cards rather than text-only execution prompts.

Example:

```text
Termin erstellen

Müller GmbH
25. September, 14:00
30 Minuten
Teams Meeting

[Bestätigen] [Bearbeiten]
```

Extend LLM runtime for streaming.

Prefer SSE events such as:

```text
message.delta
tool.started
tool.completed
workflow.started
workflow.updated
approval.required
message.completed
error
```

Recommended API:

```text
POST   /api/v1/copilot/conversations
GET    /api/v1/copilot/conversations
GET    /api/v1/copilot/conversations/:id
GET    /api/v1/copilot/conversations/:id/messages
POST   /api/v1/copilot/conversations/:id/messages
DELETE /api/v1/copilot/conversations/:id
GET    /api/v1/copilot/capabilities
```

Streaming:

```text
POST /api/v1/copilot/conversations/:id/messages/stream
```

or an equivalent clean SSE design.

Long-running workflow execution must continue asynchronously after the conversational request returns.



# 34. Document processing

Use:

```text
DocumentExtractionService
OCRProvider
```

Responsibilities:

- store original document,
- calculate hash,
- identify file type,
- extract text,
- OCR scanned documents where required,
- persist structured extraction,
- support duplicate detection.

---

# 35. Email connector

Interface:

```typescript
interface MailConnector {
  testConnection();
  listMessages();
  getMessage();
  getAttachments();
  sendMessage();
  replyMessage();
  registerWebhook();
  processWebhook();
}
```

Implement or preserve:

```text
MockMailConnector
MicrosoftGraphMailConnector
GmailConnector
```

Prefer event-driven intake instead of aggressive polling.

---

# 36. Calendar connector

```typescript
interface CalendarConnector {
  testConnection();
  getAvailability();
  listEvents();
  createMeeting();
  updateMeeting();
  cancelMeeting();
}
```

Implement or preserve:

```text
MockCalendarConnector
MicrosoftGraphCalendarConnector
GoogleCalendarConnector
```

---

# 37. CRM connector

```typescript
interface CRMConnector {
  testConnection();

  findContact();
  createContact();
  updateContact();

  findCompany();
  createCompany();

  createLead();

  findOpportunity();
  createOpportunity();
  updateOpportunity();

  logActivity();
  createTask();
}
```

MVP:

```text
MockCRMConnector
HubSpotConnector
```

---

# 38. Finance connector

```typescript
interface FinanceConnector {
  testConnection();

  getSuppliers();
  getCustomers();
  getOpenItems();

  createOrUpdateSupplier();

  transferInvoice();
  createBooking();
  attachDocument();
}
```

Initial:

```text
MockFinanceConnector
DATEVConnector
LexwareConnector
```

Do not invent provider endpoints.

If provider access is unavailable, implement the adapter architecture, mock, contract tests and setup documentation, and mark live validation as blocked.

---

# 39. Telephony connector

```typescript
interface TelephonyConnector {
  testConnection();
  processIncomingCall();
  processCallEvent();
  getCallMetadata();
  getRecording();
  initiateCall();
}
```

Initial:

```text
MockTelephonyConnector
TwilioConnector
```

Prepare adapter structure for:

```text
3CX
```

Use a separate `SpeechToTextProvider`.

Recording and transcription must be configurable.

---

# 40. Event-driven intake

Target:

```text
External Provider
↓
Webhook / Push
↓
Authenticity Validation
↓
Replay Protection
↓
Idempotency Check
↓
Queue
↓
Worker
↓
Domain Intake Service
↓
Communication Agent
↓
Workflow Router
```

Do not duplicate business logic between manual intake simulation and real provider webhooks.

Both paths should invoke the same underlying domain service.

Webhook requirements:

```text
signature/authenticity validation
replay protection
idempotency
event ID persistence
retry-safe processing
queue-based downstream work
```

---

# 41. Credential storage

Credentials must never be plaintext.

Existing AES-256-GCM storage may be preserved for MVP if implemented correctly.

Production architecture should support Secret Manager / Vault.

Secrets must never be exposed to:

```text
frontend
logs
AgentRun payloads
LLM context
audit payloads
```

---

# 42. Audit

Audit all material actions.

Recommended fields:

```text
tenantId
userId?
agentKey?
workflowRunId?
timestamp
objectType
objectId
action
before
after
source
correlationId
```

Examples:

```text
EMAIL_RECEIVED
DOCUMENT_PARSED
INVOICE_CREATED
BOOKING_PROPOSED
APPROVAL_REQUESTED
APPROVAL_GRANTED
WORKFLOW_RESUMED
FINANCE_TRANSFER_COMPLETED
LEAD_CREATED
CRM_UPDATED
EMAIL_SENT
MEETING_CREATED
AI_PROVIDER_CHANGED
```

Audit data must be immutable to ordinary users.

---

# 43. Observability and logging

Preserve and extend OpenTelemetry.

Trace:

```text
HTTP
Queue
Workflow
Agent
LLM
Tool
Connector
Database where practical
```

Include:

```text
correlationId
workflowRunId
agentRunId
toolInvocationId
queueJobId
providerRequestId
conversationId
```

where safe.

Wire structured logging such as pino or equivalent.

Production:

```text
JSON
```

Local:

```text
human-readable
```

Never log:

```text
API keys
access tokens
authorization headers
raw credentials
unnecessary PII
```

---

# 44. Metrics

Add a Prometheus-compatible `/metrics` endpoint.

Recommended technical metrics:

```text
http_request_duration
queue_depth
queue_job_duration
queue_failures
workflow_duration
workflow_failures
approval_wait_time
agent_run_duration
agent_run_failures
llm_request_duration
llm_failures
tool_invocation_duration
tool_invocation_failures
connector_errors
copilot_response_latency
```

Business KPIs remain separate from infrastructure metrics.

---

# 45. Tenant fairness and concurrency

Implement application-level fairness without depending on BullMQ Pro.

Concept:

```text
Global Worker Pool
↓
Tenant Semaphore
↓
Capability-Specific Limit
```

Configuration examples:

```text
tenantMaxConcurrentAgentRuns
tenantMaxConcurrentWorkflowRuns
tenantMaxConcurrentConnectorWrites
tenantMaxConcurrentCopilotRuns
userMaxConcurrentCopilotRuns
```

One tenant must not exhaust all worker capacity.

---

# 46. Failed-work operations

Create an operational admin view for failed asynchronous work.

Show:

```text
workflow/job
tenant
business object
failure category
retry count
last error
next retry
manual retry
cancel
move to manual review
```

---

# 47. Retention and privacy

Implement tenant-configurable retention.

Categories include:

```text
agent runs
tool invocation payloads
copilot conversations
emails
documents
call transcripts
failed jobs
system logs
audit data
```

Do not apply simplistic deletion to legally relevant finance records.

Retention must support:

```text
data category
minimum required retention
tenant policy
deletion eligibility
legal hold / protected status
```

---

# 48. Frontend navigation and core UX

Recommended main navigation:

```text
Home
Inbox
Finance
Sales
Approvals
Tasks
Cases
Activity
Integrations
Administration
```

Sonde is globally available as a copilot panel.

Dashboard should show:

```text
processed items
automated items
items needing approval
failed items
estimated time saved
workflow completion
```

Example:

```text
Today

42 emails processed
17 documents
11 invoices
6 leads
8 CRM activities
3 meetings

71 automated actions
5 decisions need attention

Estimated time saved
14.6 hours
```

Time-saving figures are configurable estimates, not guaranteed savings.

---

# 49. Unified Inbox

Show:

```text
source
sender
subject
classification
case
workflow status
assigned agent
human action required
timestamp
```

Filters:

```text
Finance
Sales
Needs Attention
Automated
Errors
```

---

# 50. Finance UI

Invoice detail should show:

```text
document viewer
supplier
invoice number
date
line items
amount
VAT
IBAN
payment terms
duplicate result
bank-change warning
booking proposal
confidence
approval status
workflow timeline
finance transfer status
audit trail
```

Do not expose hidden chain-of-thought.

Only show concise operational explanations.

---

# 51. Sales UI

Lead/opportunity view:

```text
contact
company
source
summary
intent
opportunity
next action
suggested follow-up
tasks
meetings
CRM sync
communication history
workflow status
```

---

# 52. Approval Center

Show:

```text
requested action
business object
reason
risk
confidence
policy result
requesting workflow
requesting agent
status
```

Actions:

```text
Approve
Reject
Edit & Approve
```

---

# 53. Workflow visibility

Users must always be able to understand:

```text
What happened?
What is happening now?
What happens next?
What requires me?
```

Do not require a business user to inspect technical AgentRun records.

---

# 54. Error UX

Translate technical failures into business-understandable states.

Example:

Technical:

```text
HubSpot API 429
```

User-facing:

```text
CRM temporarily unavailable.
ORBIT will retry automatically.
```

Technical details remain available to administrators and logs.

---

# 55. Security requirements

At minimum:

```text
Helmet
CORS
CSRF protection where applicable
rate limiting
input validation
output sanitization
RBAC
tenant isolation
secret encryption
secure cookies/tokens
webhook verification
idempotency
file upload restrictions
MIME validation
size limits
SSRF protection
```

Explicitly test:

```text
IDOR
SQL injection
XSS
mass assignment
path traversal
cross-tenant access
tool permission bypass
policy bypass
prompt injection
malicious PDF
malicious email
webhook spoofing
replay attacks
credential exposure
arbitrary provider endpoint injection
```

Treat ORBIT as both:

```text
SaaS security problem
+
agentic execution security problem
```

---

# 56. Development environment and deployment

Local development should support:

```text
PostgreSQL
Redis
MinIO
API
Worker
Web
```

through Docker Compose.

Preferred startup:

```bash
docker compose up
```

Maintain:

```text
.env.example
```

Document every variable.

Never commit real secrets.

Primary infrastructure should remain portable.

German / EU hosting such as STACKIT is a suitable target, but avoid unnecessary provider lock-in.

Prefer standards:

```text
Docker
PostgreSQL
Redis
S3-compatible storage
HTTP
OAuth2
OpenTelemetry
```

Kubernetes is not mandatory for MVP.

---

# 57. CI

CI should run:

```text
install
lint
typecheck
unit tests
integration tests
build
```

E2E should run in CI where practical.

A failing critical check must fail the pipeline.

---

# 58. Testing strategy

## Unit tests

At minimum:

```text
Policy Engine
Workflow transitions
Approval resume
Idempotency helpers
Invoice mapping
Duplicate detection
Agent tool validation
Tenant isolation utilities
Permission checks
Connector mapping
Context resolution
Provider configuration
```

## Integration tests

At minimum:

```text
API + PostgreSQL
Queue + Worker
Workflow + Approval
AgentRuntime + MockLLM
Mock connectors
Provider adapter contracts
```

## E2E scenarios

### Finance

```text
Login
→ invoice
→ booking proposal
→ approval
→ transfer
→ completed workflow
```

### Durable Resume

```text
invoice
→ approval wait
→ stop/restart worker
→ approve
→ workflow resumes
→ external action exactly once
```

### Sales

```text
new message
→ lead
→ task
→ CRM sync
```

### Sonde Read

```text
invoice page
→ ask why stopped
→ correct factual explanation
```

### Sonde Unauthorized Access

```text
sales user
→ requests restricted finance data
→ denied
```

### Sonde Delegation

```text
"Verarbeite diese Rechnung."
→ durable workflow starts
```

### Provider Choice

```text
Tenant A = ORBIT Managed AI
Tenant B = BYOK OpenAI
```

Correct provider path and tenant isolation.

### Prompt Injection

Malicious invoice/email cannot alter platform behaviour.

---

# 59. Quality gates

Before marking a major phase complete run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Fix reproducible failures before continuing.

---

# 60. Connector maturity

Use:

```text
DESIGNED
IMPLEMENTED
UNIT_TESTED
INTEGRATION_TESTED
E2E_TESTED
MOCK_TESTED
CONTRACT_TESTED
SANDBOX_TESTED
LIVE_TESTED
PRODUCTION_READY
```

Do not call a connector production-ready because a mock works.

Maintain:

```text
/docs/IMPLEMENTATION_STATUS.md
```

For each major capability record:

```text
status
implemented
tested
mock tested
live tested
known limitations
external blocker
next step
```

---

# 61. Documentation

Maintain at least:

```text
README.md

/docs/ARCHITECTURE.md
/docs/PRODUCT_CONTEXT.md
/docs/DOMAIN_MODEL.md
/docs/WORKFLOW_ENGINE.md
/docs/AGENT_ARCHITECTURE.md
/docs/AGENT_GOVERNANCE.md
/docs/AI_PROVIDER_ARCHITECTURE.md
/docs/SONDE_COPILOT.md
/docs/SECURITY.md
/docs/INTEGRATIONS.md
/docs/CONNECTOR_MATURITY.md
/docs/DATEV_INTEGRATION.md
/docs/MICROSOFT_INTEGRATION.md
/docs/GOOGLE_INTEGRATION.md
/docs/HUBSPOT_INTEGRATION.md
/docs/TELEPHONY.md
/docs/DATA_RETENTION.md
/docs/OPERATIONS_RUNBOOK.md
/docs/LOCAL_DEVELOPMENT.md
/docs/DEPLOYMENT.md
/docs/TESTING.md
/docs/ASSUMPTIONS.md
/docs/KNOWN_LIMITATIONS.md
/docs/IMPLEMENTATION_STATUS.md
/docs/MVP_COMPLETION_REPORT.md
```

Documentation must reflect actual behaviour, not planned behaviour presented as complete.

---

# 62. Branding

Do not hard-code ORBIT as the permanent commercial name.

Use configuration such as:

```text
APP_NAME
BRAND_NAME
BRAND_LOGO
PRIMARY_DOMAIN
SUPPORT_EMAIL
```

Local default may be:

```text
Project ORBIT
```

Changing the final company/product name must not require domain-model or architecture changes.

---

# 63. Unified implementation order

Claude Code must follow this order unless a small reordering is technically necessary.

## Phase 0 — Repository Audit and Gap Analysis

Read:

- current repository,
- this specification,
- existing architecture docs,
- Agent Studio docs,
- implementation status.

Create:

```text
/docs/ORBIT_MASTER_IMPLEMENTATION_PLAN.md
```

For each requirement classify:

```text
ALREADY_COMPLETE
PARTIAL
MISSING
BLOCKED_BY_EXTERNAL_CREDENTIALS
```

Do not rebuild completed features.

## Phase 1 — Durable Workflow Engine

Implement:

```text
persisted workflow state
workflow versioning
approval resume
workflow events
idempotent step execution
retry semantics
restart recovery
```

## Phase 2 — Approval Integration

Ensure:

```text
approval granted → workflow resumes automatically
approval rejected → reject branch
```

## Phase 3 — Operational Hardening

Implement:

```text
structured logging
metrics
failed-job operations
tenant concurrency
retention foundation
```

## Phase 4 — Agent Governance

Implement/strengthen:

```text
agent lifecycle
published-version immutability
prompt layering
evaluation framework
regression suites
```

## Phase 5 — Multi-Provider AI Platform

Implement/strengthen:

```text
provider registry
Anthropic adapter
OpenAI adapter
Mock provider
provider connection model
credential-type model
ORBIT Managed AI
BYOK
AI admin UI
connection testing
model profiles
usage metering
provider health
fallback policy
```

## Phase 6 — Sonde Conversation Foundation

Implement:

```text
Conversation
ConversationMessage
ConversationSummary
ConversationContext
ConversationReference
Copilot API
CopilotRuntime
```

## Phase 7 — Sonde Read Mode

Implement:

```text
ASK
NAVIGATE
context providers
global attention query
current-object explanation
```

## Phase 8 — Sonde Streaming UI

Implement:

```text
global panel
mobile UI
SSE
conversation list
history
entity references
suggested questions
```

## Phase 9 — Sonde Prepare Mode

Implement:

```text
draft email
follow-up proposal
meeting proposal
booking proposal
```

## Phase 10 — Sonde Safe Actions

Implement controlled:

```text
create task
create contact
create lead
create meeting
send approved email
```

## Phase 11 — Sonde Workflow Delegation

Implement:

```text
start_invoice_processing_workflow
start_sales_lead_workflow
start_follow_up_workflow
```

## Phase 12 — Real Provider / Connector Activation

Live-test when credentials exist:

```text
Anthropic
OpenAI
Microsoft / Google
HubSpot
DATEV / Lexware
Twilio
```

When credentials are missing:

```text
production adapter
+
mock
+
contract test
+
setup documentation
+
transparent blocked status
```

## Phase 13 — Domain UX Improvements

Implement:

```text
invoice viewer
line items
workflow timeline
exception UX
approval timeline
```

## Phase 14 — Pilot Readiness

Perform:

```text
security tests
load tests
failure tests
provider failure tests
tenant isolation tests
prompt injection tests
workflow restart tests
approval-delay tests
connector retry tests
```

---

# 64. MVP acceptance criteria

## Finance

1. invoice enters through simulation or real intake,
2. invoice is stored,
3. data extracted,
4. supplier matched,
5. duplicate checked,
6. bank change detected,
7. booking proposal created,
8. approval created when required,
9. workflow pauses durably,
10. approval resumes automatically,
11. finance transfer occurs exactly once,
12. full audit trail exists.

## Sales

1. inbound communication received,
2. sales intent identified,
3. contact/company matched or created,
4. lead created,
5. follow-up task created,
6. CRM updated,
7. meeting proposed/created,
8. workflow status visible,
9. audit trail exists.

## Multi-Tenant

1. Tenant A cannot read Tenant B data,
2. Tenant A cannot execute tools against Tenant B data,
3. Copilot cannot bypass tenant isolation,
4. provider credentials are tenant-isolated.

## Agent Platform

1. agents use allowed tool subsets,
2. tool calls are schema-validated,
3. policy rules are enforced,
4. published versions are immutable,
5. critical regression tests exist.

## Sonde

1. globally available,
2. persistent multi-turn conversations,
3. validated current-page context,
4. RBAC enforced,
5. Policy Engine enforced,
6. answers questions about current objects,
7. prepares drafts,
8. executes permitted simple actions,
9. delegates complex work to workflows,
10. cannot bypass workflow engine,
11. workflows survive browser closure,
12. prompt injection cannot cause unauthorized action.

## AI Providers

1. Mock provider works,
2. Anthropic adapter exists,
3. OpenAI adapter exists,
4. ORBIT Managed AI mode exists,
5. BYOK exists,
6. credentials are secure,
7. model profiles exist,
8. usage metering exists,
9. fallback policy is explicit,
10. provider failure cannot create false success.

---

# 65. Non-goals for current MVP

Do not prioritise:

```text
autonomous payment execution
full payroll
tax return automation
full month-end close
full ERP
SAP S/4HANA integration
full CPQ
native mobile app
multi-region Kubernetes
generic web browser agent
generic user-created arbitrary tools
arbitrary SQL from LLM
fully open provider URL configuration
persistent psychological user profiling
```

---

# 66. Final architectural principles

1. **AI provides intelligence. ORBIT controls execution.**
2. **Sonde talks to the user. ORBIT does the work.**
3. **Workflows must be durable and resumable.**
4. **The LLM never owns authoritative business state.**
5. **External systems remain Systems of Record.**
6. **Provider independence is required.**
7. **ORBIT Managed AI is the default customer experience.**
8. **BYOK is optional and controlled.**
9. **Tenant isolation is non-negotiable.**
10. **Critical business rules live in deterministic code.**
11. **Human approval is a product feature, not a failure.**
12. **Every material action is auditable.**
13. **Normal users should not need to understand agent architecture.**
14. **Do not rebuild working components unnecessarily.**
15. **No component is production-ready until real behaviour is tested.**

---

# 67. Architectural North Star

```text
                  User
                    │
            ┌───────┴────────┐
            │                │
      Business UI          Sonde
            │                │
            └───────┬────────┘
                    ▼
            ORBIT Application
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
 Durable       Specialist      Domain
 Workflow       Agents         Services
 Engine            │
       │            ▼
       │        Tool Registry
       │            │
       └──────┬─────┘
              ▼
         Policy Engine
              │
       ┌──────┴──────┐
       ▼             ▼
 Autonomous       Approval
       │             │
       └──────┬──────┘
              ▼
          Tool Gateway
              ▼
        Connector Layer
              ▼
      External Systems

LLM Provider Layer:
ORBIT Managed AI
or
Approved Tenant BYOK
```

---

# 68. Claude Code execution instruction

Claude Code must use this document as the authoritative development definition.

Before writing major new code:

1. inspect the full repository,
2. inspect current documentation,
3. inspect Prisma schema,
4. inspect workflow implementation,
5. inspect approval behaviour,
6. inspect AgentRuntime,
7. inspect Tool Registry,
8. inspect Agent Studio,
9. inspect connector abstractions,
10. inspect current LLMProvider,
11. inspect frontend routes,
12. inspect tests,
13. inspect CI.

Then create:

```text
/docs/ORBIT_MASTER_IMPLEMENTATION_PLAN.md
```

For every major requirement include:

```text
current state
classification
gap
proposed implementation
reused components
new components
schema changes
migration impact
security impact
test impact
risk
priority
```

Do not begin major implementation until the plan is internally consistent.

Then execute the phases defined in this specification.

After every major phase run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Fix reproducible regressions before continuing.

Do not claim live testing when only mocks were tested.

Do not invent external API behaviour.

When credentials are missing:

```text
implement adapter
implement mock
implement contract tests
document setup
mark live validation as blocked
continue development
```

The final output must be a coherent, demonstrable and extensible product platform, not a collection of disconnected AI demos.

---

# 69. Final statement

The long-term product objective is:

> **A secure, multi-tenant AI operating layer for SMEs that understands business events, orchestrates administrative work across existing systems, safely executes routine tasks through specialised agents and workflows, and gives users one application-wide copilot to understand, control and supervise the work.**

This specification is the authoritative development baseline for that objective.
