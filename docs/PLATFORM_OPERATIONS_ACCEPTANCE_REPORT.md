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
| **Nicht umgesetzt** | Plattform-UI (`/platform/*` im Web), MFA, Kostenlimits/Anomalie-Alarme, Queue-/Worker-Gesundheit, Diagnose-Export, `provision`/`offboard`/`close`-Abläufe, mandantenspezifische Region, Mandanten-Support-Historie |

Es gibt **keine Live-Validierung gegen einen Drittanbieter-Account** für die neuen Pfade.

## 2. Ergebnis je Arbeitspaket

| Paket | Inhalt | Status | Wesentliche Dateien | Tests |
|---|---|---|---|---|
| OPS-1 | getrennte Plattformidentität (`PLATFORM_JWT_SECRET`, `aud=orbit-platform`, `dom=PLATFORM`), Sitzungen je Request geprüft, Rollen/Scopes aus der DB, Step-up per Re-Auth, absolute Sitzungsdauer, rotierende Refresh-Tokens, Plattform-Audit (unveränderlich per Trigger) | COMPLETE | `apps/api/src/platform/{auth,identity,audit}`, `packages/shared/src/platform.ts`, Migrationen `20261006080000/080100` | `platform-security-boundary` (26), `platform-identity.spec` |
| OPS-2 | AI-Governance: Register (Anbieter, Modelle, versionierte unveränderliche Profile, Routen mit eindeutig aktiver Route, Plattformverbindungen mit `vault:`/`env:`-Referenzen), Health, Nutzung; Resolver mit BYOK ohne stillen Fallback, `AiProviderUnavailableError`, Env nur Bootstrap | COMPLETE (Mock) | `apps/api/src/{ai-governance,ai-providers,platform/ai}`, Migrationen `…100000/100100` | `platform-ai-governance` (17), `ai-provider-resolver.spec`, `ai-governance.spec` |
| OPS-3 | Plattformsteuerung: Kill Switches `ai.executions`, `external.autonomous_send`, `planner.adaptive`; Policy-Obergrenze (lockert nie); Mandanten-Gates LOGIN/AUTOMATION/CONNECTORS/BILLING/SECURITY_QUARANTINE (≤ 5 s Cache); Feature Flags (Mandant > Kohorte > Umgebung > Default, reservierte Schlüssel); Connector-Lebenszyklus als Overlay auf dem einen Katalog; bestätigungsgebundene Änderungen | COMPLETE | `apps/api/src/{platform-control,platform/control}`, `packages/shared/src/platform-control.ts`, Migration `…120000` | `platform-control` (17), `platform-control.spec` |
| OPS-4 | Diagnose: Business- und Diagnose-Projektion getrennt, Diagnose nur Plattform und mandantenscharf, zentrale Redaction | COMPLETE | `apps/api/src/platform/diagnostics`, `packages/shared/src/{redaction,process-schemas/orchestration-diagnostics}.ts` | `case-orchestration-view` (AD-15/16/17), `redaction.spec` |
| OPS-5 | Support-Sessions: begründet, befristet, keine Verlängerung, Vier-Augen für Payload-Scope, Prüfung bei jedem Aufruf, kein Impersonation-Pfad | COMPLETE | `apps/api/src/platform/support`, `packages/shared/src/support-session.ts`, Migration `…140000` | `platform-support-sessions` (14), `support-session.spec` |
| ADO | Adaptive Orchestrierung: Auflösungsleiter als `context.resolution_attempted` (BP-32), autonome Sachrückfrage (BP-33), Fortsetzung durch Antwort (BP-34), `HumanInteractionRequest` als Projektion (BP-35) | COMPLETE (Rest siehe §4) | `packages/shared/src/process-schemas/{resolution,human-interaction}.ts`, `apps/api/src/process/human-interaction.service.ts`, `reference-process.tools.ts` | `adaptive-orchestration` (5), `resolution.spec` (9) |

Behobener Fehler am Rand: `WorkerModule` brach beim Start ab (fehlende Abhängigkeit zur Plattformsteuerung); `PlatformControlModule` wird jetzt importiert, der Tenant-Teil läuft in `TenantFeaturesModule`.

## 3. Governance-Konformität

* **Ein Besitzer je Verantwortung:** Audit nutzt `AuditLog` (Domäne `PLATFORM`), Connector-Lebenszyklus das bestehende `CONNECTOR_REGISTRY`, Policy bleibt bei `DISABLED/SUGGEST_ONLY/REQUIRE_APPROVAL/AUTONOMOUS`, PostgreSQL ist die einzige Quelle der Wahrheit. `HumanInteractionRequest` und `ContextResolutionAttempt` sind Projektion bzw. `CaseEvent` — keine neuen Tabellen.
* **Neue Entitäten begründet:** `docs/SPEC_GOVERNANCE_INDEX.md`, `docs/ASSUMPTIONS.md` (Zeilen 488–511).
* **Plattform lockert nie:** Obergrenzen wirken nur verschärfend (OCF-05, AD-08/09).

## 4. Offene Punkte (ehrlich)

| Punkt | Folge |
|---|---|
| Plattform-UI fehlt | Bedienung nur über API/Skript (`scripts/platform-bootstrap.ts`) |
| MFA/WebAuthn fehlt | Step-up ist Passwort-Re-Auth |
| BP-39/BP-40 teilweise | Limits `maxActionsPerCase`, `maxConsecutiveCapabilityFailures`, Kosten; kein `CompletionEvaluation`-Snapshot |
| OAS-05 und §29.5-Fälle | Diagnose-Export; Flag-Änderung während Rollout; Connector-Sperre während laufender Aktion; Worker-Neustart; Kill Switch + Replan gleichzeitig |
| OPS-12/13 | keine periodische Health-Prüfung, keine Kostenlimits/Anomalie-Alarme |
| OPS-15 | laufende Aktionen werden bei Connector-Sperre nicht aktiv beendet |
| OPS-27 | keine mandantenspezifische Region |

## 5. Verifikation

Siehe Abschnitt „Teststand“ in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) (Zeile „Plattformbetrieb“). Befehle: `pnpm lint`, `pnpm -r exec tsc --noEmit`, `pnpm test`, API-E2E mit `set -a && source ../../.env && set +a`, `npx jest --config test/jest-e2e.json --runInBand` (Worker vorher stoppen).
