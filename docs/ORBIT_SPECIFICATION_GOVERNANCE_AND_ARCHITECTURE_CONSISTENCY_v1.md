# ORBIT SPECIFICATION GOVERNANCE & ARCHITECTURE CONSISTENCY v1
## Single-Owner-Regeln, Dokumenthierarchie, Datenhaltung und Performance-Leitplanken

**Projekt:** ZERIONUS / ORBIT  
**Version:** 1.0  
**Datum:** 06.10.2026  
**Status:** Verbindliche Interpretations- und Konsistenzregel für Claude Code

---

# 1. Zweck

Dieses Dokument verhindert, dass Master-Spezifikation und Amendments zu parallelen Implementierungen, doppelten Datenmodellen oder konkurrierenden Zustandsmaschinen führen.

Grundsatz:

> **Ein fachlich-technisches Konzept hat genau einen autoritativen Owner. Amendments erweitern oder präzisieren diesen Owner; sie erzeugen keine zweite Plattform für dieselbe Verantwortung.**

Claude Code muss bei Überschneidungen bestehende Komponenten erweitern, bevor neue Komponenten eingeführt werden.

# 2. Gültige Dokumente und Ablösung

Aktiv und verbindlich:

1. `ORBIT_MASTER_SPECIFICATION_v3.md`
2. `ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_01_INTEGRATION_FRAMEWORK_v2.md`
3. `ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_02_BUSINESS_PROCESS_ORCHESTRATION_FRAMEWORK_v1.2.md`
4. `ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md`
5. `ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2_ADDENDUM_01_PRODUCTION_DIAGNOSTICS_BOUNDARY_v1.md`
6. `ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_03_PLATFORM_OPERATIONS_ADMINISTRATION_DIAGNOSTICS_v1.md`

Nicht mehr als aktive Entwicklungsquelle verwenden:

- Amendment 02 Revision 1.1, sobald Revision 1.2 übernommen ist.
- historische UI/UX v1, da UI/UX v2 sie ersetzt.

# 3. Vorrangmatrix nach Thema

| Thema | Autoritative Quelle |
|---|---|
| Grundarchitektur, Stack, Multi-Tenancy, Kern-Domainmodell | Master v3 |
| Connectoren, externe Auth, Connection Lifecycle, Connector Registry | Amendment 01 v2 |
| Business-Triage, Cases, Facts, Planning, Wait/Resume, Replanning, Completion | Amendment 02 v1.2 |
| Tenant-UI Layout, Navigation, Home, Sonde, Designsystem | UI/UX v2 |
| Sichtbarkeitsgrenze Business/Tenant/Diagnostics | UI/UX v2 Addendum 01 |
| Hersteller-/Betreiberrollen, Platform AI Governance, Platform Diagnostics, Support Sessions, Feature/Release Operations | Amendment 03 v1 |

Bei Überschneidung gilt die **fachlich spezifischere Quelle** aus dieser Matrix. Ein späteres Dokument ersetzt nicht pauschal ein älteres Dokument, sondern nur innerhalb seines ausdrücklich definierten Scopes.

# 4. Single-Owner-Matrix

| Verantwortung | Einziger autoritativer Owner | Erweiterungen |
|---|---|---|
| Workflow-Zustand | Workflow Engine | Amendment 02 erweitert Semantik |
| Case-Zustand | Case/Workflow Domain | keine zweite Agent-State-Engine |
| AI-Ausführung | AgentRuntime + AIProviderResolver | Platform Governance konfiguriert Routing |
| Policy | Policy Engine | Platform + Tenant + Blueprint Constraints |
| Approval | Approval Engine | Human Interaction referenziert/erweitert |
| Tool Execution | Tool Registry + Tool Gateway | Capability Registry ist fachliche Sicht darauf |
| Connector Catalogue | Connector Registry aus Amendment 01 | Amendment 03 ergänzt Platform Lifecycle/Governance |
| Connections/Credentials | Integration Framework + Secret Abstraction | Platform- und Tenant-Scope |
| AuthN/AuthZ | bestehende Auth/RBAC-Infrastruktur | Tenant- und Platform-Security-Domains |
| Audit | bestehendes AuditModule / AuditEvent | neue Eventtypen, kein zweiter Audit Store |
| Observability | OpenTelemetry/Logging/Metrics | Diagnostics projiziert daraus plus Domain-Evidenz |
| Model Profiles | bestehendes AIModelProfile | Platform Governance versioniert/routet |
| Provider Connections | bestehendes AIProviderConnection | `PLATFORM_MANAGED` / `TENANT_MANAGED` |
| Tenant Visual UX | UI/UX v2 | spätere screenshotbasierte Deltas |
| Platform UX | Amendment 03 | strikt getrennte Berechtigung |

# 5. Datenmodell-Crosswalk

Neue Spezifikationsbegriffe bedeuten nicht automatisch neue persistente Entities.

## 5.1 Nur Projektion/DTO, standardmäßig keine eigene Tabelle

```text
BusinessOrchestrationProjection
OrchestrationDiagnosticProjection
ActionPolicyDecision
CompletionEvaluation (kann Event/Snapshot sein)
HumanInteractionRequest, wenn Task/Approval bereits ausreichend modellierbar ist
```

Claude muss zuerst bestehende `Task`, `Approval`, `PolicyDecision`, `WorkflowEvent`, `AgentRun`, `ToolInvocation` und Projektionen prüfen.

## 5.2 Bestehende Modelle erweitern

```text
Role / Permission
AIProviderConnection
AIModelProfile
AIProviderHealth
AIUsageRecord
AuditEvent
Connector Registry
WorkflowRun / WorkflowStepRun / WorkflowEvent
Case / Fact
```

## 5.3 Neue Persistenz nur bei echter fachlicher Lücke

Eine neue Tabelle ist nur zulässig, wenn:

1. die Information langlebig und transaktional benötigt wird,
2. keine bestehende Entity klarer Owner ist,
3. ein DTO/Event nicht ausreicht,
4. Migration und Ownership dokumentiert sind,
5. kein zweiter Wahrheitsstand entsteht.

# 6. Policy-Konsistenz

Es gibt genau eine autoritative Policy-Modusfamilie:

```text
DISABLED
SUGGEST_ONLY
REQUIRE_APPROVAL
AUTONOMOUS
```

Keine zweite A0–A4- oder ähnliche Runtime-Enum.

Risiko, Constraints und Capability-Klasse dürfen zusätzliche Metadaten sein, verändern aber nicht die alleinige Policy-Semantik.

# 7. Datenbank und Persistenz

ORBIT ist **nicht datenbanklos** und soll es für die definierte Produktarchitektur auch nicht werden.

Die bestehende Architektur verwendet PostgreSQL/Prisma als langlebige Transaktions- und Zustandsbasis. Das ist für folgende Funktionen notwendig:

```text
Tenant-Isolation und RLS
Benutzer/Rollen/Berechtigungen
Cases
Workflow-/Step-Zustand
Wait/Resume
Facts und Quellenreferenzen
Approvals
Idempotency/Action Ledger
Korrelation externer Ereignisse
Connector-/Connection-Metadaten
Provider-/Model-Konfiguration
Tenant-/Platform-Policies
Feature-/Rollout-Konfiguration
Audit
Usage-/Abrechnungsmetadaten
Support Sessions
```

Ohne langlebige Datenbank wären insbesondere Restart-Recovery, verzögerte Antworten, Freigaben, Exactly-once-nahe Side-Effect-Sicherheit und Audit nicht zuverlässig realisierbar.

# 8. Datenbank ist nicht System of Record für alles

ORBIT soll **keine unnötige Schattenkopie** von CRM/ERP/FIBU/DATEV/etc. aufbauen.

Regel:

```text
External Systems of Record
→ bleiben fachliche Stammdatenquelle

ORBIT PostgreSQL
→ hält Orchestrierungszustand, Referenzen, notwendige Snapshots, Konfiguration und Evidenz

Object Storage
→ Dokumente/Anhänge/größere Artefakte

Redis
→ Queue/Cache/Rate Limits/kurzlebige Koordination
→ niemals alleinige Quelle für fachlich dauerhaften Zustand
```

Für externe Stammdaten bevorzugt:

```text
externalId
sourceSystem
version/etag where available
minimal required snapshot
observedAt
```

statt vollständiger dauerhafter Spiegelung.

# 9. Performance-Leitplanken

Performance entsteht nicht durch das Entfernen der Datenbank, sondern durch klare Ownership und passende Speicherverwendung.

Verbindlich:

1. PostgreSQL bleibt Source of Truth für langlebigen ORBIT-Zustand.
2. Redis darf Beschleuniger sein, aber keine fachliche Wahrheit ersetzen.
3. Große Binärdaten gehören in Object Storage, nicht als Blob in häufig abgefragte Tabellen.
4. Externe Stammdaten werden bedarfsorientiert gelesen und sinnvoll gecacht.
5. Hot-path Queries benötigen passende Indizes, insbesondere auf `tenantId`, Status, Correlation, external IDs und Fälligkeit.
6. Listen/Home nutzen gezielte Projektionen statt große Domainobjekte vollständig zu laden.
7. LLM-Aufrufe werden nicht für deterministische Entscheidungen verschwendet.
8. Event-/Audit-Tabellen benötigen Retention/Archivierungs-/Partitionierungsstrategie, wenn Volumen wächst.
9. N+1-Connector-/DB-Abfragen vermeiden; Context Resolver bündelt autorisierte Reads.
10. Keine synchronous chain langer externer Calls im HTTP Request; langlebige Arbeit läuft über Worker.
11. Idempotency und Correlation verhindern teure Doppelverarbeitung.
12. Kein Microservice-Zoo; modularer Monolith + Worker bleibt Default, solange Skalierungsdaten keinen Split rechtfertigen.

# 10. Frontend-/Backend-Konsistenz

Frontend erfindet keinen Zustand.

```text
Backend Domain State
→ autorisierte Projection
→ UI
```

Es gibt keine zweite Statusmaschine im Frontend.

Business-UI nutzt Business Projection. Platform Diagnostics nutzt Diagnostic Projection. Beide referenzieren dieselben autoritativen Domainobjekte.

# 11. Repository-Audit vor Schemaänderungen

Bevor Claude neue Tabellen, Enums, Registries oder Services anlegt:

```text
1. Existing owner suchen
2. Existing schema/API prüfen
3. Requirement darauf mappen
4. Extend vs. migrate entscheiden
5. Nur bei echter Lücke neu anlegen
6. ADR bei konkurrierender Architektur
```

Im Implementierungsplan muss jede neue persistente Entity begründet werden:

```text
why existing model cannot own it
source of truth
lifecycle owner
retention
tenant/platform scope
indexes
migration
API consumers
```

# 12. Verbindliche Acceptance Criteria

| ID | Kriterium |
|---|---|
| GOV-01 | Keine zweite Workflow Engine wird eingeführt. |
| GOV-02 | Keine zweite Policy Engine oder konkurrierende Policy-Enum wird eingeführt. |
| GOV-03 | Capability Registry bleibt Sicht auf Tool/Connector-Fähigkeiten, keine zweite Toolplattform. |
| GOV-04 | Amendment 03 erweitert die Connector Registry aus Amendment 01 statt eine zweite Registry anzulegen. |
| GOV-05 | AIModelProfile/AIProviderConnection werden erweitert statt parallel dupliziert. |
| GOV-06 | Platform-RBAC nutzt/erweitert die bestehende Auth-Infrastruktur mit separater Security Domain. |
| GOV-07 | Business-/Diagnostic-Projections erzeugen keinen zweiten Domain-State. |
| GOV-08 | PostgreSQL bleibt langlebige ORBIT Source of Truth; Redis ist nicht fachlich autoritativ. |
| GOV-09 | Externe SoR-Daten werden nicht unnötig vollständig gespiegelt. |
| GOV-10 | Jede neue persistente Entity ist im Audit explizit begründet. |
| GOV-11 | Frontend besitzt keine unabhängige Status-/Policy-Wahrheit. |
| GOV-12 | Aktive Dokumenthierarchie und ersetzte Versionen sind im Repository-Index dokumentiert. |
| GOV-13 | Quality Gates und Migrationstests belegen, dass bestehende Funktionen erhalten bleiben. |
| GOV-14 | Performance-relevante neue Queries besitzen Query-/Index-Review. |
| GOV-15 | Keine lose Ende zwischen API, Worker, Persistenz und UI-Projektion: jeder neue Zustand besitzt Owner, Persistenz, API/Projection und Test. |

# 13. Auftrag an Claude Code

> Read this governance document before implementing Amendment 02 v1.2 or Amendment 03.
>
> Treat amendments as refinements of existing owners, not invitations to create parallel subsystems. Before creating a new table, enum, registry, runtime or authorization framework, identify the current owner and extend it where possible.
>
> Keep the existing policy modes `DISABLED`, `SUGGEST_ONLY`, `REQUIRE_APPROVAL`, `AUTONOMOUS` as the only authoritative policy enum.
>
> Use the Connector Registry from Amendment 01 as the single connector catalogue. Use the existing AI provider/profile models as the single AI configuration foundation. Use the existing workflow, policy, approval, audit, secret and auth infrastructure.
>
> Keep PostgreSQL/Prisma as the durable transactional source of truth. Use Redis for ephemeral coordination/caching and object storage for documents. Do not mirror external systems of record without a concrete process/evidence need.
>
> For every new requirement, demonstrate the full ownership path:
> domain owner → persistence/state → service/runtime → authorization → API/projection → UI/consumer → audit/observability → tests.
>
> If the current repository materially conflicts with this ownership model, stop that specific implementation path, document the conflict and propose one migration/ADR rather than adding a second architecture.

---

**END OF SPECIFICATION GOVERNANCE & ARCHITECTURE CONSISTENCY v1**