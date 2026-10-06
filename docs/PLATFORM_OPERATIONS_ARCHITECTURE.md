# Platform Operations — Architektur (Amendment 03)

Stand: Phasen OPS-1 (Sicherheitsgrenze), OPS-4a (Business-/Diagnoseprojektion), OPS-2 (AI-Plattform) umgesetzt. Details: `PLATFORM_RBAC.md`, `PLATFORM_AUDIT.md`,
`AI_PROVIDER_GOVERNANCE.md`, `AI_MODEL_PROFILES.md`, `PLATFORM_DIAGNOSTICS.md`. Plan und Gap-Matrix: `PLATFORM_OPERATIONS_IMPLEMENTATION_PLAN.md`.

```text
                    ┌──────────────────────── ein modularer Monolith (NestJS) + Worker ────────────────────────┐
 Business User ───▶ │ /api/v1/*            Mandanten-JWT (JWT_SECRET)        PrismaService.forTenantId() · RLS │
 Tenant Admin  ───▶ │                      Rollen/Permissions je Mandant                                      │
                    │                                                                                        │
 Platform Operator ▶│ /api/v1/platform/*   Plattform-JWT (PLATFORM_JWT_SECRET)  PrismaService.withPlatformScope()
                    │                      Sitzung je Request geprüft · Scopes aus der DB · Step-up · Audit    │
                    │                                                                                        │
                    │  gemeinsame Basis:  AuditLog (domain TENANT|PLATFORM) · CredentialEncryptionService ·   │
                    │                     Policy Engine · Workflow/Case-Domäne · AiProviderResolverService    │
                    └────────────────────────────────────────────────────────────────────────────────────────┘
```

## Prinzipien

1. **Eine Plattform, zwei Sicherheitsdomänen.** Kein zweites Auth-/Audit-/Policy-/Workflow-System; die Plattformdomäne ergänzt Identität, Scopes und Register (Governance GOV-04…06).
2. **Defense in Depth.** Serverseitige Guards (Route) → Scopes aus der Datenbank (kein Token-Vertrauen) → RLS-Policies (`app.platform_scope`) → Trigger (Unveränderlichkeit) → DB-Checks (reservierte Rollennamen).
3. **Business-Code kennt Profile, nie Anbieter.** Wechsel von Anbieter/Modell = Registerdaten + Adapter (OPS-05/07/11).
4. **Ehrliche Blockzustände.** Ist kein zulässiger Pfad vorhanden, scheitert der Aufruf mit Grund (`AI_PROVIDER_UNAVAILABLE`); Triage/Planer/Extraktion übersetzen das in ihre vorhandenen „später/prüfen“-Zustände.
5. **Konfigurationspräzedenz** (Amendment 03 §7) – umgesetzt für die AI-Auflösung: Plattformregeln (Anbieter-/Modell-/Verbindungs-/Datenrichtlinie, Gesundheit) gehen vor Mandantenroute vor BYOK-Wahl; BYOK kann Plattformregeln nicht lockern (Anbieter/Modell müssen freigegeben sein). Noch nicht umgesetzt: Plattformobergrenzen für Policy-Modi und Blueprint-Constraints (OPS-3).

## Komponenten

| Komponente | Ort |
|---|---|
| Rollen, Scopes, Matrix, Audit-Typen, Redaction, AI-Entscheidungslogik | `packages/shared/src` (`platform.ts`, `redaction.ts`, `ai-governance.ts`, `process-schemas/orchestration-diagnostics.ts`) |
| Plattformidentität, Sitzungen, Guards, Step-up | `apps/api/src/platform/auth`, `…/identity` |
| Plattform-Audit | `apps/api/src/platform/audit` |
| Mandantenregister, Übersicht | `apps/api/src/platform/tenants` |
| Diagnose | `apps/api/src/platform/diagnostics` |
| AI-Register, Adapter, Tresor, Messung | `apps/api/src/ai-governance` |
| AI-Plattform-API | `apps/api/src/platform/ai` |
| Laufzeit-Auflösung | `apps/api/src/ai-providers/ai-provider-resolver.service.ts` |
| Schema/Migrationen | `packages/domain/prisma` (`20261006080000…`, `…080100`, `…100000`, `…100100`) |
| Erste Identität | `apps/api/scripts/platform-bootstrap.ts` |

## Umgebungen

`ORBIT_ENVIRONMENT` (`development|test|staging|production`, unbekannt = nie `production`) bindet Plattformsitzungen, Verbindungen, Routen und Nutzung. Eine Sitzung aus einer fremden Umgebung wird abgewiesen;
Verbindungen und Routen sind je Umgebung getrennt; Testzugänge wandern nie automatisch in Produktion.

## Noch nicht umgesetzt (Phasen)

OPS-3 (Connector-Lifecycle, Feature Flags, Kill Switches, Mandantenlebenszyklus, Plattformobergrenzen), OPS-4 (Queue-/Worker-Gesundheit, Laufsuche), OPS-5 (Support-Sessions), OPS-6 (Kostenlimits/Anomalien,
Abnahmebericht), Plattform-UI (`/platform/*`), MFA.
