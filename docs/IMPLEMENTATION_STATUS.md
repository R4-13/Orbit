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
| Docker Compose — voller Stack (Postgres/Redis/MinIO/API/Web/Worker) | LIVE TESTED | `docker compose build` + `docker compose up` für alle sechs Services live durchgespielt; `orbit-api`/`orbit-web` healthy und antworten über die echten Container-Ports. Sechs echte Build-/Runtime-Bugs gefunden & behoben (ASSUMPTIONS #41–#46, u. a. Dockerfiles auf `turbo prune` umgestellt). `orbit-worker` bootet korrekt, beendet sich aber erwartungsgemäß sofort (kein Queue-Consumer vor Phase 5/6) — für diese Session gestoppt. |
| Branding-Konfiguration (`@orbit/config`) | TESTED LOCALLY | Unit-Tests (`branding.spec.ts`) grün |
| Env-Validierung (Zod-Schema) | TESTED LOCALLY | Unit-Tests (`env.spec.ts`); echter Boolean-Parsing-Bug gefunden & behoben (ASSUMPTIONS #16) |
| Fehler-Typen (`@orbit/shared`) | TESTED LOCALLY | Unit-Tests (`errors.spec.ts`) grün |
| RBAC-Konstanten (Rollen/Permissions) | TESTED LOCALLY | Unit-Tests (`permissions.spec.ts`); Enforcement folgt Phase 3 |
| Policy-Engine-Konstanten (Default-Modi) | TESTED LOCALLY | Unit-Tests (`policy.spec.ts`); Engine-Logik folgt Phase 6 |
| Audit-Event-Typen | IMPLEMENTED | Persistenz folgt Phase 2/4 |
| ESLint-9-Flat-Config (Root + `apps/web`) | IMPLEMENTED | Fehlte in Phase 1 komplett, nachgezogen (ASSUMPTIONS #12) |
| API-Grundgerüst (NestJS, Health-Endpoint) | LIVE TESTED | E2E-Test + `docker compose`-Postgres grün; `pnpm run dev` real gestartet und per `curl` verifiziert. Dabei kritischen Laufzeit-Bug gefunden (Node konnte Workspace-Packages nicht laden) & behoben, siehe ASSUMPTIONS #39 |
| Worker-Grundgerüst | IMPLEMENTED | Queue-Prozessoren folgen Phase 5 |
| Web-Grundgerüst (Next.js, Tailwind) | TESTED LOCALLY | Typecheck/Lint grün; `next build` lokal unter Windows durch fehlende Symlink-Rechte blockiert (Docker-Build nicht betroffen, ASSUMPTIONS #17) |
| Prisma-Schema (vollständiges Datenmodell, 25 Modelle) | LIVE TESTED | `prisma migrate deploy` erfolgreich gegen echte Postgres-Instanz gelaufen (`docker-compose.dev.yml`); alle 25 Tabellen live angelegt |
| Tenant-Isolation (`@orbit/domain` `forTenant()` Prisma-Client-Extension) | LIVE TESTED | 10 Unit-Tests gegen die Query-Rewriting-Logik + live über `CasesService`/`AuditService` gegen echte DB bestätigt (Case-Erstellung, -Abfrage) |
| Auth/RBAC-Enforcement (JWT Login/Refresh/Logout, PermissionsGuard, Tenant-Bootstrap) | LIVE TESTED | 19 Unit-Tests; zusätzlich live: `TenantsService.bootstrapTenant()` + `POST /api/v1/auth/login` gegen echte DB → echtes JWT mit aus DB geladenen Rollen/Permissions; geschützte Route ohne Token → 401. Dabei doppeltes `v1`-Präfix in den Controller-Routen gefunden & behoben (ASSUMPTIONS #40) |
| Cases/Tasks/Documents/Audit-Module (CRUD + Permissions + Audit-Events + S3-Upload via presigned URLs) | TESTED LOCALLY | 13 Unit-Tests; Cases-CRUD + Audit-Log live gegen echte DB verifiziert (`POST /api/v1/cases` → `CASE_CREATED`-Eintrag). Document-Upload gegen echtes MinIO noch nicht live getestet. |
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
