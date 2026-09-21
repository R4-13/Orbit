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
| Connector-Interfaces + Mocks (Finance/Mail/Calendar/CRM/Telephony) | TESTED WITH MOCK | 20 Unit-Tests gegen alle fünf Mock-Connectoren grün. Reale Provider-Implementierungen (DATEV/Lexware/Microsoft/Gmail/HubSpot/Twilio) — **REQUIRES PROVIDER CREDENTIALS**, siehe docs/INTEGRATIONS.md |
| Agent Runtime / LLMProvider / Tool Registry (LLMProvider inkl. echtem Anthropic-Adapter, Zod-validierte Tool Registry, Policy-Engine-Entscheidungslogik, AgentRuntime-Orchestrierungsschleife) | TESTED WITH MOCK | 20 Unit-Tests grün (inkl. Policy-Enforcement: REQUIRE_APPROVAL/DISABLED verhindern Tool-Ausführung). `AnthropicLLMProvider` gegen echte API nicht getestet — **REQUIRES PROVIDER CREDENTIALS** (ANTHROPIC_API_KEY). Konkrete Agent-Personas/Tools folgen mit Phase 7/8. |
| Finance-Workflow (Rechnungseingang, OCR-Extraktion, Dublettenprüfung, Lieferantenabgleich mit Freigabe-Flow, Buchungsvorschlag, Freigabe, FiBu-Transfer) | LIVE TESTED | 21 neue Unit-Tests grün; kompletter Workflow live gegen echte Postgres+MinIO durchgespielt (Login → Supplier-Freigabe → Dokument-Upload → Rechnung → Buchungsvorschlag → Freigabe → Transfer korrekt mit 403 abgelehnt ohne Lieferant). Echte DATEV/Lexware-Anbindung weiterhin **REQUIRES PROVIDER CREDENTIALS**; echte OCR (Tesseract) NICHT BEGONNEN. |
| Sales-Workflow (Company/Contact-Anlage, Lead-Erzeugung inkl. Folgeaufgabe, Opportunity-Pipeline, Terminvorschläge/-bestätigung) | LIVE TESTED | 16 neue Unit-Tests grün; kompletter Workflow live gegen echte Postgres-Instanz durchgespielt (Company → Contact → Lead+Task → Terminvorschlag → Terminbestätigung). Echte HubSpot-/Kalender-Anbindung weiterhin **REQUIRES PROVIDER CREDENTIALS**. |
| Mail-/Kalender-Connectoren (real, Microsoft/Gmail/Google Calendar) | REQUIRES PROVIDER CREDENTIALS | Interface + Mock bereits seit Phase 5 fertig (`MailConnector`/`CalendarConnector`, siehe docs/INTEGRATIONS.md) und in Phase 8 produktiv genutzt (Terminvorschläge). Reale OAuth-Anbindung braucht `MICROSOFT_CLIENT_ID`/`GOOGLE_CLIENT_ID` etc. — kein Implementierungsrückstand, echter Zugangsdaten-Blocker. |
| CRM-Connector (real, HubSpot) | REQUIRES PROVIDER CREDENTIALS | Interface + Mock bereits seit Phase 5 fertig (`CrmConnector`) und in Phase 8 produktiv genutzt (Contacts/Companies/Leads). Reale Anbindung braucht `HUBSPOT_CLIENT_ID`/`HUBSPOT_CLIENT_SECRET`. |
| Telefonie-Connector (real, Twilio) | REQUIRES PROVIDER CREDENTIALS | Interface + Mock bereits seit Phase 5 fertig (`TelephonyConnector`), aber noch nicht in einen konkreten Workflow eingebunden (kein "Anruf → Lead"-Endpunkt bisher). Reale Anbindung braucht `TWILIO_ACCOUNT_SID` etc. |
| Frontend (Login, App-Shell/Navigation, Dashboard, Rechnungen inkl. Freigabe/Transfer, Lieferanten-Freigabe, Leads/Kontakte, Aufgaben, Freigaben-Übersicht) | LIVE TESTED | Vollständig manuell im Browser gegen echte API+DB verifiziert (Login bis Logout, inkl. Redirect-Schutz und Fehlerbehandlung). Automatisierte E2E-Tests (Playwright) noch offen — Phase 14. Inbox (E-Mail-Ansicht) nicht gebaut, da kein Mail-Connector-Workflow existiert (siehe Phase 9). |
| Demo-Daten (Musterwerk GmbH) | NICHT BEGONNEN | Phase 13 |
| Automatisierte Tests (Unit/Integration/E2E) | NICHT BEGONNEN | Phase 14 |
| Security Hardening | NICHT BEGONNEN | Phase 15 |
| Vollständige Dokumentation | TEILWEISE | Diese Datei + ASSUMPTIONS.md vorhanden |
| CI-Pipeline (GitHub Actions) | NICHT BEGONNEN | Wird mit Phase 1 abgeschlossen |

Diese Datei wird nach jeder Phase aktualisiert und dient als Grundlage für
den finalen `/docs/MVP_COMPLETION_REPORT.md`.
