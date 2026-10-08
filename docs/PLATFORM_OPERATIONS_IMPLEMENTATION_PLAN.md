# Platform Operations — Umsetzungsplan und Gap-Matrix (Amendment 03, Phase OPS-0)

Grundlage: `ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_03_PLATFORM_OPERATIONS_ADMINISTRATION_DIAGNOSTICS_v1.md` (06.10.2026) und
`ORBIT_SPECIFICATION_GOVERNANCE_AND_ARCHITECTURE_CONSISTENCY_v1.md`. Eigentümer-Abbildung: `SPEC_GOVERNANCE_INDEX.md`.
Der Audit wurde am 06.10.2026 gegen den Code durchgeführt (Schema `packages/domain/prisma/schema.prisma`, `apps/api/src/*`).
Status: COMPLETE / PARTIAL / MISSING / CONFLICTING / BLOCKED. Umsetzungsstände werden hier fortgeschrieben, der Abnahmebericht folgt in
`PLATFORM_OPERATIONS_ACCEPTANCE_REPORT.md`.

## 1. Befund in Kürze

* Es gibt **keine** Plattformidentität. Alle Nutzer (`User`) gehören zu genau einem Mandanten (`tenantId` Pflicht, RLS). Die Rolle `SYSTEM_ADMIN` ist eine
  **Mandantenrolle** (erhält `tenant.manage`), keine Betreiberrolle. JWT enthält `tenantId`; ein einziges Secret signiert alles.
* Die Spezifikation setzt ein **bestehendes `AIModelProfile`** voraus – es existiert nicht. Bestehend sind: `AIProviderConnection` (eine je Mandant, BYOK, freier
  Modellname), `AiProviderResolverService` (Mandant → Adapter, sonst globaler Env-Provider `LLM_PROVIDER`), Adapter für OpenAI/Anthropic/Mock.
* **Konflikt zu OAI-07/OPS-10:** ist eine BYOK-Verbindung nicht `CONNECTED`, fällt der Resolver **still** auf den Plattform-Provider zurück.
* Kein Feature-Flag-, Kill-Switch-, Support-Session-, Usage-/Kosten-, Provider-Health- oder Umgebungskonzept im Code.
* `AuditLog` ist rein mandantengebunden (`tenantId` Pflicht, RLS) – Platform-Ereignisse ohne Mandant sind nicht ablegbar.
* Der Tenant-Node-Detail-Endpunkt zeigt technische Informationen (interne Fehlercodes, den gekürzten Roh-Output des Schritts, Payload-Hash, Provider-Referenzen der Receipts, Versuchszähler) jedem Nutzer mit `case.read` (BP-43/OPS-19).
* Gut vorbereitet: Secret-Abstraktion (`CredentialVaultService`), Audit-Schreibpfad, Policy Engine, RLS-Muster, Case-/Event-Korrelation, Capability Registry.

## 2. Entscheidungen (ADR-Kurzform, auch in `ASSUMPTIONS.md`)

| ADR | Entscheidung | Begründung / Alternativen |
|---|---|---|
| OPS-A1 | Neue Tabellen `platform_users`, `platform_role_assignments`, `platform_sessions` für die Plattformidentität | `users.tenant_id` ist NOT NULL, `users` liegt unter Tenant-RLS und die E-Mail ist global eindeutig. Ein nullable `tenant_id` würde die RLS-Invariante („unset = kein Zugriff“) und die Bedeutung von `SYSTEM_ADMIN` aufweichen. Alternative „Plattformmandant“ verworfen: Tenant-Rollen/-Policies würden eine Plattform-Schein-Organisation erben. |
| OPS-A2 | Token-Domänentrennung: eigenes Secret `PLATFORM_JWT_SECRET`, Claims `dom=PLATFORM`, `aud=orbit-platform`, eigene Passport-Strategie, Sitzung wird bei **jedem** Request gegen `platform_sessions` geprüft (Widerruf wirkt sofort) | Ein Mandanten-Token kann auf Plattform-Routen nie gültig sein (andere Signatur) und umgekehrt. Kurze Lebensdauer (15 min) + rotierendes Refresh-Token + absolute Sitzungsgrenze. |
| OPS-A3 | `AuditLog` wird erweitert statt ein zweiter Audit-Store: `tenant_id` nullable, `domain` (`TENANT`/`PLATFORM`), `actor_platform_user_id`, `target_tenant_id` (ohne FK), `correlation_id`, `support_session_id`. RLS: Mandanten sehen ausschließlich `domain=TENANT` der eigenen `tenant_id`. Plattform-Zeilen sind per Trigger unveränderlich (kein UPDATE/DELETE) | Governance „kein konkurrierender Audit Store“. Kein FK/Cascade für Plattformzeilen, damit eine Mandantenlöschung (DSGVO-Cascade) Betreiber-Audit nicht vernichtet. |
| OPS-A4 | `platform_*`-Tabellen erhalten RLS mit `app.platform_scope='on'` (nur im Plattform-Zugriffspfad gesetzt) | Defense in Depth: ein vergessener Guard allein öffnet die Tabelle nicht für Mandantencode. |
| OPS-A5 | Step-up = erneute Passwortprüfung mit kurzlebigem Erhöhungsfenster; **kein** MFA | Ehrlich dokumentierte Lücke (Amendment 03 §3.2); Erweiterungsgrenze `authenticationAssurance` vorhanden, MFA/WebAuthn bleibt offen. |
| OPS-A6 | Neue Modelle `AIProviderDefinition`, `AIModelDefinition`, `AIModelProfile` (versioniert, veröffentlicht = unveränderlich), `AIProviderRoute`, `AIUsageRecord`, `AIProviderHealth` | Es existiert keine Struktur, die diese Verantwortung trägt (Governance 5.3). `AIProviderConnection` wird erweitert (`scope` PLATFORM/TENANT, Plattformverbindungen mandantenlos). |
| OPS-A7 | Umgebung (`development/test/staging/production`) kommt aus `NODE_ENV`/`ORBIT_ENVIRONMENT` und ist Pflichtbestandteil von Routen, Verbindungen und Flags | Test-/Prod-Leak vermeiden (OPS-26). |

## 3. Gap-Matrix OPS-01 … OPS-35

| ID | Anforderung (kurz) | Ist-Stand (Evidenz) | Status | Maßnahme | Phase |
|---|---|---|---|---|---|
| OPS-01 | getrennte Security Domains | nur Mandantenrollen (`Role.tenantId`); `SYSTEM_ADMIN` = Mandantenrolle | MISSING | Plattformidentität + Domänen-Token | OPS-1 |
| OPS-02 | Tenant Admin kann keine Platform-Rolle vergeben / Platform-API nutzen | es gibt noch keine Plattform-API; Rollenvergabe nur im Tenant-Bootstrap; Rollennamen nicht geschützt | PARTIAL | reservierter Präfix `PLATFORM_` (Validierung + DB-Check), Platform-Guard lehnt Mandanten-Token ab | OPS-1 |
| OPS-03 | serverseitig geschützte Platform-Routen | – | MISSING | `/api/v1/platform/*`, `PlatformAuthGuard` + Scope-Guard | OPS-1 |
| OPS-04 | Platform-Änderungen auditiert | `AuditLog` mandantengebunden | PARTIAL | AuditLog-Erweiterung (OPS-A3), `PlatformAuditService` | OPS-1 |
| OPS-05 | Provider Registry unabhängig vom Businesscode | `AIProviderKey`-Enum + `buildProviderAdapter()` | PARTIAL | `AIProviderDefinition` mit Lifecycle, Adapter über Registry | OPS-2 |
| OPS-06 | Model Registry + versionierte Profile | existiert nicht | MISSING | `AIModelDefinition`, `AIModelProfile` | OPS-2 |
| OPS-07 | Businesscode nutzt Profile statt Provider/Modellnamen | 7 Aufrufstellen nutzen `resolveForTenant()` → `LLMProvider` mit Modell aus Env/Verbindung | CONFLICTING | `AiProviderResolverService.resolveProfile(profile, tenant)`; Aufrufer auf Profile umstellen | OPS-2 |
| OPS-08 | Managed AI nutzt Platform Provider Connections | globaler Env-Provider (`LLM_PROVIDER`, `OPENAI_MODEL`) | PARTIAL | Plattformverbindungen in DB (Secret via Vault), Env nur als Bootstrap | OPS-2 |
| OPS-09 | BYOK tenantisoliert, nur freigegebene Provider/Profile | je Mandant eine Verbindung; `model` ist ein **freier String** | PARTIAL | Modellwahl gegen Registry validieren | OPS-2 |
| OPS-10 | kein stilles Cross-Provider-Fallback bei BYOK | Resolver fällt bei nicht verbundener BYOK-Verbindung **still auf Plattform** zurück | CONFLICTING | expliziter Mandanten-AI-Modus (`ORBIT_MANAGED`/`BYOK`), `NO_FALLBACK` Standard | OPS-2 |
| OPS-11 | Routenwechsel ohne Business-Umbau | – | MISSING | `AIProviderRoute` + Aktivierung mit Vorbedingungen | OPS-2 |
| OPS-12 | Health beeinflusst Routing | – | MISSING | `AIProviderHealth`, Circuit-Breaker-Signal im Resolver | OPS-2 |
| OPS-13 | Usage/Kosten messbar | `LLMProvider`-Antwort liefert keine Usage | MISSING | Adapter geben Usage zurück, `AIUsageRecord` | OPS-2/6 |
| OPS-14 | Connector-Definition auf Plattformebene | `IntegrationConnectorType`-Enum, `connector-operational-status.ts`; keine Versionen/Lifecycle | PARTIAL | `PlatformConnectorDefinition` (Lifecycle) über dem bestehenden Katalog | OPS-3 |
| OPS-15 | globale Sperre/Deprecation | – | MISSING | Lifecycle `SUSPENDED` wirkt im Connector-Status/Capability-Executability | OPS-3 |
| OPS-16 | Feature Flags Global/Env/Cohort/Tenant | keine | MISSING | `PlatformFeatureFlag` + Resolver | OPS-3 |
| OPS-17 | Security Controls nicht per Tenant-Config abschaltbar | Policy-Modi pro Mandant; keine Plattform-Obergrenze | PARTIAL | Präzedenz-Resolver (Plattform > Mandant) | OPS-3 |
| OPS-18 | Kill Switches | keine (nur Policy `DISABLED` je Mandant) | MISSING | `PlatformKillSwitch` serverseitig, wirkt auf neue Actions | OPS-3 |
| OPS-19 | Diagnostics ≠ Business-Projektion | Node-Detail liefert Fehlercodes, Roh-Output, Payload-Hash, Provider-Referenzen an `case.read` | PARTIAL | getrennte Projektionen/Endpunkte; Business entfernt Technikfelder | OPS-4 |
| OPS-20 | keine Secrets/Chain-of-Thought in Diagnostics | Redaction-Helfer vorhanden (`safeMessage`); CoT wird nicht gespeichert (zu belegen) | PARTIAL | zentrale Redaction + Test | OPS-4 |
| OPS-21 | Support nur über zeitbegrenzte Session | keine | MISSING | `PlatformSupportSession` | OPS-5 |
| OPS-22 | kein stilles Impersonation | – | MISSING | keine Impersonation-Tokens; Session-gebundene Lesepfade | OPS-5 |
| OPS-23 | Support-Zugriffe auditiert | – | MISSING | Audit je Zugriff | OPS-5 |
| OPS-24 | Konfigurationspräzedenz serverseitig | Policy Engine kennt Tenant-Policy + Blueprint-Constraints | PARTIAL | Plattformebene oberhalb ergänzen | OPS-3 |
| OPS-25 | Platform Security nicht lockerbar | – | MISSING | Test `Tenant/Blueprint/LLM können Plattformgrenze nicht lockern` | OPS-3 |
| OPS-26 | Umgebungstrennung | kein Umgebungsbegriff in Verbindungen/Flags | MISSING | `environment` an Platform-Entities | OPS-2/3 |
| OPS-27 | Region/Data Policy vor Providerwahl | – | MISSING | `DataPolicy` im Resolver | OPS-2 |
| OPS-28 | Schutz vor Stale Writes | Case-Commands nutzen `expectedCaseRevision` | PARTIAL | `version`-Spalte + `If-Match`/Version in allen Platform-PATCH | OPS-1..3 |
| OPS-29 | Tenant-UI nicht redesignen | UI v2 unverändert | COMPLETE | Regressionstest `ux-v2` bleibt grün | alle |
| OPS-30 | Wiederverwendung bestehender Komponenten | siehe Governance-Index | PARTIAL | umgesetzt je Phase | alle |
| OPS-31 | OPR/OAI/OCF/OAS-Tests | – | MISSING | automatisieren (API-E2E) | alle |
| OPS-32 | Tenant A/B-Isolation in Diagnostics/Support | RLS vorhanden | PARTIAL | Platform-Lesepfade mit explizitem Tenant-Scope + Test | OPS-4/5 |
| OPS-33 | minimale, begründete Datenzugriffe | – | MISSING | Support-Scopes, Redaction | OPS-4/5 |
| OPS-34 | Bericht trennt Implementierung/Test/Live/Blocker | – | MISSING | Abnahmebericht | OPS-6 |
| OPS-35 | Providerwechsel mit zwei Adaptern | OpenAI-, Anthropic-, Mock-Adapter existieren | PARTIAL | Contract-Test über Route-Umschaltung ohne Businesscodeänderung | OPS-2 |

## 4. Begründung neuer persistenter Entities (GOV-10)

| Entity | Warum kein bestehendes Modell | Source of Truth / Lifecycle-Owner | Retention | Scope | Indizes |
|---|---|---|---|---|---|
| `PlatformUser`, `PlatformRoleAssignment`, `PlatformSession` | `User` ist mandantengebunden (OPS-A1) | PostgreSQL / Platform-Identity-Administration | Sitzungen 30 Tage nach Ablauf bereinigbar, Zuweisungen dauerhaft (Historie durch `revokedAt`) | Plattform | `email` unique, `(platformUserId, role)` unique, `tokenHash` unique |
| `AIProviderDefinition`, `AIModelDefinition`, `AIModelProfile`, `AIProviderRoute` | keine vorhanden | PostgreSQL / Plattformbetrieb | dauerhaft (Versionen unveränderlich) | Plattform | `(providerKey)`, `(profileKey, version)` unique |
| `AIUsageRecord` | `AgentRun` führt keine Usage | PostgreSQL / AI-Resolver | 13 Monate, danach Aggregation (Partitionierung bei Volumen) | Mandant+Plattform | `(tenantId, createdAt)`, `(profileKey, createdAt)` |
| `AIProviderHealth` | – | PostgreSQL (aktuellster Stand je Provider/Modell) + Metriken | überschreibend, Verlauf als Metrik | Plattform | `(providerKey, modelRef)` unique |
| `PlatformConnectorDefinition` | Katalog nur als Enum | PostgreSQL / Plattformbetrieb | dauerhaft | Plattform | `(connectorKey, version)` unique |
| `PlatformFeatureFlag`, `PlatformKillSwitch` | keine | PostgreSQL / Release Management | Flags bis `RETIRED`, Switch-Historie im Audit | Plattform | `key` unique |
| `PlatformSupportSession` | keine | PostgreSQL / Support | dauerhaft (Audit-Nachweis) | Plattform → Mandant | `(tenantId, status)`, `(operatorUserId, status)` |

## 5. Phasen und Reihenfolge

| Phase | Inhalt | Abnahme (Tests) |
|---|---|---|
| OPS-0 | dieser Plan, Governance-Index, Gap-Matrix Amendment 02 v1.2 | Dokumente |
| OPS-1 | Plattformidentität, Domänen-Token, Guards, Rollenmatrix, Audit-Erweiterung, Step-up, Bootstrap-Skript | OPR-01…03, 07, 08; OAS-03; OPS-01…04 |
| OPS-4a | Business- vs. Diagnose-Projektion trennen (Sicherheitslücke im Tenant-Detail schließen) | AD-15/16, OPS-19/20 |
| OPS-2 | Provider-/Modell-Registry, Profile, Routen, Plattformverbindungen, BYOK ohne Stillfallback, Usage, Health | OAI-01…10, OPS-35 |
| OPS-3 | Connector-Lifecycle, Feature Flags, Kill Switches, Präzedenz, Tenant-Lifecycle | OCF-01…06 |
| OPS-4/5 | Diagnostik, Support Sessions | OPR-04…06, OAS-04/05 |
| OPS-6 | FinOps, Härtung, Abnahmebericht | gesamt |
| ADO-1…5 | Amendment 02 v1.2 (Resolution Ladder, Loop, Human Boundary, Completion, Projektionen) | AD-01…AD-18 |

## 6. Plattform-UI

Eigene Routen `/platform/*` in der Web-App mit eigener Anmeldung (`/platform/login`) und eigenem Auth-Kontext; keine Verlinkung aus der Mandantennavigation,
keine Änderung an Home, Navigation oder Sonde (OPS-29). Die UI folgt der API: erst wenn die serverseitigen Grenzen stehen, entstehen Seiten.

## 7. Offene externe Punkte

* UI/UX v2 Addendum 01 („Production Diagnostics Boundary“) wurde nicht mitgeliefert.
* MFA/WebAuthn: nicht Teil dieser Umsetzung (OPS-A5).
* Echte Zweitanbieter (z. B. Azure/Mistral): nur Mock-/Contract-Nachweis (OPS-35), keine Live-Credentials.


## 8. Umsetzungsstand je Kriterium (Stand 07.10.2026)

Legende: **COMPLETE** = serverseitig umgesetzt und automatisiert getestet · **PARTIAL** = Teil umgesetzt, Rest benannt · **MISSING** = nicht umgesetzt. Alle Nachweise sind **TESTED LOCALLY** (echte Postgres-Instanz mit RLS,
echte Guards); wo ein externer Anbieter beteiligt wäre, ist es **TESTED WITH MOCK** bzw. **REQUIRES PROVIDER CREDENTIALS**. Es gibt **keine Live-Validierung** gegen einen Drittanbieter-Account.

| ID | Status | Nachweis (Test) | Offener Rest |
|---|---|---|---|
| OPS-01 | COMPLETE | `platform-security-boundary` OPR-01/02/03, DB-Checks, Token-Fälschung | – |
| OPS-02 | COMPLETE | OPR-02/03 (Tenant-Admin an jeder Plattformroute abgewiesen, Rollen nur `PLATFORM_*`) | – |
| OPS-03 | COMPLETE (API), PARTIAL (UI) | alle `/platform/*`-Routen hinter `PlatformAuthGuard` + `PlatformScopeGuard`; Oberfläche `/platform/*` ([`PLATFORM_UI.md`](PLATFORM_UI.md)) mit Anmeldung, Übersicht, Mandanten, KI-Steuerung, Notschalter/Anbindungen, Audit; Playwright `platform.spec.ts` (9) + `platform-support` + `platform-ai` + `platform-identities` (je 1) | Anbieter/Modelle/Profilentwürfe/Plattformverbindungen anlegen nur per API |
| OPS-04 | COMPLETE | Audit je Änderung mit Vorher/Nachher/Begründung (Identität, AI, Flags, Switches, Connectoren, Mandanten, Support) | Typen für Sicherheitsrichtlinie noch ohne Auslöser |
| OPS-05 | COMPLETE | Adapter-Registry, `platform-ai-governance` | – |
| OPS-06 | COMPLETE | Modell-/Profilregister, Immutability-Trigger | – |
| OPS-07 | COMPLETE | alle Aufrufer nutzen Profile | `BUSINESS_DRAFTING` ohne Aufrufer |
| OPS-08 | COMPLETE | Plattformverbindungen + Resolver; Env nur Bootstrap | – |
| OPS-09 | PARTIAL | BYOK nur freigegebene Anbieter/Modelle (sobald Register gepflegt) | Profil-Fähigkeiten werden für BYOK-Modelle nicht geprüft |
| OPS-10 | COMPLETE | OAI-07/08 (Unit + E2E) | – |
| OPS-11 | COMPLETE | OAI-02/OPS-35 | – |
| OPS-12 | PARTIAL | Health aus echten Aufrufen + Notbremse beeinflusst Routing; **Queue-/Worker-Zustand** (`GET /platform/runtime`, Übersichtskarte): verbundene Worker, Zähler, Alter des ältesten wartenden Auftrags, Bewertung OK/Eingeschränkt/Steht still (`runtime-health.ts`, 4 Unit-, 3 E2E-Tests, live mit Worker an/aus belegt); **Arbeitsstand** (`GET /platform/runtime/work`, §16.2): offene/überfällige Erwartungen, geplante/fällige Wiederholungen, hängende Vorgänge (gleiches Kriterium wie der Sweep), Vorgänge in Prüfung, ungewisse Aktionen, fehlgeschlagene Schritte (24 h) – nur Zähler, `backlogAttention` meldet nur Hängendes und Ungewisses; **Referenzsuche** (`GET /platform/diagnostics/search`, §16.1): Vorgangs-/Plan-/Aktions-/Lauf-/Support-Sitzungs-ID → Mandant und Vorgang, begründet und auditiert, ohne Inhalte (2 Unit-, 3 E2E-, 2 Playwright-Tests) | keine aktive periodische Prüfung der KI-Anbieter (würde echte Aufrufe kosten); die Suche kennt nur Kennungen, keine Freitext- oder Fachsuche (bewusst: keine Inhalte) |
| OPS-13 | COMPLETE | Usage je Mandant/Profil/Anbieter/Modell, Kosten nur mit Kostenprofil; **Kosten-Leitplanken**: Warnschwelle, Soft- und Hard-Limit je Plattform/Mandant/Profil (Monat, UTC), Durchsetzung des Hard-Limits nur auf ausdrückliche Konfiguration als ehrlicher Block (`COST_LIMIT_HARD`, nie für BYOK), Alarme bei Limit-Wechsel und bei ungewöhnlicher Nutzung (Audit `PLATFORM_COST_ALERT` + optionaler Webhook); Shared 6 Unit-, Resolver 4 Unit-, E2E 7, Playwright 1 | Kosten ohne Kostenprofil bleiben unbekannt (getrennt ausgewiesen); nur eine Währung je Limit; Limits sind monatlich (keine Tages-/Wochenfenster) |
| OPS-14 | COMPLETE | Overlay auf dem einen Katalog | Mehrversionen je Connector |
| OPS-15 | PARTIAL | OCF-01 (neue Verbindungen/Aktionen gesperrt, verständlicher Status) | laufende Aktionen werden nicht aktiv beendet |
| OPS-16 | COMPLETE | Global/Umgebung/Kohorte/Mandant (OCF-03/04) | – |
| OPS-17 | COMPLETE | reservierte Schlüssel, Policy-Obergrenze (OCF-05) | – |
| OPS-18 | COMPLETE | drei Kill Switches mit Durchsetzung (OCF-05/06) | feinere Schalter über vorhandene Mittel abgebildet |
| OPS-19 | COMPLETE | Business-/Diagnose-Projektion getrennt (AD-15/16/17) | – |
| OPS-20 | COMPLETE | zentrale Redaction, keine Payloads in der Diagnose | – |
| OPS-21 | COMPLETE | OPR-04…07 (Support-Sessions) | – |
| OPS-22 | COMPLETE | kein Impersonation-Pfad, `ASSISTED_ACTION` nicht verfügbar | – |
| OPS-23 | COMPLETE | Audit je Anforderung/Freigabe/Zugriff/Schließen | – |
| OPS-24 | PARTIAL | Präzedenz für AI, Policy, Connectoren, Sperren umgesetzt | Blueprint-/Agent-Ebene nicht eigens getestet |
| OPS-25 | PARTIAL | Mandant kann Plattformobergrenze nicht lockern (getestet für Policy/Kill Switch) | Blueprint/LLM-Fälle nicht eigens getestet |
| OPS-26 | PARTIAL | Sitzungen, Verbindungen, Routen, Nutzung, Flags umgebungsgebunden | nicht alle Konfigurationen |
| OPS-27 | PARTIAL | Region/Datenrichtlinie vor Modellwahl | keine mandantenspezifische Region |
| OPS-28 | COMPLETE | `expectedVersion` überall, Konkurrenztests (Route, Flag, Modell, Verbindung, Session) | – |
| OPS-29 | COMPLETE | Mandanten-UI unverändert bis auf entfallene technische Felder im Knotenpanel | – |
| OPS-30 | COMPLETE | Governance-Index | – |
| OPS-31 | COMPLETE (bis auf Prozess-Neustart) | OPR-01…08, OAI-01…10, OCF-01…06, OAS-01…05 (Diagnose-Export: Datei, Step-up, ohne Secrets, Prüfsumme im Audit) automatisiert; §29.5: Flag-Änderung während Rollout (Unit, wachsender Rollout ohne Flackern), Connector-Sperre während offener Freigabe (E2E), Notschalter + Neuplanung (E2E, fand und behob einen echten Fehler, Annahme 535) | echter Neustart des Worker-Prozesses mitten im Vorgang nicht automatisiert (nur Sweep-Wiederaufnahme AD-13 und Live-Test mit gestopptem Worker) |
| OPS-32 | COMPLETE | Diagnose/Support mandantenscharf, gleiche 404-Antwort | – |
| OPS-33 | COMPLETE | begründete, auditierte, minimierte Zugriffe | – |
| OPS-34 | COMPLETE | `PLATFORM_OPERATIONS_ACCEPTANCE_REPORT.md` | – |
| OPS-35 | COMPLETE (TESTED WITH MOCK) | zwei registrierte Adapter, Providerwechsel ohne Businesscode | kein zweiter echter Anbieter mit Zugangsdaten |

**Nicht umgesetzt:** Plattform-UI zum Anlegen von Anbietern, Modellen, Profilentwürfen und Plattformverbindungen (lesende Seiten, Flags, Support-Sitzungen, KI-Routen/Profil-Veröffentlichung, Betreiberzugänge, Notschalter und Anbindungen sind umgesetzt), MFA/WebAuthn, `provision`/`offboard`/`close` als Abläufe, Mandanten-Support-Historie.
