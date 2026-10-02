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
| 3 | `WorkflowRunnerService.buildWorkflowStepMessage()` — Untrusted-Content-Wrapping | `PARTIAL` | ASSUMPTIONS #246 |
| 4 | Evaluationslauf-Historie (nur Fall-Definitionen persistiert, keine Lauf-Ergebnisse über Zeit) | `MISSING` (bewusst) | ASSUMPTIONS #252 |
| 5 | `AIModelProfile`/Model-Lifecycle-Registry, `AIUsageRecord`, `AIProviderHealth`, Fallback-Policy-Engine | `MISSING` (bewusst) | ASSUMPTIONS #262 |
| 6 | Separate Plattform-Admin-Ansicht `/admin/platform/ai` | `MISSING` (bewusst) | ASSUMPTIONS #262 |

Diese sechs Punkte bleiben offen, sind aber jeweils klein und in sich abgeschlossen —
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
15. **Nächster Schritt** (offen, nach eigener Priorisierung) — alle vom
    Nutzer in dieser Session angefragten UI/UX-Punkte sind jetzt
    abgeschlossen (Sidebar-Kontrast, sortierbare Tabellen, Logo-Upload,
    Diagramme). Weiter mit UI-5/UI-6/UI-7/UI-8 (Modul-Konsistenz/
    Responsive-Accessibility-Härtung), PREPARE-Modus-Erweiterung
    (`prepare_follow_up`), oder einer der sechs kleineren offenen
    Backend-Lücken.

Bewusst zurückgestellt (zu groß/zu wenig Grenznutzen für diese Session, als offene
Punkte in `docs/ASSUMPTIONS.md` zu dokumentieren, sobald erreicht): SVG-Logo-
Unterstützung (Sanitization-Pipeline — Raster-Upload ist erledigt, siehe Punkt 13),
automatische Kontrast-Validierung, visuelle Regressionstests, DELEGATE-Modus,
Action-Card-UI mit Bestätigen-Button, `prepare_follow_up`, `message.delta`-Token-
Streaming, Model-Profile-Registry, Usage-Metering, separate Plattform-Admin-Ansicht.
