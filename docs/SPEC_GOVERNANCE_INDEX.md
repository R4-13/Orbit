# Spezifikations-Governance — Dokumentenindex und Eigentümer (GOV-12)

Grundlage: `ORBIT_SPECIFICATION_GOVERNANCE_AND_ARCHITECTURE_CONSISTENCY_v1.md` (06.10.2026). Dieser Index hält fest, **welche Dokumente aktiv sind**,
**wer fachlich-technisch Eigentümer** einer Verantwortung ist und **wie Spezifikationsbegriffe auf den tatsächlichen Repository-Stand abgebildet sind**.
Die Abbildung wurde am 06.10.2026 gegen den Code geprüft (nicht aus den Spezifikationen übernommen) – wo die Spezifikation etwas als „bestehend“
voraussetzt, das im Repository nicht existiert, steht das ausdrücklich dabei.

## 1. Aktive Dokumente

| # | Dokument | Scope | Repository-Kopie |
|---|---|---|---|
| 1 | `ORBIT_MASTER_SPECIFICATION_v3.md` | Grundarchitektur | `docs/ORBIT_MASTER_SPECIFICATION.md` (dort als Version 1.0 geführt; eine Datei „Master v3“ liegt im Repository nicht vor) |
| 2 | `…AMENDMENT_01_INTEGRATION_FRAMEWORK_v2.md` | Konnektoren, Verbindungen | `docs/ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_01_INTEGRATION_FRAMEWORK.md` (Inhalt = Version 2.0) |
| 3 | `…AMENDMENT_02_BUSINESS_PROCESS_ORCHESTRATION_FRAMEWORK_v1.2.md` | Business-Triage, Cases, Planung, Wait/Resume | `docs/ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_02_BUSINESS_PROCESS_ORCHESTRATION_FRAMEWORK_v1.2.md`; Umsetzung `docs/BUSINESS_PROCESS_FRAMEWORK*.md` (Stand v1.1 umgesetzt; v1.2-Lücken: Gap-Matrix in `BUSINESS_PROCESS_FRAMEWORK_IMPLEMENTATION_PLAN.md`) |
| 4 | `ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md` | Tenant-UI | `docs/ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md` |
| 5 | `…UI_UX_DEVELOPMENT_SPECIFICATION_v2_ADDENDUM_01_PRODUCTION_DIAGNOSTICS_BOUNDARY_v1.md` | Sichtbarkeitsgrenze Business/Tenant/Diagnostics | **nicht geliefert** – wird durch Amendment 03 §17, Amendment 02 §35 und `PLATFORM_DIAGNOSTICS.md` abgedeckt; sobald das Addendum vorliegt, ist es gegenzuprüfen |
| 6 | `…AMENDMENT_03_PLATFORM_OPERATIONS_ADMINISTRATION_DIAGNOSTICS_v1.md` | Platform Control Plane | `docs/PLATFORM_OPERATIONS_*.md` (Plan, Architektur, Abnahme) |
| 7 | `ORBIT_SPECIFICATION_GOVERNANCE_AND_ARCHITECTURE_CONSISTENCY_v1.md` | Eigentümerregeln | dieses Dokument |

Nicht mehr als Entwicklungsquelle: Amendment 02 Rev 1.0/1.1 (durch 1.2 abgelöst), `ORION_UI_UX_DEVELOPMENT_SPECIFICATION_v1.md` (HISTORISCH).

## 2. Single-Owner-Matrix gegen den Repository-Stand

| Verantwortung | Eigentümer im Repository | Abweichung / Anmerkung |
|---|---|---|
| Workflow-/Case-Zustand | `apps/api/src/workflows`, `apps/api/src/process` (`Case.orchestrationStatus`, `ProcessPlan*`, `CaseEvent`) | – |
| AI-Ausführung | `AgentRuntime` (`packages/agent-core`) + `AiProviderResolverService` | Resolver liefert heute einen `LLMProvider` je Tenant, noch keine Profile/Routen (OPS-2) |
| Policy | `apps/api/src/policy`, `PolicyConfig`, `PolicyMode` = `DISABLED/SUGGEST_ONLY/REQUIRE_APPROVAL/AUTONOMOUS` | einzige Enum – bleibt (GOV-02) |
| Approval | `Approval` + `ApprovalPresenterService` | – |
| Tool Execution | `ToolRegistry`/Tool Gateway, `CapabilityRegistryService` als fachliche Sicht (GOV-03) | – |
| Connector-Katalog | `IntegrationConnectorType` (Enum), `Integration`, `ConnectorSync`, `connector-operational-status.ts` | **es existiert keine persistente Connector Registry mit Lifecycle/Versionen**; Amendment 03 erweitert den Katalog (OPS-3) |
| Verbindungen/Credentials | `Integration` + `IntegrationCredentialSecret` + `CredentialVaultService`/`CredentialEncryptionService` | Secret-Abstraktion vorhanden → wiederverwenden |
| AuthN/AuthZ | `apps/api/src/auth` (JWT, `JwtAuthGuard`, `PermissionsGuard`), `Role`/`RolePermission`/`UserRole` (mandantengebunden) | Platform-Domäne fehlt (OPS-1). Die Rolle `SYSTEM_ADMIN` ist eine **Mandantenrolle** (hat `tenant.manage`), keine Plattformrolle |
| Audit | `AuditLog` + `AuditService.record()` | `tenantId` war Pflicht → wird für die Platform-Domäne erweitert (kein zweiter Store) |
| Observability | OpenTelemetry (`tracing.ts`), `logging`, `metrics` | Diagnostics projiziert daraus |
| Model Profiles | **existiert nicht** (Spezifikation setzt `AIModelProfile` voraus) | neu, begründet in `PLATFORM_OPERATIONS_IMPLEMENTATION_PLAN.md` |
| Provider Connections | `AIProviderConnection` (eine je Tenant, BYOK) | erweitert um `PLATFORM_MANAGED`-Verbindungen |
| Tenant Visual UX | UI/UX v2 | unverändert (OPS-29) |

## 3. Datenmodell-Crosswalk (GOV-10)

Neue persistente Entities werden im Plan einzeln begründet (Warum kein bestehendes Modell, Source of Truth, Lifecycle-Owner, Retention, Scope, Indizes,
Migration, Konsumenten). Projektionen/DTOs ohne Tabelle: `BusinessOrchestrationProjection`, `OrchestrationDiagnosticProjection`, `ActionPolicyDecision`,
`CompletionEvaluation` (Snapshot im `CaseEvent`), `HumanInteractionRequest` (auf `Task`/`Approval`/`ActionIntent` abbildbar).

## 4. Regeln, die jeder Folge-Commit einhält

1. Erst Eigentümer suchen (Abschnitt 2), dann erweitern; neue Tabelle nur mit Begründung im Plan.
2. Keine zweite Policy-/Autonomie-Enum, keine zweite Connector-/Audit-/Secret-/Workflow-Plattform.
3. PostgreSQL ist die Wahrheit für langlebigen Zustand; Redis nur flüchtig; Dokumente im Objektspeicher; externe Stammdaten nicht gespiegelt.
4. Jeder neue Zustand hat Eigentümer → Persistenz → Service → Autorisierung → API/Projektion → UI → Audit → Test.
