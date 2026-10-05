# Spezifikations-Statusübersicht

Stand: 2026-10-05, Commit `2cb74e4` (plus diese Doku-Änderung). Diese Datei ist die Gesamtsicht über alle Spezifikationen
und Pläne. Sie ersetzt keine Detaildokumente, sondern verweist auf sie. Die Statuslegende ist die aus
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md): `IMPLEMENTED` / `TESTED LOCALLY` / `TESTED WITH MOCK` /
`LIVE TESTED` / `REQUIRES PROVIDER CREDENTIALS`. „Live“ heißt: im laufenden Docker-Stack gegen echte Infrastruktur
nachgewiesen. Steht dabei „simuliert“, war der Mailversand nicht echt.

## Überblick

| Spezifikation | Detaildokumente | Stand | Offen |
|---|---|---|---|
| **Master-Entwicklungsprompt (66 Abschnitte, MVP)** | `PRODUCT_CONTEXT.md`, `MASTER_SPEC_GAP_ANALYSIS.md`, `MVP_COMPLETION_REPORT.md` | Weitgehend umgesetzt und live: Multi-Tenancy mit Row-Level-Security, Auth/RBAC, Finance- und Sales-Workflow, vollständiges Frontend, Security-Hardening, DSGVO-Admin, Policy-Administration, CI | Reale Finance-, CRM-, Kalender- und Telefonie-Connectoren (nur Mock), echte OCR, CI nie auf echtem GitHub-Runner geprüft |
| **Unified Evolution Concept (Phasen 0–12)** | `ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md`, `ORBIT_UNIFIED_EVOLUTION_CONCEPT.md` | Phasen 1–4 fertig: Durable Workflows mit Approval-Resume, Operational Hardening (Metriken, Logging, Tenant-Concurrency, Failed-Work-Retry, Retention-Grundlage), Agent Governance, LLM-Provider-Plattform. Phasen 5–9 (Sonde) fertig | Phase 10 (Sonde Delegation), Phase 11 nur teilweise, Phase 12 (Lasttests) nur teilweise |
| **ORBIT Master Specification V3 (Delta-Plan)** | `ORBIT_MASTER_IMPLEMENTATION_PLAN.md`, `ORBIT_MASTER_SPECIFICATION.md` | §63 Phase 1–3 fertig, Phase 4–5 teilweise, Sonde (Phase 6–10) bis auf DELEGATE umgesetzt | Volles 8-Zustands-Agent-Lifecycle, Model-Profile, Usage-Metering, Provider-Health, Fallback-Policy, Plattform-Admin-Ansicht, Evaluationslauf-Historie, generische Connector-Idempotenz-Keys |
| **Sonde Concept** | `SONDE_CONCEPT.md` (der alte `SONDE_IMPLEMENTATION_PLAN.md` ist überholt) | Konversations-Fundament, ASK, SSE-Streaming, PREPARE (3 Tools), ACT (4 Tools, `send_email` nur mit Freigabe), Vorschlags-Chips, Global-Questions-Tools, Vorgangskontext im Case (nur lesend). Live mit `gpt-6-luna` | DELEGATE-Modus, Action-Cards mit Bestätigen-Button, `prepare_follow_up`, `message.delta`-Token-Streaming, Command-Ausführung durch Sonde |
| **ORION UI/UX Specification v1** | `ORION_UI_UX_DEVELOPMENT_SPECIFICATION_v1.md` | UI-1 Design-Tokens, UI-2 Tenant-Branding (Admin-Seite, Logo-Upload), UI-3 App-Shell, UI-4 Home-Dashboard, UI-6 Modul-Konsistenz, UI-7 Fehlerzustände, Responsive-Härtung, sortierbare Tabellen, Diagramme. Live im Browser und per Playwright | UI-5 und UI-8, axe-/Screenreader-Audit, visuelle Regressionstests, SVG-Logo, automatische Kontrast-Validierung |
| **Amendment 01 v2 (Integration Framework)** | `INTEGRATION_FRAMEWORK_PHASE1_PLAN.md`, `INTEGRATIONS.md`, `GOOGLE_INTEGRATION.md` | **Phase 1 fertig** (Increments A–E): Credential-Vault mit AES-256-GCM, statische Connector-Registry mit 7 Connectoren, generischer OAuth2-Service, echter Gmail-Connector, UI ohne JSON. Lesen gegen ein echtes Google-Konto live bewiesen | **Phase 2** nur teilweise (Registry, Capability-Modell und strukturierte Formulare vorhanden; Health-Monitoring, Connector-Versionierung und Registry-Administration nicht geprüft). **Phase 3** (Sonde Guided Setup, Systemlandkarte) laut Doku nicht begonnen. Weitere echte Connectoren fehlen |
| **Channel Event Runtime (Nutzervorgabe)** | `CHANNEL_EVENT_RUNTIME_PLAN.md` | Increments A–E, G und H fertig: normalisierte Intake-Events, Triage, Poll-Adapter, Sync-Queue, Finance/Sales über die Durable Workflow Engine, 5-stufige Betriebsstatus-Sicht. Sales-Pfad live: echte Mail wurde automatisch zu Case, Lead und Kontakt | **Increment F**: Finance-Pfad nicht live bewiesen (Testkonto ohne echte Rechnungsmail mit Anhang) |
| **Amendment 02 Rev 1.1 (Prozess-Orchestrierung, Case-Graph)** | `BUSINESS_PROCESS_FRAMEWORK_IMPLEMENTATION_PLAN.md`, `BUSINESS_PROCESS_FRAMEWORK.md`, `PROCESS_BLUEPRINT_SCHEMA.md`, `CASE_ORCHESTRATION_UI.md`, `CASE_CORRELATION_AND_RESUME.md` | Alle 30 Kriterien implementiert und automatisiert getestet. Drei Referenzpfade live mit `gpt-6-luna`, **Versand simuliert**. Playwright-Abnahme der Oberfläche 5/5 | **Echter Gmail-Versand** (braucht die `gmail.send`-Zustimmung des Nutzers), Preisquelle ist ein Test-Datenbestand, kein unabhängiger Triage-Holdout, Anhangsinhalte nicht in der Triage |

## Amendment 02 nach Kriterien

Die vollständige Tabelle mit den drei Spalten „implementiert / automatisiert getestet / live“ steht in
[`BUSINESS_PROCESS_FRAMEWORK_IMPLEMENTATION_PLAN.md`](BUSINESS_PROCESS_FRAMEWORK_IMPLEMENTATION_PLAN.md) §5.

- **Live, mit simuliertem Versand:** BP-01 bis 03, 06, 08 bis 17, 26. BP-11 und BP-13 sind ohne Versand live belegt.
- **Nur automatisiert getestet:** BP-04, 05, 19 bis 22, 24, 25, 28, 29. BP-21 (unbekannter Versandausgang) lässt sich live nicht erzwingen.
- **Teilweise live:** BP-23, BP-27 (nur der Teil aus Gate G).
- **Blockiert:** BP-07, echter Gmail-Versand.
- **Dokumentation:** BP-30.

## Externe Blocker (nicht fälschen, nur dokumentieren)

| Blocker | Betrifft | Was nötig ist |
|---|---|---|
| Gmail-Sendeberechtigung | Amendment 02 BP-07/08 (echter Versand, echte Antwort-Mail) | Zustimmung unter Integrationen → „Sendeberechtigung erteilen“ und `OUTBOUND_MAIL_MODE=gmail` in `.env.runtime.local` |
| DATEV, Lexware | Finance-Systeme | Partner-/OAuth-Registrierung (`DATEV_INTEGRATION.md`) |
| Microsoft 365, Google Calendar | Mail-/Kalender-Connectoren | Client-IDs und Zustimmung |
| HubSpot | CRM | Client-ID und Secret |
| Twilio | Telefonie | Account-SID und Token; außerdem noch kein Workflow „Anruf → Lead“ |
| Echte Finance-Rechnungsmail | Channel Event Runtime Increment F | Eine Rechnung mit Anhang im Testpostfach |

## Wichtige Eigenheiten für Tests und Betrieb

- **LLM:** Die Container laufen mit `gpt-6-luna` und `OPENAI_REASONING_EFFORT=none`, sonst lehnt Chat Completions Funktions-Tools ab. Die Konfiguration liegt in der gitignorierten `.env.llm.local`. Host und Tests nutzen `LLM_PROVIDER=mock`.
- **BYOK-Adapter:** Sie senden `reasoning_effort` nicht mit. Das ist offen.
- **E2E-Lauf:** `source .env`, `--runInBand` und vorher `docker stop orbit-worker`. Der Sweep des Docker-Workers bearbeitet sonst Testmandanten in derselben Datenbank.
- **Demo-Mandant:** `musterwerk` hat den Referenz-Blueprint aktiv. Die Legacy-Intake-Suite pausiert das selbst.
- **Nicht ausführen:** `pnpm prisma:seed` auf der geteilten Datenbank.

## Teststand (2026-10-05)

| Ebene | Ergebnis |
|---|---|
| Unit | API 409, `@orbit/shared` 60, `@orbit/agent-core` 51, `@orbit/config` 11, `@orbit/domain` 10, Web 5 |
| API-E2E | 30 Suiten / 194 Tests (Worker gestoppt) |
| Playwright Orchestrierung | 5/5 |
| Lint / Typecheck / Docker-Build | grün |

## Pflege

Nach jeder Phase `IMPLEMENTATION_STATUS.md` ergänzen und diese Übersicht anpassen. Die Roadmap-Tabelle in
`ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md` wurde am 2026-10-05 an den tatsächlichen Stand angeglichen.
