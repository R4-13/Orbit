# Implementation Status

Legende (siehe §63 des Master-Prompts):

- `IMPLEMENTED` — Code vorhanden, folgt der Zielarchitektur
- `TESTED LOCALLY` — manuell lokal ausgeführt/verifiziert
- `TESTED WITH MOCK` — automatisierte Tests gegen Mock-Connector grün
- `LIVE TESTED` — gegen echtes Drittsystem mit echten Credentials getestet
- `REQUIRES PROVIDER CREDENTIALS` — kann ohne externe Zugangsdaten nicht live getestet werden

| Komponente | Status | Anmerkung |
|---|---|---|
| Monorepo-Struktur (pnpm + Turborepo) | TESTED LOCALLY | `pnpm install` lokal verifiziert (siehe ASSUMPTIONS #11) |
| Docker Compose (Postgres/Redis/MinIO/API/Web/Worker) | IMPLEMENTED | Healthchecks vorhanden; `docker compose up` in dieser Sandbox nicht verifizierbar (kein Docker verfügbar) |
| Branding-Konfiguration (`@orbit/config`) | TESTED LOCALLY | Unit-Tests (`branding.spec.ts`) grün |
| Env-Validierung (Zod-Schema) | TESTED LOCALLY | Unit-Tests (`env.spec.ts`); echter Boolean-Parsing-Bug gefunden & behoben (ASSUMPTIONS #16) |
| Fehler-Typen (`@orbit/shared`) | TESTED LOCALLY | Unit-Tests (`errors.spec.ts`) grün |
| RBAC-Konstanten (Rollen/Permissions) | TESTED LOCALLY | Unit-Tests (`permissions.spec.ts`); Enforcement folgt Phase 3 |
| Policy-Engine-Konstanten (Default-Modi) | TESTED LOCALLY | Unit-Tests (`policy.spec.ts`); Engine-Logik folgt Phase 6 |
| Audit-Event-Typen | IMPLEMENTED | Persistenz folgt Phase 2/4 |
| ESLint-9-Flat-Config (Root + `apps/web`) | IMPLEMENTED | Fehlte in Phase 1 komplett, nachgezogen (ASSUMPTIONS #12) |
| API-Grundgerüst (NestJS, Health-Endpoint) | TESTED LOCALLY | E2E-Test gegen `/api/v1/health` + `/health/ready` grün (`apps/api/test/app.e2e-spec.ts`) |
| Worker-Grundgerüst | IMPLEMENTED | Queue-Prozessoren folgen Phase 5 |
| Web-Grundgerüst (Next.js, Tailwind) | TESTED LOCALLY | Typecheck/Lint grün; `next build` lokal unter Windows durch fehlende Symlink-Rechte blockiert (Docker-Build nicht betroffen, ASSUMPTIONS #17) |
| Prisma-Schema (vollständiges Datenmodell, 25 Modelle) | IMPLEMENTED | Schema validiert (`prisma validate`) + Client generiert (`prisma generate`); initiale Migration erzeugt (siehe ASSUMPTIONS #20). Live-Migration gegen echte Postgres-Instanz noch offen (kein Docker in dieser Sandbox) — **REQUIRES DOCKER/POSTGRES** |
| Tenant-Isolation (`@orbit/domain` `forTenant()` Prisma-Client-Extension) | TESTED LOCALLY | 10 Unit-Tests (`tenant-scope.spec.ts`) gegen die reine Query-Rewriting-Logik; End-to-End gegen echte DB noch offen |
| Auth/RBAC-Enforcement (JWT Login/Refresh/Logout, PermissionsGuard, Tenant-Bootstrap) | TESTED LOCALLY | 19 Unit-Tests (`auth.service.spec.ts`, `permissions.guard.spec.ts`, `tenants.service.spec.ts`) gegen gemockten Prisma-Client; E2E-Login-Flow gegen echte DB noch offen — **REQUIRES DOCKER/POSTGRES** |
| Cases/Tasks/Documents/Audit-Module (CRUD + Permissions + Audit-Events + S3-Upload via presigned URLs) | TESTED LOCALLY | 13 neue Unit-Tests gegen gemockten Prisma-/Storage-Client; echter Lauf gegen MinIO + Postgres steht noch aus — **REQUIRES DOCKER/POSTGRES** |
| Connector-Interfaces + Mocks | NICHT BEGONNEN | Phase 5 |
| Agent Runtime / LLMProvider / Tool Registry | NICHT BEGONNEN | Phase 6 |
| Finance-Workflow | NICHT BEGONNEN | Phase 7 |
| Sales-Workflow | NICHT BEGONNEN | Phase 8 |
| Mail-/Kalender-Connectoren | NICHT BEGONNEN | Phase 9 |
| CRM-Connector (HubSpot) | NICHT BEGONNEN | Phase 10 |
| Telefonie-Connector (Twilio) | NICHT BEGONNEN | Phase 11 |
| Frontend-Seiten (Dashboard, Inbox, Finance, Sales, ...) | NICHT BEGONNEN | Phase 12 |
| Demo-Daten (Musterwerk GmbH) | NICHT BEGONNEN | Phase 13 |
| Automatisierte Tests (Unit/Integration/E2E) | NICHT BEGONNEN | Phase 14 |
| Security Hardening | NICHT BEGONNEN | Phase 15 |
| Vollständige Dokumentation | TEILWEISE | Diese Datei + ASSUMPTIONS.md vorhanden |
| CI-Pipeline (GitHub Actions) | NICHT BEGONNEN | Wird mit Phase 1 abgeschlossen |

Diese Datei wird nach jeder Phase aktualisiert und dient als Grundlage für
den finalen `/docs/MVP_COMPLETION_REPORT.md`.
