# ORBIT Master Implementation Plan — Delta gegen ORBIT_MASTER_SPECIFICATION (V3, 2026-09-27)

Dieses Dokument ist die von `docs/ORBIT_MASTER_SPECIFICATION.md` §0/§63/§68 geforderte
Gap-Analyse: für jede Anforderung der neuen, jetzt maßgeblichen Master-Spezifikation
(die `docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md` und ältere Konzeptdokumente laut deren
eigenem §0 ablöst) wird der tatsächliche Ist-Zustand des Repositories klassifiziert.

Klassifikation (§63 des Master-Dokuments):

- `ALREADY_COMPLETE` — erfüllt, live/E2E verifiziert
- `PARTIAL` — teilweise vorhanden, konkrete Lücke benannt
- `MISSING` — nicht vorhanden
- `BLOCKED_BY_EXTERNAL_CREDENTIALS` — strukturell vorhanden, echter Live-Test fehlt mangels Zugangsdaten

Erstellt autonom am 2026-09-27, direkt im Anschluss an die eigenständig abgeschlossenen
Phasen "Retention-Grundlage", "Agent Governance" (Prompt-Layering/Injection-Boundary/
Evaluation Framework) und "LLM Provider Platform" (siehe `docs/IMPLEMENTATION_STATUS.md`
und `docs/ASSUMPTIONS.md` #200-262) — diese drei Phasen erfüllen bereits große Teile der
Backend-Anforderungen §63 Phase 1-5 dieser neuen Spezifikation, siehe unten.

## Zuordnung: bereits erledigte Phasen (diese Session) → §63-Phasen der neuen Spezifikation

| §63-Phase (neu) | Inhalt | Status | Nachweis |
|---|---|---|---|
| Phase 1 — Durable Workflow Engine | Persistierter Workflow-State, Versionierung, Approval-Resume, Workflow-Events, idempotente Schritte, Retry, Restart-Recovery | `ALREADY_COMPLETE` (Restart-Recovery via BullMQ-Persistenz, kein expliziter "Prozess-Crash-mitten-im-Schritt"-Idempotenz-Key-Mechanismus über reine Approval-Resume-Fälle hinaus — siehe unten) | `docs/IMPLEMENTATION_STATUS.md` Phase 1 (ORBIT Unified Evolution), `docs/ASSUMPTIONS.md` #200-209 |
| Phase 2 — Approval Integration | Genehmigung → automatische Fortsetzung; Ablehnung → Reject-Zweig | `ALREADY_COMPLETE` | `workflow-approval-resume.e2e-spec.ts`, ASSUMPTIONS #200-209 |
| Phase 3 — Operational Hardening | Strukturiertes Logging, Metriken, Failed-Job-Operationen, Tenant-Concurrency, Retention-Grundlage | `ALREADY_COMPLETE` | `docs/IMPLEMENTATION_STATUS.md` "Operational Hardening: …" (4 Teile + Retention-Grundlage), ASSUMPTIONS #210-243 |
| Phase 4 — Agent Governance | Lifecycle, Published-Immutability, Prompt-Layering, Evaluation-Framework, Regressionssuiten | `PARTIAL` — Prompt-Layering ✅, Injection-Boundary ✅, Evaluation-Framework ✅; das volle 8-Zustands-Lifecycle (`VALIDATING/TESTING/STAGED/PUBLISHED/SUSPENDED/DEPRECATED/ARCHIVED`) bewusst **nicht** umgesetzt (bestehendes DRAFT/ACTIVE/DISABLED-Tripel + Evaluation-Gate als funktionaler Ersatz) | `docs/IMPLEMENTATION_STATUS.md` "Agent Governance: …", ASSUMPTIONS #244-253 |
| Phase 5 — Multi-Provider AI Platform | Provider-Registry, Anthropic-/OpenAI-Adapter, Mock, Connection-Modell, Credential-Typ-Modell, ORBIT-Managed, BYOK, Admin-UI, Connection-Test, Model-Profile, Usage-Metering, Provider-Health, Fallback-Policy | `PARTIAL` — Registry/Anthropic/OpenAI/Mock-Adapter ✅, `AIProviderConnection`+BYOK+Admin-UI+Connection-Test ✅ (live gegen echten Anthropic-Endpunkt bewiesen); Model-Profile-Registry, Usage-Metering, Provider-Health-Historie, explizite Fallback-Policy-Engine **fehlen** | `docs/IMPLEMENTATION_STATUS.md` "LLM Provider Platform", ASSUMPTIONS #254-262 |

**Ergebnis:** §63 Phase 1-5 sind im Kern bereits erledigt. Der Rest dieses Dokuments
fokussiert auf die tatsächlich offenen Bereiche: den Feinschliff von Phase 4/5, und —
das mit Abstand größte neue Delta — **Phase 6-11 (Sonde) und die komplette
UI/UX-Spezifikation**, die beide bisher nicht existieren.

## Bekannte, bereits dokumentierte Lücken innerhalb Phase 1-5 (nicht neu, aber hier zur Vollständigkeit aufgeführt)

| # | Lücke | Klassifikation | Referenz |
|---|---|---|---|
| 1 | Generische Connector-Idempotenz-Keys (jenseits des bereits gelösten Approval-Resume-Falls) | `PARTIAL` | ASSUMPTIONS (Phase 1, ursprüngliche Einschränkung) |
| 2 | Agent-Lifecycle: volles 8-Zustands-Modell | `MISSING` (bewusst) | ASSUMPTIONS #253 |
| 3 | ~~`WorkflowRunnerService.buildWorkflowStepMessage()` — Untrusted-Content-Wrapping~~ | ✅ `DONE` | ASSUMPTIONS #327-329 |
| 4 | Evaluationslauf-Historie (nur Fall-Definitionen persistiert, keine Lauf-Ergebnisse über Zeit) | `MISSING` (bewusst) | ASSUMPTIONS #252 |
| 5 | `AIModelProfile`/Model-Lifecycle-Registry, `AIUsageRecord`, `AIProviderHealth`, Fallback-Policy-Engine | `MISSING` (bewusst) | ASSUMPTIONS #262 |
| 6 | Separate Plattform-Admin-Ansicht `/admin/platform/ai` | `MISSING` (bewusst) | ASSUMPTIONS #262 |

Fünf der ursprünglich sechs Punkte bleiben offen, sind aber jeweils klein und in sich abgeschlossen —
niedrigere Priorität als die beiden folgenden großen Blöcke.

---

## A. Backend-Delta: Sonde (§25-33 des Master-Dokuments, §63 Phase 6-11)

Vollständig `MISSING`. Kein `CopilotModule`, `ConversationModule`, `ContextModule`,
keine `Conversation`/`ConversationMessage`/`ConversationSummary`/`ConversationContext`/
`ConversationAction`/`ConversationReference`-Modelle, keine `/api/v1/copilot/*`-Routen,
kein SSE-Streaming. Bestätigt per Repository-Grep (keine Treffer für „Sonde"/„Copilot"/
„Conversation" in `apps/api/src` oder `packages/domain/prisma/schema.prisma` außerhalb
unabhängiger Zufallstreffer).

| Baustein | Status | Priorität diese Session |
|---|---|---|
| `Conversation`/`ConversationMessage`-Datenmodell (§29) | `MISSING` | Hoch — Fundament für alles Weitere |
| `POST/GET /copilot/conversations`, `.../messages` (§33) | `MISSING` | Hoch |
| Streaming (SSE, `message.delta`/`tool.started`/…) (§33) | `MISSING` | Mittel — nach synchronem Pfad |
| Context Providers (`InvoiceContextProvider` etc.) (§30) | `MISSING` | Mittel |
| ASK-Modus (reine Lesefähigkeiten) (§26) | `MISSING` | Hoch — kleinster sicherer erster Schnitt |
| PREPARE/ACT/DELEGATE-Modi (§26) | `MISSING` | Niedrig diese Session (baut auf ASK auf) |
| Sonde-Tool-Zugriffsschnitt (§32) | `MISSING` | Mittel |

**Entscheidung dieser Session:** Phase 6 (Conversation-Fundament) + ein funktionsfähiger,
echter ASK-Modus (nicht simuliert) werden begonnen, sofern nach dem UI/UX-Block B Budget
verbleibt — siehe Priorisierung unten. Ein Sonde-Panel ohne echtes Backend wäre nach §33
der UI/UX-Spezifikation ausdrücklich unzulässig ("must not simulate functionality that
does not exist" / Klassifikation `MOCK/DEMO` darf nie als `LIVE` erscheinen).

---

## B. UI/UX-Delta (ORION_UI_UX_DEVELOPMENT_SPECIFICATION v1)

Audit-Ergebnis (Phase UI-0, durchgeführt): aktueller Zustand geprüft in
`apps/web/src/app/(app)/layout.tsx`, `.../dashboard/page.tsx`, `apps/web/tailwind.config.ts`,
`apps/web/src/app/globals.css`, `packages/config/src/branding.ts`, `packages/domain/prisma/schema.prisma`.

| Baustein | Ist-Zustand | Status |
|---|---|---|
| Design-Tokens (`--brand-primary`, `--status-*`, …) | Nur ein einzelner hartkodierter `brand`-Tailwind-Farbwert (`#2563eb`), keine CSS-Custom-Properties, keine Status-Token, keine Nav-Token | `MISSING` |
| Tenant-Branding (Logo/Farben pro Tenant, DB-persistiert) | `packages/config/src/branding.ts` existiert, ist aber **prozessweit envgesteuert, nicht pro Tenant, nicht laufzeit-/DB-konfigurierbar** — erfüllt nicht §5/§27 (kein `TenantBranding`-Modell, keine Admin-UI, keine Live-Vorschau) | `PARTIAL` (Basis-Branding-Konzept ✅, Tenant-Persistenz+Admin-UI ✅ fehlt) |
| Application Shell (3-Regionen-Layout, dunkle Navy-Sidebar, Header mit Suche/Profil) | Aktuelle Sidebar ist weiß, ohne Icons, ohne Logo-Bild, ohne Header-Leiste; keine Sonde-Panel-Region überhaupt vorhanden | `MISSING` |
| Navigationsreihenfolge exakt wie §2 der UI-Spec (`Home/Inbox/Finance/Sales/Approvals/Tasks/Cases/Activity/Integrations/Administration`) | Aktuelle Reihenfolge weicht ab (`Übersicht/Posteingang/Vorgänge/Activity/Finance…/Sales…/Aufgaben/Freigaben/Administration…`), Finance/Sales sind Untergruppen mit Unterpunkten statt einzelner Top-Level-Einträge | `PARTIAL` |
| Home-Dashboard exakte Komposition (5 KPI-Karten, Unified-Inbox-Karte, Finance-/Sales-Übersicht, Approvals-/Activity-Vorschau) | Aktuelles `/dashboard` zeigt nur 3 schlichte Zähler-Karten ohne Icons/Trends, keine Unified-Inbox-Karte, keine Finance-/Sales-Übersichtskarten, keine Approvals-/Activity-Vorschau | `MISSING` |
| Sonde-Panel (rechte Spalte, Modus-Auswahl, Action Cards, Composer) | Nicht vorhanden (folgt aus Backend-Delta A) | `MISSING` |
| Responsive/Accessibility-Härtung, visuelle Regressionstests | Nicht geprüft/nicht vorhanden | `MISSING` |

**Wichtiger Hinweis gemäß UI-Spec §0:** Das mitgelieferte Referenz-Mockup enthält
Demo-Zeilen (z. B. „HR System — Mitarbeiterdokument", „Personal"-Badge), die **keine**
Entsprechung im Master-Dokument haben. Per ausdrücklicher Anweisung der UI-Spec
("Do not create an HR module… Replace such sample content with Finance, Sales, Approval,
Task, Case or Activity examples") werden solche Zeilen bei der Umsetzung durch
unterstützte Domänen ersetzt, nicht wörtlich übernommen.

---

## Priorisierung dieser Session (eigenständig, in Abarbeitungsreihenfolge)

Kriterium: größter demonstrierbarer Nutzen pro investiertem Aufwand, kleinste Blast-Radius
pro Schritt, jede Stufe einzeln lint-/typecheck-/testverifiziert und committet — exakt das
in dieser Session bereits etablierte Vorgehen (siehe `docs/IMPLEMENTATION_STATUS.md`).

1. ✅ **UI-1 — Design-Tokens & Standard-ORION-Theme.** Erledigt — CSS-Custom-Properties
   in `apps/web/src/app/globals.css` + Tailwind-Mapping.
2. ✅/🔶 **UI-2 — Tenant-Branding.** Backend vollständig erledigt (Modell/API/RLS/
   E2E-Tests) — Admin-UI-Seite mit Live-Vorschau noch offen (siehe unten).
3. ✅ **UI-3 — Application Shell.** Erledigt — dunkle Navy-Sidebar mit echten Icons,
   exakte Navigationsreihenfolge, Header-Leiste, Sonde-Panel-Platzhalter. Live im
   Browser + per Playwright-E2E-Suite (9/10, ein vorbestehender umgebungsbedingter
   Fehlschlag) verifiziert. Details: `docs/IMPLEMENTATION_STATUS.md`,
   `docs/ASSUMPTIONS.md` #263-268.
4. ✅ **UI-4 — Home-Dashboard.** Erledigt — 5 KPI-Karten (echte, client-aggregierte
   Daten), Unified-Inbox-Karte, Finance-/Sales-Übersichtskarten, Approvals-/
   Activity-Vorschau. Live im Browser + per Playwright-E2E-Suite verifiziert (eine
   echte Regression in `auth.spec.ts` dabei gefunden und behoben). Details:
   `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #269-273.
5. ✅ **Branding-Admin-Seite** (`/admin/branding`, Rest von UI-2). Erledigt — damit
   ist UI-2 vollständig abgeschlossen. Live verifiziert, inkl. einer echten,
   dokumentierten Permission-Provisionierungslücke (siehe `docs/ASSUMPTIONS.md`
   #275). Details: `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #274-275.
6. ✅ **Sonde Phase 6 (Backend-Fundament) + echter ASK-Modus.** Erledigt (Backend) —
   `Conversation`/`ConversationMessage`-Modelle, drei lesende Sonde-Tools über die
   geteilte `ToolRegistry`, neue Policy-Action `copilot.read`, vollständiger
   `CopilotModule`-Verdrahtungspfad über den echten `AgentRuntime` (kein
   Sonderpfad), 17 Unit- + 9 E2E-Tests, live gegen den laufenden Docker-Stack und
   den Musterwerk-Demo-Tenant verifiziert (inkl. desselben Policy-Provisionierungs-
   Nachtrags-Musters wie bei #275). **Noch offen**: SSE-Streaming (Phase 8),
   PREPARE/ACT/DELEGATE-Modi, das eigentliche Frontend-Wiring des `SondePanel`
   (zeigt weiterhin den ehrlichen Platzhalter aus UI-3 — kein UI-Panel ohne dieses
   Fundament, siehe Begründung oben). Details: `docs/IMPLEMENTATION_STATUS.md`,
   `docs/ASSUMPTIONS.md` #276-283.
7. ✅ **`SondePanel`-Frontend-Wiring.** Erledigt — der Platzhalter aus UI-3 ist durch
   eine echte Konversations-UI gegen `/copilot/*` ersetzt (Liste/Anlegen/Senden/
   Löschen, kein Streaming). Live im Browser (echter Roundtrip über den Musterwerk-
   Demo-Tenant, History übersteht Reload) + per Playwright-E2E-Suite verifiziert
   (9/10, derselbe vorbestehende `ENOTFOUND minio`-Fehlschlag). Dabei zwei echte,
   live gefundene Bugs behoben (React-Query-Key-Präfixkollision, Lösch-Race).
   Details: `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #284-286.
8. ✅ **Sonde Phase 8 — SSE-Streaming.** Erledigt — `POST .../messages/stream`
   emittiert `tool.started`/`tool.completed`/`message.completed`/`error` in
   Echtzeit (kein `message.delta`, siehe `docs/ASSUMPTIONS.md` #287), geteilte
   `runAskTurn()`-Implementierung mit dem synchronen Phase-7-Pfad. Live gegen
   den laufenden Docker-Stack + Musterwerk-Demo-Tenant verifiziert (echter SSE-
   Roundtrip im Netzwerk-Log), 5 neue Tests, Playwright-Suite erneut grün
   (9/10, derselbe vorbestehende `ENOTFOUND minio`-Fehlschlag). Ein echter,
   live gefundener Bug behoben (Default-Statuscode 201 statt 200 bei `@Res()`).
   Details: `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #287-293.
9. ✅ **Sonde Phase 9 — PREPARE-Modus.** Erledigt — drei PREPARE-Tools
   (`draft_email`/`create_meeting`/`create_booking_proposal`) in Sondes
   Tool-Subset, bewusst **wiederverwendet** statt neu geschrieben (dieselben,
   bereits getesteten `SalesAgentTools`/`FinanceAgentTools`-Objekte, keine
   neue Policy-Action nötig). `GET /copilot/capabilities` liefert jetzt
   `{ modes: ['ASK','PREPARE'], tools: [...] }`. Live gegen den laufenden
   Docker-Stack + Musterwerk-Demo-Tenant verifiziert, 3 neue/aktualisierte
   Tests (2 davon E2E mit echten, über Sonde erzeugten `EmailMessage`/
   `BookingProposal`-Zeilen), Playwright-Suite erneut grün (9/10, derselbe
   vorbestehende `ENOTFOUND minio`-Fehlschlag). Details:
   `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #294-298.
10. ✅ **Sonde Phase 10 — ACT-Modus.** Erledigt — vier ACT-Tools
    (`create_task`/`create_contact`/`create_lead`/`send_email`) in Sondes
    Tool-Subset, wieder bewusst **wiederverwendet**. `send_email` bleibt
    `REQUIRE_APPROVAL` — der Mail-Connector läuft nie, Sonde erzeugt
    stattdessen eine echte Freigabeanfrage (der live getestete Beweis für
    §27). `GET /copilot/capabilities` liefert jetzt
    `{ modes: ['ASK','PREPARE','ACT'], tools: [...10] }`. Details:
    `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #299-301.
11. ✅ **UI/UX-Bugfix: Sidebar-Text-Kontrast.** Vom Nutzer gemeldeter echter
    Bug behoben — app-weite Tailwind-Opacity-Modifier-Lücke bei CSS-Variablen
    im falschen Format (Hex statt Kanal-Format), betraf Sidebar-Untermenüs,
    Icon-Badges und Button-Hover-Zustände. Details:
    `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #302-303.
12. ✅ **UI/UX: Sortierbare Tabellen.** Erledigt — neuer `useSortableList()`/
    `SortableTh`-Baustein in `packages/ui`, auf neun Datenlisten-Seiten
    angewendet (Rechnungen, Lieferanten, Leads, Kontakte, Opportunities,
    Vorgänge, Aufgaben, Freigaben, Posteingang, Nutzerverwaltung). Live
    verifiziert (echte Sortierung per Browser-JS geprüft, nicht nur
    optisch), 8 neue Unit-Tests. Details: `docs/IMPLEMENTATION_STATUS.md`,
    `docs/ASSUMPTIONS.md` #304-309.
13. ✅ **UI/UX: Logo-Datei-Upload.** Erledigt — echter Datei-Upload (PNG/
    JPEG/WebP, presigned URL, anonym lesbarer `public/`-Bucket-Präfix)
    statt nur einer Text-URL. Dabei einen echten, vorbestehenden
    Infrastruktur-Bug behoben (`S3_PUBLIC_ENDPOINT`), der auch die
    bestehenden Dokumenten-Uploads betraf — Nebeneffekt: die volle
    Playwright-Suite läuft jetzt 12/12 statt 9/10 (der alte `ENOTFOUND
    minio`-Fehlschlag ist tatsächlich behoben, nicht nur umgangen). Live
    auf drei Ebenen verifiziert (Jest-E2E, Browser-Konsole, Playwright
    `setInputFiles()`). Details: `docs/IMPLEMENTATION_STATUS.md`,
    `docs/ASSUMPTIONS.md` #310-314.
14. ✅ **UI/UX: Echte Diagramme statt Zahlen-Kacheln.** Erledigt — zwei neue,
    abhängigkeitsfreie Diagramm-Komponenten (`DonutChart`/`TrendBarChart`,
    bewusst keine Chart-Bibliothek) auf dem Home-Dashboard: Finance-/
    Sales-Status-Donuts, Activity-Trend-Balkendiagramm (letzte 7 Tage).
    Live mit echten Musterwerk-Demo-Daten verifiziert, 4 neue Unit-Tests.
    Details: `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #315-319.
15. ✅ **UI/UX: Responsive/Accessibility-Härtung (App-Shell).** Erledigt —
    echten, vorbestehenden Mobile-Bug behoben (Sidebar unterhalb ~480px
    nahezu viewport-füllend, nicht einklappbar). Sidebar jetzt unterhalb
    `md:` (768px) eine Slide-in-Drawer mit Backdrop (schließt bei
    Routenwechsel/Escape), neuer Hamburger-Button im Header. Sonde-Panel
    unterhalb `lg:` (1024px) ein Vollbild-Overlay statt eines seitlichen
    400px-Panels — beim eigenen Tablet-Test (768px) einen zweiten echten
    Bug gefunden (Sidebar+Sonde quetschten den Hauptinhalt bei `md:` als
    Umschaltpunkt auf ~144px) und durch den `lg:`-Umschaltpunkt behoben.
    `AppHeader` blendet Suchfeld/Glocke/E-Mail/Logout-Text stufenweise
    ein. Live an drei Breakpoints verifiziert (375px/768px/1440px), volle
    Playwright-Suite weiterhin 12/12 grün. Bewusst nicht umgesetzt:
    automatisierter Accessibility-Audit (axe-core, vollständige
    Tastatur-Navigation, Screenreader-Test). Details:
    `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #320-326.
16. ✅ **Backend-Härtung: wrapUntrustedContent() auf Workflow-Step-
    Nachrichten.** Erledigt — schließt die in §63-Lückenliste Punkt 3
    (ASSUMPTIONS #246) offen gelassene Folgearbeit. Ganze Schritt-
    Nachricht wird jetzt unconditional gewrapped (nicht feldweise), da
    `inputMapping` grundsätzlich rohen Tool-Output eines vorherigen
    Schritts übernehmen kann. 1 neuer + 2 angepasste Unit-Tests, volle
    API-Unit- (271) und API-E2E-Suite (100) grün. **Echter Nebenfund bei
    der Verifikation**: drei volle E2E-Läufe kurz hintereinander lösten
    den echten Redis-Rate-Limiter selbst aus (429-Kaskade über fast
    alle Suiten) — keine Regression, nach Leeren der `throttler:*`-Keys
    sofort wieder 100/100 grün. Details: `docs/IMPLEMENTATION_STATUS.md`,
    `docs/ASSUMPTIONS.md` #327-329.
17. ✅ **UI/UX: Gap-Analyse gegen ORION-Referenz-Mockup + Umsetzung der drei
    frontend-seitig bounded Punkte.** Nutzer lieferte ein Referenz-Mockup
    und bat um eine Gap-Analyse gegen die echte UI. Ergebnis priorisiert
    nach "frontend-only, kein Backend-Change" zuerst: (1) `WorkflowTimeline`
    + `SegmentedBar` — zwei neue, abhängigkeitsfreie `packages/ui`-
    Komponenten, Finance-Dashboard-Card, echter Invoice-Status-Funnel statt
    erfundener Pro-Stufen-Zeitstempel; (2) Sales-Kontakttabelle auf dem
    Dashboard statt schlichter Liste, neuer `use-meetings.ts`-Hook
    (konsumiert bestehenden Endpunkt), bewusst kein erfundenes "Hot/Warm"-
    Lead-Temperatur-Feld; (3) Unified-Inbox-Tabellenspalten (Fall/Workflow-
    Status/Zugewiesener Agent/Menschl. Aktion), alle client-seitig gejoint,
    kein Backend-Change, bewusst keine "Quelle"-Spalte (nur ein Kanal
    existiert aktuell). Alle drei Schritte einzeln live verifiziert, voller
    Workspace-Typecheck/Lint grün, Playwright durchgehend 12/12 (derselbe
    vorbestehende `sales.spec.ts`-Flake dreimal bestätigt, keine Regression).
    **Bewusst nicht umgesetzt** (größerer, separat zu scopender Aufwand):
    Sonde-"Vorgeschlagene Aktionen" — braucht eine neue Backend-Fähigkeit,
    die proaktiv entscheidet, was vorgeschlagen wird, nicht nur UI-Markup.
    Details: `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #332-346.
18. ✅ **Sonde: Vorschlags-Chips + Global-Questions-Tools.** Erledigt —
    Scoping ergab: automatisch eingeblendete Vorschlagskarten wie im
    Mockup widersprechen `docs/SONDE_CONCEPT.md` §27 ("Do not
    automatically interrupt users with unsolicited messages in MVP").
    Stattdessen umgesetzt: anklickbare Vorschlags-Chips im Composer
    (senden erst bei Klick) + zwei neue ASK-Tools
    (`list_overdue_tasks`/`list_failed_agent_runs`), die §28s "Global
    Questions"-Dienste komplettieren. **Dabei ein echter NestJS-DI-
    Zyklus-Bug gefunden** (`TOOL_REGISTRY` → `SondeTools` →
    `AgentRunRecorderService` → `TOOL_REGISTRY`), der beim Bootstrap hing
    statt zu werfen — 90 von 100 E2E-Tests fielen dadurch aus. Kein Code
    committet, bis Ursache gefunden (direkter `PrismaService`-Zugriff
    statt `AgentRunRecorderService`) und durch einen vollständigen,
    grünen E2E-Lauf (20/20, 100/100) bestätigt war. Details:
    `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #347-350.
19. **Nächster Schritt** (offen, nach eigener Priorisierung) — alle vom
    Nutzer in dieser Session angefragten UI/UX-Punkte sind jetzt
    abgeschlossen (Sidebar-Kontrast, sortierbare Tabellen, Logo-Upload,
    Diagramme, Responsive-Härtung, Mockup-Gap-Analyse, Sonde-
    Vorschlags-Chips). Weiter mit UI-5/UI-6/UI-7/UI-8 (Modul-Konsistenz,
    feinere Accessibility-Prüfung einzelner Seiten), PREPARE-Modus-
    Erweiterung (`prepare_follow_up`), oder einer der übrigen fünf
    kleineren offenen Backend-Lücken.
20. ✅ **UI/UX Phase UI-7 — Fehlerzustände.** Systematischer Audit ergab:
    von 24 Seiten prüfte genau eine die `isError`-Query-Fehlerzustand —
    ein echter Backend-Ausfall war für den Nutzer zuvor nicht von "keine
    Daten vorhanden" unterscheidbar. Neue `ErrorState`-Komponente
    (`packages/ui`) + `errorMessage()`-Helfer auf alle 24 Seiten
    ausgerollt (Detailseiten/Listenseiten/Card-Content-Varianten/ein
    kombinierter Dashboard-Banner, je nach bestehender Seitenstruktur).
    Live verifiziert durch echtes Stoppen des `orbit-api`-Containers
    (frischer Tab → Fehlerkarte → Retry nach Neustart → echte Daten).
    Details: `docs/ASSUMPTIONS.md` #387-392.
21. ✅ **Integration Setup & Connector Framework (Amendment 01, v2.0).**
    Vollständig abgeschlossen, alle fünf Increments (A-E) — siehe eigener
    Umsetzungsplan `docs/INTEGRATION_FRAMEWORK_PHASE1_PLAN.md`: Credential
    Vault (echtes AES-256-GCM, tenant-gescopt, RLS-isoliert), statische
    Connector-Registry (7 Connectoren, Capabilities aus echten Interfaces
    abgeleitet), generischer `OAuth2Service` + echter `GmailConnectorService`
    (alle Google-Endpunkte live gegen offizielle Doku verifiziert), neues
    Enduser-UI ohne JSON-Freitextfeld (echter Gmail-OAuth-Button,
    strukturiertes Twilio-Formular, ehrliches „noch nicht verfügbar" für
    die vier übrigen Mock-Connectoren). Live im Browser verifiziert
    (inkl. eines echten Docker-Image-Staleness-Fundes). Details:
    `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md` #351-386.

Bewusst zurückgestellt (zu groß/zu wenig Grenznutzen für diese Session, als offene
Punkte in `docs/ASSUMPTIONS.md` zu dokumentieren, sobald erreicht): SVG-Logo-
Unterstützung (Sanitization-Pipeline — Raster-Upload ist erledigt, siehe Punkt 13),
automatische Kontrast-Validierung, visuelle Regressionstests, DELEGATE-Modus,
Action-Card-UI mit Bestätigen-Button, `prepare_follow_up`, `message.delta`-Token-
Streaming, Model-Profile-Registry, Usage-Metering, separate Plattform-Admin-Ansicht.
