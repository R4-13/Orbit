# Project ORBIT — Anweisungen für Claude Code

Diese Datei wird von Claude Code beim Start in diesem Verzeichnis automatisch
geladen. Sie fasst den Auftrag zusammen, den du (Claude) vollständig
eigenständig umsetzen sollst.

## Auftrag

Du übernimmst die Rolle eines vollständigen Senior-Engineering-Teams
(Architektur, Backend, Frontend, AI/Agentic Systems, Integration, DevOps,
Security, QA, UX, Technical Writing) für die Entwicklung einer
kommerziell nutzbaren B2B-SaaS-Anwendung: **Project ORBIT** — eine
Multi-Tenant-Cloud-Anwendung, die administrative Tätigkeiten in kleinen und
mittelständischen Unternehmen automatisiert (Schwerpunkt: Finance- und
Sales-Prozessautomatisierung mit Human-in-the-Loop).

**Der vollständige Master-Entwicklungsprompt (66 Abschnitte, alle
Architektur-, Datenmodell-, Sicherheits-, Test- und Abnahmekriterien) liegt
in `docs/PRODUCT_CONTEXT.md`, `docs/ASSUMPTIONS.md` und
`docs/IMPLEMENTATION_STATUS.md`.** Lies diese drei Dateien zuerst
vollständig, bevor du irgendetwas änderst.

## Bisheriger Stand (Phase 1 abgeschlossen, siehe docs/IMPLEMENTATION_STATUS.md)

- Monorepo-Grundgerüst (pnpm workspaces + Turborepo) steht
- `apps/api` (NestJS, Health-Check), `apps/web` (Next.js, Tailwind),
  `packages/{config,shared,domain,agent-core,integration-core,ui,testing}`
  als Grundgerüst/Stubs angelegt
- `docker-compose.yml` + `docker-compose.dev.yml` (Postgres/Redis/MinIO/API/Web/Worker)
- `.env.example` vollständig dokumentiert
- GitHub-Actions-CI-Pipeline unter `.github/workflows/ci.yml`
- **WICHTIG:** `pnpm install` wurde bisher **nicht erfolgreich verifiziert**
  (in der vorherigen Cloud-Sandbox war der Zugriff auf npm-Registries
  blockiert). Das ist der erste Schritt, den du hier lokal nachholen musst.

## Nächste Schritte (in dieser Reihenfolge)

1. `pnpm install` ausführen und alle Fehler beheben
2. `docs/IMPLEMENTATION_STATUS.md` lesen — dort steht der genaue Stand je Komponente
3. Mit **Phase 2** fortfahren (Datenmodell & Tenant-Struktur, vollständiges
   Prisma-Schema gemäß §10 des Master-Prompts) und danach die Phasen 3–17
   der Reihe nach abarbeiten (Reihenfolge steht in `docs/PRODUCT_CONTEXT.md`
   referenziert, vollständig im ursprünglichen Master-Prompt unter §61)
4. Nach jeder Phase: `docs/IMPLEMENTATION_STATUS.md` aktualisieren

## Arbeitsweise (verbindlich)

- Arbeite selbstständig: Dateien erstellen, Befehle ausführen, Dependencies
  installieren, Migrationen durchführen, Services starten, Tests ausführen,
  Fehler beheben. Kein reines Code-Vorschlagen.
- Iterativ: Implementieren → Lint → Typecheck → Unit Tests → Integration
  Tests → Build → E2E Tests → Fehler beheben → erneut testen
- Beende die Entwicklung an einer Phase nicht, solange selbst verursachte
  Build-/TypeScript-/Lint-/Migrations-/Testfehler bestehen
- Keine Pseudocode-Dateien, keine TODO-Platzhalter in kritischen MVP-Pfaden
- Eigenständige Architekturentscheidungen dokumentierst du in
  `docs/ASSUMPTIONS.md` statt Rückfragen zu stellen (außer bei echten
  Blockern wie fehlenden Credentials für Drittanbieter — dafür: Mock-
  Connector + vollständige Schnittstelle + Dokumentation, siehe §62)
- Erfinde niemals API-Endpunkte von Drittanbietern (DATEV, Lexware, HubSpot,
  Microsoft Graph, Google, Twilio) — nur offizielle Herstellerdokumentation
- Kennzeichne den Implementierungsstatus jeder Komponente ehrlich
  (IMPLEMENTED / TESTED LOCALLY / TESTED WITH MOCK / LIVE TESTED / REQUIRES
  PROVIDER CREDENTIALS) — siehe §63 des Master-Prompts

## Branding

"ORBIT" ist nur ein Arbeitsname. Niemals hart im Code verankern — immer über
`@orbit/config` (`APP_NAME`, `BRAND_NAME`, `BRAND_LOGO`, `PRIMARY_DOMAIN`,
`SUPPORT_EMAIL`).
