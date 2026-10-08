# Plattformbetrieb (Amendment 03) — Abnahmebericht

Stand: 07.10.2026 · Spezifikationen: Amendment 03 v1 (Platform Operations, Administration, Diagnostics), Amendment 02 v1.2 (Adaptive Orchestration), Governance & Architecture Consistency v1.
Plan und Gap-Matrix: [`PLATFORM_OPERATIONS_IMPLEMENTATION_PLAN.md`](PLATFORM_OPERATIONS_IMPLEMENTATION_PLAN.md) (§8 enthält den Stand je Kriterium OPS-01…OPS-35).

## 1. Ehrliche Einordnung

| Ebene | Aussage |
|---|---|
| **Implementiert** | Plattform-Identität und -Sicherheitsgrenze, AI-Governance, Plattformsteuerung (Kill Switches, Mandanten-Gates, Feature Flags, Connector-Lebenszyklus), Support-Sessions, getrennte Business-/Diagnose-Projektion, zentrale Redaction, unveränderliches Plattform-Audit, Auflösungsleiter und `HumanInteractionRequest`-Projektion (Amendment 02 v1.2) |
| **Automatisiert getestet (TESTED LOCALLY)** | echte Postgres mit RLS, echte Guards/JWT-Domänen; Modell, Mail und zweiter KI-Anbieter sind Testdoubles (**TESTED WITH MOCK**) |
| **Live bewiesen (LIVE TESTED)** | siehe §5 — nur das, was im Docker-Stack tatsächlich durchlaufen wurde |
| **Externe Blocker** | echter Gmail-Versand (`gmail.send`-Zustimmung), zweiter echter KI-Anbieter (Zugangsdaten), MFA/WebAuthn-Dienst |
| **Nicht umgesetzt** | Plattform-UI zum Anlegen von KI-Anbietern, Modellen, Profilentwürfen und Plattformverbindungen (Übersicht, Mandanten inkl. Zustandsänderung, Feature-Flags, Support-Sitzungen mit Vier-Augen-Freigabe, KI-Routen und Profil-Veröffentlichung, Betreiberzugänge, Notschalter, Anbindungen, Audit sind umgesetzt, siehe [`PLATFORM_UI.md`](PLATFORM_UI.md)), MFA, Kostenlimits/Anomalie-Alarme, Diagnose-Export, `provision`/`offboard`/`close`-Abläufe, mandantenspezifische Region, Mandanten-Support-Historie |

Es gibt **keine Live-Validierung gegen einen Drittanbieter-Account** für die neuen Pfade.

## 2. Ergebnis je Arbeitspaket

| Paket | Inhalt | Status | Wesentliche Dateien | Tests |
|---|---|---|---|---|
| OPS-1 | getrennte Plattformidentität (`PLATFORM_JWT_SECRET`, `aud=orbit-platform`, `dom=PLATFORM`), Sitzungen je Request geprüft, Rollen/Scopes aus der DB, Step-up per Re-Auth, absolute Sitzungsdauer, rotierende Refresh-Tokens, Plattform-Audit (unveränderlich per Trigger) | COMPLETE | `apps/api/src/platform/{auth,identity,audit}`, `packages/shared/src/platform.ts`, Migrationen `20261006080000/080100` | `platform-security-boundary` (26), `platform-identity.spec` |
| OPS-2 | AI-Governance: Register (Anbieter, Modelle, versionierte unveränderliche Profile, Routen mit eindeutig aktiver Route, Plattformverbindungen mit `vault:`/`env:`-Referenzen), Health, Nutzung; Resolver mit BYOK ohne stillen Fallback, `AiProviderUnavailableError`, Env nur Bootstrap | COMPLETE (Mock) | `apps/api/src/{ai-governance,ai-providers,platform/ai}`, Migrationen `…100000/100100` | `platform-ai-governance` (17), `ai-provider-resolver.spec`, `ai-governance.spec` |
| OPS-3 | Plattformsteuerung: Kill Switches `ai.executions`, `external.autonomous_send`, `planner.adaptive`; Policy-Obergrenze (lockert nie); Mandanten-Gates LOGIN/AUTOMATION/CONNECTORS/BILLING/SECURITY_QUARANTINE (≤ 5 s Cache); Feature Flags (Mandant > Kohorte > Umgebung > Default, reservierte Schlüssel); Connector-Lebenszyklus als Overlay auf dem einen Katalog; bestätigungsgebundene Änderungen | COMPLETE | `apps/api/src/{platform-control,platform/control}`, `packages/shared/src/platform-control.ts`, Migration `…120000` | `platform-control` (17), `platform-control.spec` |
| OPS-4 | Diagnose: Business- und Diagnose-Projektion getrennt, Diagnose nur Plattform und mandantenscharf, zentrale Redaction | COMPLETE | `apps/api/src/platform/diagnostics`, `packages/shared/src/{redaction,process-schemas/orchestration-diagnostics}.ts` | `case-orchestration-view` (AD-15/16/17), `redaction.spec` |
| OPS-5 | Support-Sessions: begründet, befristet, keine Verlängerung, Vier-Augen für Payload-Scope, Prüfung bei jedem Aufruf, kein Impersonation-Pfad | COMPLETE | `apps/api/src/platform/support`, `packages/shared/src/support-session.ts`, Migration `…140000` | `platform-support-sessions` (14), `support-session.spec` |
| ADO | Adaptive Orchestrierung: Auflösungsleiter als `context.resolution_attempted` (BP-32), autonome Sachrückfrage (BP-33), Fortsetzung durch Antwort (BP-34), `HumanInteractionRequest` als Projektion (BP-35), zentrale Limits (BP-39), Abschlussbewertung `completion.evaluated` (BP-40) | COMPLETE (Rest siehe §4) | `packages/shared/src/process-schemas/{resolution,human-interaction}.ts`, `apps/api/src/process/human-interaction.service.ts`, `reference-process.tools.ts` | `adaptive-orchestration` (5), `resolution.spec` (9) |

Behobener Fehler am Rand: `WorkerModule` brach beim Start ab (fehlende Abhängigkeit zur Plattformsteuerung); `PlatformControlModule` wird jetzt importiert, der Tenant-Teil läuft in `TenantFeaturesModule`.

## 3. Governance-Konformität

* **Ein Besitzer je Verantwortung:** Audit nutzt `AuditLog` (Domäne `PLATFORM`), Connector-Lebenszyklus das bestehende `CONNECTOR_REGISTRY`, Policy bleibt bei `DISABLED/SUGGEST_ONLY/REQUIRE_APPROVAL/AUTONOMOUS`, PostgreSQL ist die einzige Quelle der Wahrheit. `HumanInteractionRequest` und `ContextResolutionAttempt` sind Projektion bzw. `CaseEvent` — keine neuen Tabellen.
* **Neue Entitäten begründet:** `docs/SPEC_GOVERNANCE_INDEX.md`, `docs/ASSUMPTIONS.md` (Zeilen 488–511).
* **Plattform lockert nie:** Obergrenzen wirken nur verschärfend (OCF-05, AD-08/09).

## 4. Offene Punkte (ehrlich)

| Punkt | Folge |
|---|---|
| Plattform-UI nur teilweise | Anlegen von KI-Anbietern/Modellen/Profilentwürfen/Plattformverbindungen nur über die API; Betreiberzugänge per `scripts/platform-bootstrap.ts` bzw. API |
| MFA/WebAuthn fehlt | Step-up ist Passwort-Re-Auth |
| BP-39 ohne Kostenlimit | Aktions-/Fehlerlimits und Abschlussbewertung (BP-40) sind umgesetzt; Kostenlimit fehlt (Kostenerfassung nötig) |
| OAS-05 und §29.5-Fälle | Diagnose-Export; Flag-Änderung während Rollout; Connector-Sperre während laufender Aktion; Worker-Neustart; Kill Switch + Replan gleichzeitig |
| OPS-12/13 | keine periodische Health-Prüfung, keine Kostenlimits/Anomalie-Alarme |
| OPS-15 | laufende Aktionen werden bei Connector-Sperre nicht aktiv beendet |
| OPS-27 | keine mandantenspezifische Region |

## 5. Verifikation

**Automatisiert (07.10.2026, TESTED LOCALLY):** `pnpm lint` 14/14 Tasks, Typecheck sauber, Unit (API 442, shared 145, agent-core 51, integration-core 32, ui 16, config 13, domain 10, web 40), API-E2E 38 Suiten / 306 Tests grün, Playwright 109 bestanden / 1 übersprungen (inkl. 15 Plattform-UI-Tests mit Betreiber-Zugang).
Befehle: `pnpm lint`, `pnpm -r exec tsc --noEmit`, `pnpm test`, API-E2E mit `set -a && source ../../.env && set +a`, `npx jest --config test/jest-e2e.json --runInBand` (Worker vorher stoppen; die Anmelde-Drosselung wird nur im Testprozess angehoben, `apps/api/test/utils/e2e-env.ts` — sonst summierte sie sich über Suiten und führte ab der Mitte zu 429).

**Live im Docker-Stack (LIVE TESTED, lokale Entwicklungsumgebung, Build nach Commit `52f8b81` plus Folgefixes):**

| Prüfung | Ergebnis |
|---|---|
| Images api/worker/web neu gebaut, Stack neu gestartet | API healthy, Worker ohne DI-Fehler gestartet |
| Plattform-Owner per `scripts/platform-bootstrap.ts` (Passwort aus der Umgebung, nicht ausgegeben) | angelegt |
| `POST /platform/auth/login` | 200, Rollen/Scopes aus der DB, Umgebung `development` |
| `GET /platform/{me,overview,tenants,audit,features,kill-switches,connectors,ai/*}` | 200; Audit enthält den Login |
| Domänengrenze | Plattformroute ohne Token 401; Plattform-Token an Mandantenroute 401 |
| KI-Register | leer → ehrlich ENV_BOOTSTRAP (Adapter `anthropic`, `openai` registriert) |

**Nicht live bewiesen:** schreibende Plattformoperationen (Step-up, Kill-Switch-Umschaltung, Support-Session) gegen den Docker-Stack — dafür gilt der automatisierte Nachweis; echter zweiter KI-Anbieter; echter Gmail-Versand.

**Beim Live-Lauf gefundene und behobene Fehler:**

1. Web-Build brach ab: `@orbit/shared` zog `node:crypto` (Rollout-Bucket, Bestätigungs-Token) in das Browser-Bundle. Ersetzt durch browserfähiges SHA-256 (`sha256.ts`, gegen `node:crypto` getestet).
2. `/integrations` zeigte den rohen Fehlercode `TOKEN_REFRESH_FAILED`. Neu: `integrationErrorLabel` (unbekannte Codes erscheinen nie roh).
