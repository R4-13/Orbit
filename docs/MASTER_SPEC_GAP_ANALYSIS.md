# Abgleich gegen den Master-Entwicklungsprompt — Delta-Analyse

Systematischer Abschnitt-für-Abschnitt-Abgleich des tatsächlichen
Implementierungsstands gegen den vollständigen Master-Entwicklungsprompt
("Project ORBIT – Fully Functional MVP", 66 Abschnitte). Jede Aussage
unten wurde am Code verifiziert (Grep/Read/Live-DB-Abfragen), nicht aus
den bisherigen Status-Dokumenten übernommen — `docs/IMPLEMENTATION_STATUS.md`
und `docs/MVP_COMPLETION_REPORT.md` beschreiben, was gebaut wurde, ohne
dabei gegen den vollständigen Original-Prompt (der bislang nirgends im
Repo als Volltext vorlag) geprüft zu haben. Diese Datei schließt genau
diese Lücke.

Statuslegende: ✅ vollständig umgesetzt · ⚠️ teilweise/strukturell vorbereitet,
aber nicht funktional · ❌ fehlt vollständig.

## Executive Summary

**Am stärksten umgesetzt:** Multi-Tenancy (§8, zwei unabhängige
Verteidigungslinien inkl. Postgres RLS), Auth/RBAC (§9), Tenant-Isolation-
Tests, Fehlerbehandlung (§40, alle 7 geforderten Fehlerklassen existieren
exakt), Ehrlichkeits-/Status-Kennzeichnung (§63), CI-Pipeline (§54),
Nicht-Ziele-Einhaltung (§60) — und, neu seit Phase 18: die
Agentenarchitektur (§12-17) läuft jetzt live über einen simulierten
E-Mail-Intake-Endpunkt (18/18 API-E2E-Tests grün, siehe unten).

**~~Die größte strukturelle Lücke~~ Behoben in Phase 18 (mit Einschränkung):**
Die Agentenarchitektur (§12-17) lief bis Phase 18 nur als ungenutzte
Infrastruktur. Seit Phase 18 gibt es einen echten Endpunkt (`POST
/api/v1/intake/emails`), der die volle Kette Agent → Tool Registry →
Policy Engine → Tool Gateway → Connector tatsächlich ausführt — 15
konkrete Tools, `AgentRun`/`ToolInvocation` werden befüllt, live gegen
echte Postgres verifiziert. **Verbleibende Einschränkung**: kein echter
Trigger — der Endpunkt *simuliert* eine eingehende E-Mail, es gibt
keinen echten Mail-Connector-Webhook, der ihn automatisch aufruft (kein
Microsoft Graph-/Gmail-Zugang). Details: `AGENT_ARCHITECTURE.md`.

**~~Zweitgrößte Lücke: Frontend-Seitenabdeckung~~ Größtenteils behoben in
Phase 19a** (§32) — `/cases` + `/cases/[id]`, `/sales/leads/[id]`,
`/sales/opportunities` + `/sales/opportunities/[id]` und `/activity`
existieren jetzt, mit den passenden neuen Backend-Endpunkten
(`GET /api/v1/agent-runs`, angereicherte `CasesService.findOne()` und
`LeadsService.findOne()`). **Weiterhin offen**: `/inbox` (Unified Inbox
für den Intake-Endpunkt), `/integrations`, `/admin/users`,
`/admin/policies`, `/admin/settings` — letztere insbesondere blockiert
durch ein komplett fehlendes Backend-CRUD für `PolicyConfig`
(`PolicyModule` hat bisher keinen Controller).

**Drittgrößte Lücke:** Von 6 benannten Abnahme-Szenarien (§59) sind 2
vollständig erfüllt (Duplicate, Multi-Tenant), 2 seit Phase 18 deutlich
näher am Soll aber nicht vollständig (Finance, Sales — der Trigger bleibt
simuliert statt real), 2 vollständig unerfüllt (Bank-Change-Erkennung,
Telefonie).

**Dokumentation:** ~~8~~ 4 von 16 geforderten Dateien fehlen noch
(nur die vier Provider-spezifischen Integrationsdokumente
`MICROSOFT_INTEGRATION.md`, `GOOGLE_INTEGRATION.md`,
`HUBSPOT_INTEGRATION.md`, `TELEPHONY.md`). `SECURITY.md`,
`DOMAIN_MODEL.md`, `DEPLOYMENT.md`, `TESTING.md` seit Phase 19d
geschrieben, inkl. der zuvor komplett fehlenden Mermaid-Diagramme (§56:
System Context, Internal Architecture, beide Sequenzdiagramme
Finance/Sales — jetzt alle in `ARCHITECTURE.md`).

---

## §0 — Rolle und Branding

✅ Branding vollständig über `@orbit/config` (`APP_NAME`, `BRAND_NAME`,
`BRAND_LOGO`, `PRIMARY_DOMAIN`, `SUPPORT_EMAIL`), nirgends hart codiert.

## §1 — Oberstes Entwicklungsziel

⚠️ Beide End-to-End-Prozesse existieren, aber **nicht** end-to-end wie
spezifiziert: Der Prozess soll bei "E-Mail" beginnen
(`E-Mail → Rechnung erkennen → ...` / `E-Mail oder Telefonkontakt → Kontakt
erkennen → ...`). Tatsächlich beginnt der Finance-Prozess bei einem
direkten Dokument-Upload über die API/UI, der Sales-Prozess bei einer
manuell im UI ausgefüllten Lead-Anlage. Die Schritte *nach* dem jeweiligen
Einstiegspunkt (Extraktion → Abgleich → Dublettenprüfung → Freigabe →
Transfer bzw. Lead → Task → Termin) sind live verifiziert funktionsfähig.
Mock-Connector-Pattern (Interface + Mock + Doku) ✅ konsequent
durchgehalten für alle Drittanbieter.

## §2 — Arbeitsweise

✅ Iterativ (Lint→Typecheck→Test→Build→E2E) durchgehend eingehalten, keine
offenen selbstverursachten Fehler. ✅ Annahmen in `docs/ASSUMPTIONS.md`
dokumentiert (95 Einträge). ⚠️ "Kein reines Scaffold" — für Finance/Sales
zutreffend; für Agentenarchitektur (§12-17) bleibt es faktisch beim
Scaffold (siehe dort).

## §3 — Technische Leitprinzipien

✅ Cloud-native, Multi-Tenant, API-first, modular, testbar, auditierbar,
providerunabhängig (Connector-Pattern) — alle zutreffend. ❌
**Event-driven "wo sinnvoll"**: BullMQ ist Paket-Abhängigkeit
(`apps/api/package.json`), aber es existiert kein einziger `@Processor`,
kein `Queue.add()`, kein registrierter Consumer — das System ist
vollständig synchron/request-response, nirgends event-driven.

## §4-6 — Frontend/Backend/Repo-Struktur

✅ Next.js/React/TS/Tailwind, NestJS/Prisma/PostgreSQL, Redis/MinIO,
pnpm-Workspaces + Turborepo, Verzeichnisstruktur exakt wie gefordert
(inkl. `/infra`, `/scripts`, aktuell leer). ❌ **shadcn/ui** explizit
gefordert — stattdessen fünf handgeschriebene Primitives
(`packages/ui`, bewusste Entscheidung, ASSUMPTIONS #69), kein
shadcn/ui-Tooling. ⚠️ **Internationalisierung**: `next-intl` ist
Abhängigkeit in `apps/web/package.json`, aber komplett unbenutzt — keine
Message-/Locale-Dateien, kein `middleware.ts` mit Locale-Routing, keine
`useTranslations()`-Verwendung irgendwo. de-DE-Texte sind hart im JSX
verankert (funktional korrekt für §4's Sprachanforderung, aber §4
verlangt auch "Architektur muss Internationalisierung ermöglichen" — das
ist strukturell nicht vorbereitet, nur eine ungenutzte Abhängigkeit).

## §7 — Zentrale Backend-Module

| Gefordert | Status |
|---|---|
| AuthModule | ✅ |
| TenantModule | ⚠️ existiert (`tenants.module.ts`), aber kein REST-Controller — nur intern für Bootstrap/Login nutzbar |
| UserModule | ❌ kein eigenes Modul, keine `/users`-Routen (Einladen/Deaktivieren/Auflisten nicht möglich) |
| CaseModule | ✅ (`cases`) |
| TaskModule | ✅ (`tasks`) |
| DocumentModule | ✅ (`documents`) |
| CommunicationModule | ❌ kein Modul; `EmailMessage`/`Call`/`CallTranscript` existieren nicht als Modelle |
| FinanceModule | ⚠️ funktional abgedeckt, aber als `suppliers`+`invoices` statt einem Modul |
| SalesModule | ⚠️ funktional abgedeckt, aber als `companies`+`contacts`+`leads`+`opportunities`+`meetings` |
| ApprovalModule | ⚠️ existiert (`approvals`), aber leer/ungenutzt (siehe §37) |
| PolicyModule | ✅ (`policy`) |
| AgentModule | ❌ existiert nicht — siehe §12-17 |
| IntegrationModule | ❌ `connectors`-Modul ist reine DI-Verdrahtung der Mock-Connectoren, keine `/integrations`-REST-API, kein `IntegrationCredential`-Handling |
| NotificationModule | ❌ existiert nicht |
| AuditModule | ✅ (`audit`), aber kein Lese-Endpunkt (`GET /audit` existiert nicht) |
| MetricsModule | ❌ existiert nicht |
| AdminModule | ❌ existiert nicht |

**7 von 17 geforderten Modulen fehlen vollständig, 4 weitere sind nur
teilweise/strukturell vorhanden.**

## §8 — Multi-Tenant-Architektur

✅✅ Stärkster Abschnitt im gesamten Projekt. `tenantId` auf jeder
relevanten Tabelle, Anwendungsschicht-Isolation (`forTenant()`
Prisma-Client-Extension) **plus** Postgres Row-Level Security (Phase 15) —
explizit über die spezifizierte Mindestanforderung hinaus ("Row Level
Security, soweit technisch sauber realisierbar" — hier tatsächlich
umgesetzt, nicht nur geprüft). Automatisierte Cross-Tenant-Tests ✅
vorhanden und live verifiziert (fail-closed per `psql` bestätigt).

## §9 — Authentifizierung und Autorisierung

✅ Login/Logout/Passwort-Login, Rollenmodell exakt wie spezifiziert
(`TENANT_ADMIN, FINANCE_USER, SALES_USER, APPROVER, VIEWER, SYSTEM_ADMIN`),
JWT-Token-Handling, RBAC mit granularen Permission-Strings (inkl. der
Beispiele `invoice.read`, `invoice.approve`, `booking.create`,
`crm.contact.create`, `email.send`, `integration.configure` — alle exakt
als Konstanten vorhanden, auch wenn `email.send`/`integration.configure`
keine zugehörige Funktion haben). SSO-Erweiterbarkeit: nicht gebaut, aber
auch nur als "später" gefordert — kein Gap.

## §10 — Zentrales Datenmodell

25 von den in der Spezifikation grob skizzierten ~45 Entitäten existieren.
Größte Lücken:

- **Finance**: `Customer` fehlt komplett (nur AP-Seite/`Supplier`
  implementiert, keine AR-Seite), `InvoiceLine`, `OpenItem`,
  `PaymentReference`, `FinanceTransaction` fehlen (letzteres teilweise
  durch `FinanceTransfer` funktional ersetzt).
- **Kommunikation**: `Conversation`, `Message`, `Call`, `CallTranscript`
  fehlen komplett; `EmailMessage` wird seit Phase 18 für den
  Agent-Intake-Pfad befüllt (`docs/ASSUMPTIONS.md` #100), für alle
  anderen Pfade weiterhin ungenutzt.
- **Dokumente**: `DocumentVersion`, `DocumentExtraction` fehlen (Extraktion
  liegt als JSON-Feld auf `Invoice.extractedData`, kein eigenes Modell).
- **Sales**: `Activity`, `FollowUp` fehlen.
- **Workflow**: `PolicyDecision` fehlt als eigenes Modell (Entscheidung
  wird nur inline angewendet, nicht persistiert).
- **AI**: `AgentDefinition`, `AgentStep`, `LLMInteraction`,
  `ConfidenceScore` (als eigenes Modell) fehlen weiterhin; `AgentRun`/
  `ToolInvocation` werden seit Phase 18 tatsächlich beschrieben (ein
  Datensatz pro Agent-Lauf bzw. Tool-Aufruf über den neuen
  Intake-Endpunkt) — siehe `AGENT_ARCHITECTURE.md`.
- **Integration**: `IntegrationCredential`, `IntegrationEvent`,
  `WebhookEvent`, `ConnectorSync` fehlen (Credentials liegen als
  ungenutztes `Bytes?`-Feld direkt auf `Integration`).

## §11 — Case-Konzept

⚠️ `Case` existiert mit `type`, `status`, `title`, `description`,
`assigneeId` + Relationen zu `tasks`/`documents`/`emailMessages`/
`invoices`/`leads`/`agentRuns`. **Fehlt weiterhin**: `priority`-Feld,
`source`-Feld.

⚠️ **Teilweise behoben in Phase 18**: Der neue Agent-Intake-Pfad (`POST
/intake/emails`) erzeugt jetzt automatisch einen `Case` und verknüpft
Invoice/Lead/EmailMessage damit — bewusst nur für diesen Pfad
(`docs/ASSUMPTIONS.md` #96), nicht rückwirkend für die bestehenden
direkten Routen (`POST /invoices`, `POST /leads`), um die dortigen
bereits live-getesteten Phase-7/8-Services nicht anzufassen. Über die
direkten Routen erstellte Rechnungen/Leads bleiben weiterhin ohne
automatischen Case, `caseId` bleibt dort optional vom Aufrufer gesetzt.

## §12-17 — Agentenarchitektur (war größte Einzellücke, seit Phase 18 verdrahtet)

⚠️ **Update Phase 18**: Diese Lücke ist nicht mehr vollständig offen.
Drei der vier spezifizierten Agenten (Communication/Intake, Finance/AP,
Sales/CRM) laufen jetzt live über einen neuen Endpunkt (`POST
/api/v1/intake/emails`, simuliert eine eingehende E-Mail mangels echtem
Mail-Connector) durch die volle Kette **Agent → Tool Registry → Policy
Engine → Tool Gateway → Connector** — verifiziert gegen echte Postgres in
`apps/api/test/intake-workflow.e2e-spec.ts` (18/18 API-E2E-Tests grün,
mehrfach wiederholt). 15 konkrete Tools aus §14 sind registriert (dünne,
getestete Wrapper um die bereits live verifizierten Phase-7/8-Services),
`AgentRun`/`ToolInvocation` werden erstmals tatsächlich beschrieben, und
die Policy Engine entscheidet jetzt über alle 16 Actions, nicht mehr nur
über `SUPPLIER_CREATE`.

**Weiterhin offen**: Der **vierte** Agent (Orchestrator) existiert nicht
als eigener `AgentRuntime`-Lauf mit eigenem LLM-Aufruf — das Routing
zwischen Finance-/Sales-Agent ist deterministischer Code im neuen
`IntakeService`, bewusst vereinfacht (siehe `AGENT_ARCHITECTURE.md`
"Bewusste Vereinfachungen"). Es gibt weiterhin **keinen echten Trigger**
— `/intake/emails` simuliert den E-Mail-Eingang, ruft ihn aber nicht
selbst auf (kein Mail-Connector-Webhook, siehe §23/§29/§34). Telefonie
(§28) ist unverändert nicht angebunden. `AnthropicLLMProvider` bleibt
**REQUIRES PROVIDER CREDENTIALS** — derselbe Code-Pfad läuft strukturell
identisch, nur nie gegen die echte API getestet.

Volle Details, die 15 Tools im Einzelnen, und was genau noch fehlt:
[`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md).

## §18 — Dokumentenverarbeitung

⚠️ PDF-Speicherung (S3/MinIO) ✅, Metadaten ✅. ❌ **Keine echte
Textextraktion** aus PDFs (OCR vollständig gemockt,
`MockOcrProvider.extractInvoiceData()` gibt vorgegebene Werte zurück,
liest nie tatsächlich PDF-Inhalt). ❌ **Hash-Erzeugung**: `Document.checksum`
existiert als Schema-Feld, wird aber code-weit nie gesetzt — keine
Dublettenerkennung über Datei-Hash möglich, obwohl das Feld dafür
vorgesehen ist.

Extrahierte Felder — Ist-Zustand gegen die 14 geforderten:
`invoiceNumber`✅ `invoiceDate`✅ `supplierName`✅ `supplierAddress`❌
`supplierVATId`✅(als `supplierTaxId`) `customerName`❌(kein
Customer-Konzept) `netAmount`✅ `taxAmount`✅ `grossAmount`✅ `currency`✅
`iban`❌ `dueDate`✅ `paymentTerms`❌ `lineItems`❌. **7 von 14 Feldern
fehlen**, darunter `iban` — mit direkter Konsequenz für §59 Szenario C
(siehe dort). `confidence`/`source` pro Feld ⚠️ nur global
(`confidenceScore` auf Invoice-Ebene), nicht pro Einzelfeld wie
spezifiziert.

## §19 — Dublettenerkennung

⚠️ Prüfung erfolgt nur über `invoiceNumber` + `grossAmount` — von den
5 geforderten Kriterien (`tenant, supplier, invoiceNumber, grossAmount,
invoiceDate, documentHash`) fehlen `supplier`, `invoiceDate` und
`documentHash` als zusätzliche Signale (tenant ist implizit durch
RLS/Scoping gegeben). Im UI werden gefundene Dubletten korrekt angezeigt
(Badge "Mögliche Dublette").

## §20-22 — Finance Connector / DATEV / Lexware

✅ `FinanceConnector`-Interface deckt die geforderten Kernmethoden ab
(`testConnection`, Supplier-Suche/-Anlage, `transferInvoice`). ⚠️
`getCustomers`, `getOpenItems`, `attachDocument` fehlen im Interface
(kein Customer-Konzept, kein OpenItem-Modell). ✅ `MockFinanceConnector`
vollständig implementiert und live getestet. ❌ **Weder
`DATEVConnector` noch `LexwareConnector` existieren als Klassen** — beide
sind reine `REQUIRES PROVIDER CREDENTIALS`-Platzhalter. `docs/DATEV_INTEGRATION.md`
existiert, ist aber selbst nur ein Platzhalter (erklärt den Blocker, liefert
noch keine der in §21 geforderten Inhalte wie DATEV-Rechnungsdatenservice-
Details oder Mandantenkonfiguration — verständlich ohne Zugang, aber ein
Delta gegen den Wortlaut von §21). **Für Lexware existiert nicht einmal
eine eigene Dokumentationsdatei** — nur eine Zeile in `docs/INTEGRATIONS.md`.

## §23-28 — Mail/Kalender/CRM/Telefonie-Connectoren

✅ Alle vier Interfaces (`MailConnector`, `CalendarConnector`,
`CRMConnector`, `TelephonyConnector`) vollständig wie spezifiziert, je
mit funktionsfähigem Mock, unit-getestet. ❌ Keine der sechs realen
Implementierungen (Microsoft Graph, Gmail, Google Calendar, HubSpot,
Twilio) existiert — durchgehend korrekt als `REQUIRES PROVIDER
CREDENTIALS` gekennzeichnet, kein Blocker der Codebasis. ❌ **3CX-
Adapterstruktur** (§28, "vorbereiten") nicht einmal ansatzweise vorhanden.
❌ **`SpeechToTextProvider`-Interface** (§28 explizit gefordert) existiert
nicht — nur ein `STT_PROVIDER`-Env-Var als Platzhalter ohne zugehöriges
Interface. ❌ Telefonie ist in keinen Workflow eingebunden (kein
"Anruf → Case"-Pfad, siehe §59 Szenario E).

## §29 — Webhooks

❌ **Vollständig fehlend.** Kein Webhook-Endpunkt, keine
Signaturprüfung, kein Replay-/Idempotency-Schutz, keine Event-ID-
Speicherung. Da keine der realen Mail-/CRM-/Telefonie-Anbindungen
implementiert ist, wurde auch der dafür nötige Webhook-Empfang nicht
gebaut.

## §30 — Integrations-Credentials

❌ `CREDENTIAL_ENCRYPTION_KEY` ist als Env-Var validiert
(`packages/config/src/env.ts`), aber **es existiert keine einzige
AES-256-GCM-Verschlüsselungsfunktion im gesamten Code** — der Schlüssel
wird nirgends benutzt. `Integration.encryptedCredentials` (Schema-Feld)
wird nie beschrieben, da keine reale OAuth-Anbindung existiert, die
Credentials überhaupt entgegennehmen würde.

## §31 — Audit Trail

⚠️ `AuditLog` deckt `tenant, user (actorUserId), agent (actorType),
timestamp, objectType (entityType), objectId (entityId), action
(eventType)` ab. **Fehlt weiterhin**: `before`/`after`-Felder (kein
State-Diff, nur ein generisches `payload`-JSON) und **`correlationId`**
komplett — Events aus demselben Vorgang lassen sich nicht programmatisch
verknüpfen. Kein Lese-Endpunkt für Audit-Daten (`GET /audit` fehlt
weiterhin).

Von den 11 Beispiel-Event-Typen: `EMAIL_RECEIVED` und
`APPROVAL_REQUESTED` werden seit Phase 18 tatsächlich emittiert (Agent-
Intake-Pfad bzw. Approval-Center-Wiring, `docs/ASSUMPTIONS.md` #100/#102).
`EMAIL_SENT`/`CRM_UPDATED` sind als Konstanten vorbereitet, aber weiterhin
ungenutzt — es gibt zwar jetzt `send_email`/`log_crm_activity`-Tools,
diese protokollieren aber (noch) nicht mit diesen spezifischen
Event-Typen.

## §32 — Frontend-Seiten

| Gefordert | Status |
|---|---|
| `/login` | ✅ |
| `/dashboard` | ✅ |
| `/inbox` | ❌ |
| `/cases`, `/cases/[id]` | ✅ seit Phase 19a — Liste (mit Finance/Sales-Filter) + Detailseite mit allen verknüpften Datensätzen (Tasks, Dokumente, E-Mails, Rechnungen, Leads, Agent-Läufe inkl. Tool-Aufrufe) |
| `/finance` | ❌ (nur `/finance/invoices`, `/finance/suppliers` direkt) |
| `/finance/invoices`, `/finance/invoices/[id]` | ✅ |
| `/sales` | ❌ |
| `/sales/leads`, `/sales/leads/[id]` | ✅ seit Phase 19a — Detailseite mit Kontakt/Firma, Status-Wechsel, verknüpften Opportunities |
| `/sales/opportunities`, `/sales/opportunities/[id]` | ✅ seit Phase 19a — Liste, Anlage-Formular, Detailseite mit Stage-Wechsel |
| `/approvals` | ⚠️ existiert, zeigt aber strukturell nie Inhalte (siehe §37) |
| `/tasks` | ✅ |
| `/activity` | ✅ seit Phase 19a — Agent-Run-Feed mit Tool-Aufrufen, Filter nach Agent-Typ, Link zum zugehörigen Vorgang |
| `/integrations` | ❌ |
| `/admin/users`, `/admin/policies`, `/admin/settings` | ❌ (alle drei) |

**4 von 17 spezifizierten Routen fehlen noch vollständig** (`/inbox`,
`/integrations`, `/admin/users`, `/admin/policies`, `/admin/settings` —
letztere zählen als drei separate Routen, macht 5 Einzelrouten in 4
Themenblöcken). `/finance` und `/sales` als reine Übersichtsseiten
(ohne eigene Funktion über die Unterrouten hinaus) bleiben ebenfalls
offen, sind aber niedrige Priorität.

## §33 — Dashboard

❌ Zeigt nur drei einfache Zähler (offene Aufgaben, Rechnungen mit
Freigabe erforderlich, ausstehende Freigaben) — nicht die geforderten
Kategorien (E-Mails/Dokumente/Rechnungen/Leads/CRM-Updates/Termine
verarbeitet, automatisch erledigt vs. Freigabe nötig). **"Geschätzte
eingesparte Zeit"** ist der auffälligste Einzel-Gap: `packages/config/src/time-savings.ts`
exportiert bereits konfigurierbare Zeitwerte
(`DEFAULT_TIME_SAVINGS_MINUTES`) — exakt wie in §33 gefordert — aber
dieser Code wird **nirgends importiert oder verwendet**, weder im
Dashboard noch sonst irgendwo. Eine bereits gebaute, aber nie verdrahtete
Funktion.

## §34 — Unified Inbox

❌ Vollständig fehlend (keine `/inbox`-Seite, konsistent mit dem Fehlen
von `EmailMessage`-Nutzung und Communication Agent).

## §35 — Finance UI (Invoice Detail)

⚠️ Vorhanden: Lieferant, Rechnungsnummer, Datum, Betrag, MwSt.,
Dublettenergebnis (via Status-Badge), Kontierungsvorschlag,
Confidence-Score, Approval-Status, FIBU-Status. **Fehlt**:
Original-Dokument-Anzeige (kein Dokumenten-Viewer, ohnehin keine
Demo-Dokumente hinterlegt), Rechnungspositionen (keine Line-Items),
IBAN, Zahlungsziel, und explizit die geforderte **kurze, fachlich
verständliche Entscheidungsbegründung** ("Lieferant im Stamm gefunden.
Rechnungsnummer ist bisher nicht vorhanden. …") — es gibt keinerlei
Freitext-Begründung, nur strukturierte Felder. Audit-Trail wird auf der
Detailseite selbst nicht angezeigt (Daten existieren in der DB, aber kein
UI-Element dafür).

## §36 — Sales UI (Lead Detail)

⚠️ **Seit Phase 19a vorhanden, aber nicht vollständig.** `/sales/leads/[id]`
zeigt Contact (Name/E-Mail/Telefon), Company, Quelle, Notizen, Status
(mit Wechsel-Dropdown) und die aus diesem Lead entstandenen
Opportunities (mit Wert/Phase). **Weiterhin fehlt**: Summary/Intent
(keine LLM-generierte Zusammenfassung), Next Action / Suggested
Follow-Up als eigener Abschnitt (existiert nur implizit als Task in der
zugehörigen Case-Ansicht), Meetings-Abschnitt, CRM-Sync-Status-Anzeige,
Communication-History (E-Mail-Verlauf) direkt auf der Lead-Seite — die
gehört aktuell nur zur Case-Detailseite, nicht zur Lead-Seite selbst.

## §37 — Approval Center

⚠️ **Backend seit Phase 18, Frontend-Aktionen seit Phase 19c — mit einer
bewusst offenen Einschränkung.** `/approvals` hat jetzt echte
Freigeben-/Ablehnen-Buttons, die pro `entityType` auf die richtige
zugrundeliegende Aktion dispatchen (`PATCH /suppliers/:id/approve|reject`,
`PATCH /invoices/:id/approve|reject` — Letzteres neu: `InvoicesService`
hatte bisher nur `approve()`, kein `reject()`, obwohl `InvoiceStatus`
`REJECTED` längst kennt). Live verifiziert: neuer Lieferant über
`POST /suppliers` angelegt (→ `PENDING_APPROVAL`), über die
`/approvals`-Seite als `approval@musterwerk.example` freigegeben, Status
sowohl in der Freigaben-Liste als auch am Lieferanten selbst (`ACTIVE`)
bestätigt. **Bewusst nicht gelöst**: `FOLLOW_UP`-Einträge (vom Agent
Runtime blockierte Tool-Aufrufe, `SUGGEST_ONLY`/`REQUIRE_APPROVAL`)
werden weiterhin nur lesend angezeigt — es gibt keinen Endpunkt, der
einen blockierten Tool-Aufruf nachträglich ausführt, weil
`AgentRuntime`/`IntakeService` dessen Argumente aktuell nirgends für
einen späteren Resume persistieren (nur `toolCallId` + `toolName` landen
in der `Approval`-Zeile). Das nachzurüsten wäre ein eigenständiges,
größeres Feature (Tool-Aufruf-Persistenz + Resume-Mechanismus im
`AgentRuntime`) und wurde bewusst nicht im Rahmen dieser Phase
mitgezogen — ehrlich als Lücke gekennzeichnet statt stillschweigend
weggelassen (§63).

## §38 — Agent Activity

✅ Seit Phase 19a: `/activity` zeigt jeden `AgentRun` (neueste zuerst,
max. 100), gefiltert nach Agent-Typ, mit Status-Badge, Trigger-Typ,
Zeitstempel, jedem einzelnen `ToolInvocation` (Tool-Name + Status) und
einem Link zum zugehörigen Vorgang, sofern vorhanden. Backend-seitig neu:
`GET /api/v1/agent-runs` (+ `/:id`), vorher komplett fehlend (§42).
**Bewusst nicht abgebildet**: die einzelne Policy-Entscheidung pro
Tool-Aufruf (ALLOW/DENY/REQUIRE_APPROVAL) wird aktuell nicht als eigenes
UI-Element angezeigt, nur der grobe SUCCESS/FAILED-Status der
`ToolInvocation` — die Entscheidung selbst steckt im `output`-JSON-Feld,
aber nicht extra gerendert.

## §39 — Integration Administration

❌ Vollständig fehlend (keine `/integrations`-Seite, kein
Connected/Disconnected-Status, kein Test-Connection-Button im UI —
obwohl `testConnection()` auf Connector-Ebene existiert und technisch
aufrufbar wäre).

## §40 — Fehlerbehandlung

✅✅ Alle 7 geforderten Fehlerklassen existieren exakt mit korrektem
HTTP-Status (`IntegrationUnavailableError` 503,
`AuthenticationExpiredError` 401, `DuplicateInvoiceError` 409,
`PolicyViolationError` 403, `ApprovalRequiredError` 202,
`LowConfidenceError` 422, `ExternalSystemError` 502), plus vier weitere
sinnvolle Ergänzungen. Global durch `OrbitExceptionFilter` korrekt auf
HTTP-Antworten gemappt (Phase 14 hat einen echten Bug hier gefunden und
behoben). ❌ **Retry mit Backoff** für Integrationsfehler: nicht
implementiert (keine Queue-Jobs, siehe §3). ❌ **Dead-Letter-/Failed-Job-
Ansicht**: nicht implementiert, aus demselben Grund.

## §41 — Observability

✅ Strukturiertes Logging (`pino`/`pino-http`), Health-/Readiness-
Endpunkte. ⚠️ Correlation-/Request-IDs: `pino-http` generiert
Request-IDs automatisch, aber sie werden nicht in Audit-Logs oder
Cross-Service-Aufrufen mitgeführt (kein `correlationId`, siehe §31). ❌
Queue-Job-IDs (keine Queue). ❌ Keine Metrics (`MetricsModule` fehlt,
kein `/metrics`-Endpunkt). ❌ OpenTelemetry: nur `OTEL_ENABLED`-Env-Flag,
nicht verdrahtet.

## §42 — API

✅ Basis `/api/v1`, ✅ OpenAPI/Swagger unter `/api/docs` korrekt
eingerichtet. Von den 17 geforderten Ressourcen-Gruppen fehlen als
eigenständige REST-Endpunkte: `tenants` (nur intern), `users`,
`bookings` (nur verschachtelt unter `/invoices/:id/booking-proposal`),
`integrations`, `audit`, `webhooks` — **6 von 17** (`agent-runs` seit
Phase 19a behoben: `GET /api/v1/agent-runs` + `/:id`, lesend,
Permission-Gating über `CASE_READ` wie bei `DocumentsController`). Dafür
existieren sinnvolle, nicht explizit geforderte Zusatz-Ressourcen
(`/suppliers`, `/meetings`).

## §43-45 — Demo-Tenant und Demo-Daten

⚠️ Demo-Tenant "Musterwerk GmbH" ✅, aber mit anderen E-Mail-Adressen
(`@musterwerk.example` statt der spezifizierten `@example.local`) und
einem fünften Nutzer (`viewer@...`) zusätzlich zu den vier geforderten —
keine funktionale Lücke, aber eine wörtliche Abweichung.

**Finance-Demo (§44)** — Soll: 5 Lieferanten, 10 historische + 3 neue
Rechnungen, 1 Dublette, 1 unbekannter Lieferant, 1 geänderte IBAN. Ist
(laut Seed-Skript-Design, nicht die aktuell durch Testläufe
aufgeblähte Live-DB): 3 Lieferanten, 5 Rechnungen, 1 Dublettenpaar ✅,
**kein** "unbekannter Lieferant"-Szenario, **kein**
IBAN-Änderungs-Szenario (folgt zwangsläufig aus dem Fehlen von IBAN auf
Invoice, §18). Deutlich unter der geforderten Datenmenge.

**Sales-Demo (§45)** — Soll: 5 Unternehmen, 10 Kontakte, 5 Leads, 3
Opportunities, Beispiel-E-Mails, Beispiel-Telefontranskripte. Ist: 2
Unternehmen, 3 Kontakte, 3 Leads, 2 Opportunities, **keine**
Beispiel-E-Mails/-Transkripte als Seed-Daten (`Call` bleibt ungenutzt).
Die geforderte Live-Demo "eingehende E-Mail → automatisch Case → Contact
→ Company → Lead → Task → Follow-up" ist seit Phase 18 über `POST
/api/v1/intake/emails` tatsächlich auslösbar und live gegen echte
Postgres verifiziert (siehe `intake-workflow.e2e-spec.ts`) —
**Einschränkung bleibt**: der Trigger ist simuliert (manueller
API-Aufruf), kein echter Mail-Connector-Webhook ruft ihn automatisch
auf, und im UI gibt es dafür keine Eingabemöglichkeit (keine
`/inbox`-Seite).

*Hinweis: Die aktuell laufende Datenbank enthält durch wiederholte
E2E-Testläufe dieser Session deutlich mehr Datensätze (33 Lieferanten, 49
Rechnungen etc.) als das Seed-Skript selbst anlegt — das ist ein
Testartefakt, kein Demo-Design, und wird durch `pnpm prisma:seed`
zurückgesetzt.*

## §46-47 — Tests und Qualitätskriterien

✅ Unit-Tests für Policy Engine, Duplicate Detection, Tenant Isolation,
Permission Checks, Connector Mapping — vorhanden und aussagekräftig.
⚠️ "Agent Tool Validation" nur für die (ungenutzte) `ToolRegistry`
selbst, nicht für reale Tools (da keine existieren). ❌ Integration-Tests
für Queue+Worker: nicht vorhanden (keine Queue). ❌ Agent-Workflow-Tests:
nicht vorhanden (kein Agent-Workflow). E2E mit Playwright: Finance-Szenario
✅ sehr nah am Soll-Ablauf; Sales-Szenario ⚠️ (Lead wird per Formular statt
per simulierter Nachricht erzeugt, kein CRM-Sync-Indikator im UI). Tenant
Security: ✅✅ mehrfach und auf zwei Ebenen bewiesen. `pnpm
lint/typecheck/test/build/test:e2e` ✅ laufen alle erfolgreich durch.

## §48-49 — Docker und Env-Konfiguration

✅ `docker-compose.yml` mit allen 6 Services + Healthchecks, `docker
compose up` startfähig. ✅ `.env.example` vollständig dokumentiert, keine
echten Secrets im Repo, alle geforderten Variablen-Gruppen vorhanden.

## §50 — Security

✅ Helmet, CORS, RBAC, Tenant Isolation, Rate Limiting (seit Phase 15
tatsächlich wirksam), Input-Validation (ValidationPipe whitelist), sichere
Datei-Uploads (Presigned-URL-Pattern), Path-Traversal-Schutz. ❌ **CSRF-
Konzept**: nicht dokumentiert (mildernd: Bearer-Token statt Cookie-Session
reduziert das Risiko strukturell, ersetzt aber kein explizites Konzept
wie gefordert). ❌ **Idempotency**: nirgends implementiert. ❌
**Dateigrößenlimits/MIME-Prüfung**: serverseitig nicht durchgesetzt —
`sizeBytes`/`mimeType` werden unverändert aus der Client-Anfrage
übernommen, keine Prüfung gegen den tatsächlichen Dateiinhalt. ❌
**Secret Encryption**: siehe §30, nicht implementiert. ⚠️ Sichere
Tokens: JWT in `localStorage` statt httpOnly-Cookie (bewusste,
dokumentierte MVP-Abwägung, ASSUMPTIONS #68/#92). ❌ Webhook Verification:
siehe §29.

## §51 — Prompt-Injection-Schutz

❌ Gegenstandslos in der Praxis — es gibt keinen Code-Pfad, der LLM-Input
aus E-Mails/PDFs/CRM/Transkripten zusammensetzt, da nie ein LLM
aufgerufen wird (§12-17). Die geforderte Trennung SYSTEM
INSTRUCTIONS/BUSINESS DATA/USER CONTENT/TOOL RESULTS existiert nicht,
weil es nichts zu trennen gibt.

## §52 — Datenschutz

❌ **Vollständig unimplementiert.** Kein Datenexport, keine
Nutzer-Deaktivierungs-Route (`User.status` kennt `DEACTIVATED` als
Enum-Wert, aber kein Endpunkt setzt ihn), kein administrativer
Tenant-Löschungsworkflow, keine Retention-Settings. Der gesamte
Abschnitt ist ein offener Punkt.

## §53-54 — Infrastruktur und CI

✅ Docker/Postgres/Redis/S3-API — portabel, keine proprietäre
Cloud-Bindung. ✅ Production-Dockerfiles vorhanden. ✅ GitHub-Actions-CI
mit install/lint/typecheck/test/build/e2e — in Phase 14/15 erheblich
erweitert (MinIO-Service, RLS-Rollen-Setup) — ⚠️ diese Erweiterungen sind
nicht gegen einen echten Runner verifiziert (kein Zugriff in dieser
Umgebung).

## §55-56 — Dokumentation und Diagramme

| Gefordert | Status |
|---|---|
| `README.md` | ✅ |
| `ARCHITECTURE.md` | ✅ (Phase 16, Diagramme seit Phase 19d) |
| `PRODUCT_CONTEXT.md` | ✅ |
| `DOMAIN_MODEL.md` | ✅ (Phase 19d) |
| `AGENT_ARCHITECTURE.md` | ✅ (Phase 16) |
| `SECURITY.md` | ✅ (Phase 19d) |
| `INTEGRATIONS.md` | ✅ |
| `DATEV_INTEGRATION.md` | ⚠️ existiert, nur Platzhalter-Tiefe |
| `MICROSOFT_INTEGRATION.md` | ❌ |
| `GOOGLE_INTEGRATION.md` | ❌ |
| `HUBSPOT_INTEGRATION.md` | ❌ |
| `TELEPHONY.md` | ❌ |
| `LOCAL_DEVELOPMENT.md` | ✅ (Phase 16) |
| `DEPLOYMENT.md` | ✅ (Phase 19d) |
| `TESTING.md` | ✅ (Phase 19d) |
| `ASSUMPTIONS.md` | ✅ |
| `KNOWN_LIMITATIONS.md` | ✅ (Phase 16) |

**4 von 16 geforderten Dateien fehlen noch** (die vier Provider-
spezifischen Integrationsdokumente `MICROSOFT_INTEGRATION.md`,
`GOOGLE_INTEGRATION.md`, `HUBSPOT_INTEGRATION.md`, `TELEPHONY.md` —
niedrigste Priorität, da inhaltlich stark redundant mit dem bereits
vorhandenen `DATEV_INTEGRATION.md`-Muster und ohne echte
Provider-Credentials ohnehin nicht verifizierbar). ✅ **Mermaid-
Diagramme** seit Phase 19d: System-Context- und Internal-Architecture-
Diagramm in `ARCHITECTURE.md`, die beiden geforderten
Sequenzdiagramme (Finance/Sales) ebenfalls dort, plus sechs
ER-Diagramme (nach fachlichem Cluster gruppiert) in `DOMAIN_MODEL.md`
und je ein Architektur-/Test-Pyramide-Diagramm in `DEPLOYMENT.md`/
`TESTING.md`.

## §57-58 — UX-Prinzipien

✅✅ Konsequent eingehalten. `status-labels.ts` übersetzt jeden internen
Status in verständliche deutsche Begriffe, keine Entwickler-/AI-Fachbegriffe
im UI. ✅ Startseite ist explizit als Dashboard/Redirect gestaltet, nicht
als Chat — sogar mit einem Code-Kommentar, der §58 direkt zitiert.

## §59 — Abnahmekriterien (6 Szenarien)

| Szenario | Status |
|---|---|
| A — Finance (E-Mail → … → Transfer, 14 Schritte) | ⚠️ Seit Phase 18 deutlich näher am Soll: `POST /intake/emails` empfängt die E-Mail, speichert den Anhang, klassifiziert, erzeugt den Case automatisch, extrahiert (Agent-Tool `extract_invoice`), prüft auf Dublette, erzeugt den Buchungsvorschlag (`create_booking_proposal`, reagiert auf das echte Extraktions-Ergebnis) — live verifiziert. **Fehlt weiterhin**: Freigabe/Transfer laufen nach wie vor nur über die separate, menschliche RBAC-Route (nicht als Teil desselben Agent-Turns), und der Trigger ist simuliert, kein echter Mail-Connector. |
| B — Duplicate | ✅ vollständig, live getestet |
| C — Bank Change | ❌ vollständig fehlend (kein IBAN-Tracking, keine Risiko-Markierung) |
| D — Sales Email | ⚠️ Seit Phase 18 deutlich näher am Soll: `POST /intake/emails` erkennt Sales-Intent (Klassifikation), identifiziert/legt Kontakt und Firma an (`create_company`→`create_contact`, reagieren auf echte Zwischenergebnisse), erzeugt Lead + Case + automatische Folgeaufgabe — live verifiziert. **Fehlt weiterhin**: kein separater "Follow-up-Vorschlag" als eigene Entität (nur die Task selbst), CRM-Sync-Bestätigung nicht im UI sichtbar. |
| E — Phone/Twilio | ❌ vollständig fehlend (Telefonie-Connector in keinen Workflow eingebunden) |
| F — Multi Tenant | ✅✅ vollständig, mehrfach und auf zwei Ebenen bewiesen |

**2 von 6 Szenarien vollständig erfüllt (B, F), 2 deutlich verbessert aber
nicht vollständig (A, D — echter Trigger fehlt weiterhin), 2 weiterhin
vollständig offen (C, E).**

## §60 — Nicht-Ziele

✅ Vollständig eingehalten — keine Bankzahlungsausführung
(`payment.execute` hart auf `DISABLED` gesperrt), keine Lohnbuchhaltung,
keine SAP/Salesforce/Pipedrive-Anbindung, kein Kubernetes.

## §61 — Entwicklungsreihenfolge

⚠️ Phasen 1-8 und 12-17 wurden bearbeitet; Phasen 9-11 (Mail+Kalender,
CRM, Telefonie) wurden — mit expliziter Nutzer-Freigabe während der
Session ("Weiter in Phasenreihenfolge, Frontend als Nächstes") — nur auf
Dokumentations-/Interface-Ebene behandelt, nicht als eigene
Implementierungsphasen vertieft, bevor zu Phase 12 übergegangen wurde.
Kein Verstoß gegen die Absicht (echte Anbindungen brauchten ohnehin
Credentials), aber eine Abweichung von der wörtlichen Reihenfolge.

## §62 — Umgang mit Problemen

✅ Prinzip (Production-Adapter-Struktur + Mock + Doku statt Blockade)
konsequent für alle Drittanbieter angewendet. ⚠️ **Contract Tests**
explizit gefordert — vorhanden sind Unit-Tests gegen die
Mock-Implementierungen, aber keine dedizierte Contract-Test-Suite, die
ein künftiger echter Adapter zwingend erfüllen müsste.

## §63 — Keine falschen Erfolgsmeldungen

✅✅ Die geforderte Status-Taxonomie (`IMPLEMENTED / TESTED LOCALLY /
TESTED WITH MOCK / LIVE TESTED / REQUIRES PROVIDER CREDENTIALS`) wird in
`docs/IMPLEMENTATION_STATUS.md` konsequent verwendet — einer der am
treuesten umgesetzten Abschnitte des gesamten Prompts.

## §64 — Abschlussprüfung

✅ Lint/Typecheck/Test/Build/Docker-Build/Seed/Finance-Szenario/
Sales-Szenario/Tenant-Isolation wurden real ausgeführt (nicht nur
behauptet). ⚠️ Kein expliziter, dedizierter "toter Code entfernen"-Schritt
wurde als eigene Aktion durchgeführt (ESLints `no-unused-vars` mit
`--max-warnings=0` fängt das strukturell weitgehend ab). ✅
`MVP_COMPLETION_REPORT.md` existiert — ⚠️ ohne explizite Liste
"notwendige externe Accounts" als eigenen Abschnitt (Information ist
implizit über `KNOWN_LIMITATIONS.md` verteilt, nicht gebündelt).

## §65 — Entwicklungsphilosophie

⚠️ Die Positionierung "ORBIT als Intelligence-/Orchestrierungsschicht,
Drittsysteme bleiben Systems of Record" ist in der Dokumentation korrekt
verankert (`PRODUCT_CONTEXT.md`, `ARCHITECTURE.md`). Der versprochene
**Wettbewerbsvorteil selbst** — "ein Eingang + ein intelligenter
Orchestrator + mehrere spezialisierte Agenten + sichere Tool-Ausführung"
— ist aber genau die in §12-17 beschriebene, nicht gebaute Kette. Die
Philosophie ist dokumentiert, aber nicht im Code eingelöst.

---

## Priorisierte Delta-Liste

Für eine Umsetzung über diesen Stand hinaus, nach Hebelwirkung sortiert.
~~Durchgestrichene~~ Punkte sind seit Phase 18 erledigt.

1. ~~**Agentenarchitektur verdrahten**~~ — erledigt in Phase 18
   (`AgentModule`, 15 Tools, `POST /intake/emails`, live getestet).
2. ~~**E-Mail-Eingang simulieren**~~ — erledigt in Phase 18, als Teil
   desselben Endpunkts. Ein **echter** Mail-Connector-Trigger bleibt
   offen (braucht Microsoft/Google-Credentials).
3. ~~**Fehlende Kern-Frontend-Seiten**~~ — größtenteils erledigt in Phase
   19a: `/cases` + `/cases/[id]`, `/sales/leads/[id]`,
   `/sales/opportunities` + `/sales/opportunities/[id]`, `/activity`
   (zeigt echte `AgentRun`-Daten inkl. Tool-Aufrufe), neuer Endpunkt
   `GET /api/v1/agent-runs`. **Noch offen**: `/inbox` (kann den echten
   Intake-Endpunkt bedienen statt nur simulieren), `/admin/policies`
   (braucht zuerst neues Backend-CRUD, `PolicyModule` hat noch keinen
   Controller), `/integrations`, `/admin/users`, `/admin/settings`.
4. ~~**`docs/SECURITY.md`, `docs/DOMAIN_MODEL.md`, `docs/DEPLOYMENT.md`,
   `docs/TESTING.md`**~~ — erledigt in Phase 19d, inkl. der zuvor
   fehlenden Mermaid-Diagramme (§56). Verbleibend, niedrigste Priorität:
   `MICROSOFT_INTEGRATION.md`, `GOOGLE_INTEGRATION.md`,
   `HUBSPOT_INTEGRATION.md`, `TELEPHONY.md`.
5. **IBAN-Tracking + Bank-Change-Erkennung** (§59 Szenario C) — kleiner,
   klar umrissener Scope, schließt ein explizit benanntes
   Abnahme-Kriterium.
6. **DSGVO-Admin-Funktionen** (§52) — Datenexport, Nutzer-Deaktivierung,
   Tenant-Löschung: rechtlich relevant, aktuell komplett offen.
7. **Datenschutz/Security-Detailarbeit**: CREDENTIAL_ENCRYPTION_KEY
   tatsächlich nutzen, Datei-Upload-Limits serverseitig durchsetzen,
   Idempotency für künftige Webhooks vorbereiten.
8. ~~**Approval-Center-Frontend nachziehen**~~ — erledigt in Phase 19c:
   funktionierende Freigeben-/Ablehnen-Buttons für `SUPPLIER`/`INVOICE`,
   live verifiziert. Offen bleibt der Resume-Mechanismus für
   `FOLLOW_UP`-Einträge (blockierte Agent-Tool-Aufrufe) — siehe §37.
9. **`/admin/policies`-Backend** (Policy Engine hat sonst keine UI, jetzt
   mit 16 statt 11 Actions umso relevanter) — CRUD-Endpunkte für
   `PolicyConfig` fehlen komplett, `PolicyModule` hat aktuell nur
   `PolicyEnforcementService`, keinen `Controller`.

Diese Datei ergänzt, ersetzt aber nicht
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) (Komponentenstatus)
und [`MVP_COMPLETION_REPORT.md`](MVP_COMPLETION_REPORT.md) (Management
Summary) — sie ist die Abschnitt-für-Abschnitt-Belegdatei für beide.
