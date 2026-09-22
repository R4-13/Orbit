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
Nicht-Ziele-Einhaltung (§60).

**Die größte strukturelle Lücke:** Die komplette Agentenarchitektur
(§12-17) — vier benannte Agenten (Orchestrator, Communication/Intake,
Finance/AP, Sales/CRM), der Trigger "eingehende E-Mail", und die gesamte
Kette Agent → Tool Registry → Policy Engine → Tool Gateway → Connector
existieren nur als ungenutzte Infrastruktur (`packages/agent-core`). Kein
Code-Pfad in `apps/api` ruft je ein LLM auf. Beide Kern-Workflows
(Finance, Sales) laufen als direkte, formularbasierte RBAC-Aktionen, nicht
als Agent-orchestrierte Automatisierung. Das ist die Kernidee des
gesamten Produkts (§65) und aktuell nicht vorhanden.

**Zweitgrößte Lücke:** Frontend-Seitenabdeckung (§32) — von 17 geforderten
Routen existieren 9 nicht (`/inbox`, `/cases`, `/cases/[id]`, `/finance`,
`/sales`, `/sales/opportunities`, `/activity`, `/integrations`,
`/admin/*`). Kein Lead-Detail, kein Case-Konzept im UI sichtbar, keine
Unified Inbox, kein Agent-Activity-Log, keine Integrations-Verwaltung.

**Drittgrößte Lücke:** Von 6 benannten Abnahme-Szenarien (§59) sind nur
2 vollständig erfüllt (Duplicate, Multi-Tenant); 2 nur teilweise (Finance,
Sales — der jeweilige "E-Mail kommt herein"-Trigger fehlt); 2 vollständig
unerfüllt (Bank-Change-Erkennung, Telefonie).

**Dokumentation:** 8 von 16 geforderten Dateien fehlen komplett
(`SECURITY.md`, `DOMAIN_MODEL.md`, `DEPLOYMENT.md`, `TESTING.md`,
`MICROSOFT_INTEGRATION.md`, `GOOGLE_INTEGRATION.md`,
`HUBSPOT_INTEGRATION.md`, `TELEPHONY.md`). Keines der neu geschriebenen
Dokumente enthält die geforderten Mermaid-Diagramme (§56).

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
  fehlen komplett; `EmailMessage` existiert als Modell, wird aber nirgends
  befüllt.
- **Dokumente**: `DocumentVersion`, `DocumentExtraction` fehlen (Extraktion
  liegt als JSON-Feld auf `Invoice.extractedData`, kein eigenes Modell).
- **Sales**: `Activity`, `FollowUp` fehlen.
- **Workflow**: `PolicyDecision` fehlt als eigenes Modell (Entscheidung
  wird nur inline angewendet, nicht persistiert).
- **AI**: `AgentDefinition`, `AgentStep`, `LLMInteraction`,
  `ConfidenceScore` (als eigenes Modell) fehlen; `AgentRun`/
  `ToolInvocation` existieren als Modell, sind aber leer (kein Code
  schreibt hinein).
- **Integration**: `IntegrationCredential`, `IntegrationEvent`,
  `WebhookEvent`, `ConnectorSync` fehlen (Credentials liegen als
  ungenutztes `Bytes?`-Feld direkt auf `Integration`).

## §11 — Case-Konzept

⚠️ `Case` existiert mit `type`, `status`, `title`, `description`,
`assigneeId` + Relationen zu `tasks`/`documents`/`emailMessages`/
`invoices`/`leads`/`agentRuns`. **Fehlt**: `priority`-Feld, `source`-Feld.
**Kritischer Funktionslücke**: Weder `InvoicesService.createFromDocument`
noch `LeadsService.create` erzeugt automatisch einen `Case` — `caseId`
bleibt, was der Aufrufer (optional) übergibt, standardmäßig leer. Das
zentrale Versprechen "jeder Vorgang muss von Anfang bis Ende
nachvollziehbar sein" ist dadurch nicht eingelöst — Rechnungen und Leads
entstehen im Regelfall *ohne* zugehörigen Case.

## §12-17 — Agentenarchitektur (größte Einzellücke)

❌ Keiner der vier spezifizierten Agenten (Orchestrator,
Communication/Intake, Finance/AP, Sales/CRM) existiert als laufender
Code. `packages/agent-core` enthält die **Infrastruktur** dafür
(`LLMProvider`-Interface + `MockLLMProvider` + `AnthropicLLMProvider`,
`ToolRegistry` mit Zod-Validierung, `decidePolicyAction()`-Funktion,
`AgentRuntime`-Orchestrierungsschleife) — vollständig unit-getestet, aber
**es gibt kein `AgentModule` und keinen einzigen Aufruf von
`AgentRuntime`/`ToolRegistry`/irgendeinem `LLMProvider` aus `apps/api`
heraus.** Kein Tool aus der in §14 geforderten Liste
(`classify_message`, `extract_invoice`, `find_supplier`, …) ist als
konkretes, registriertes Tool implementiert.

Die einzige Live-Verbindung zwischen `apps/api` und `agent-core` ist der
Aufruf der reinen Funktion `decidePolicyAction()` über
`PolicyEnforcementService`, und zwar für genau **eine** Policy-Action
(`SUPPLIER_CREATE`, bei der automatischen Lieferantenanlage). Alle
anderen zehn in §17 mit Default-Modus spezifizierten Policy-Actions
(`email.classify`, `lead.create`, `followup.send`,
`booking_proposal.create`, `invoice.transfer_to_fibu`,
`supplier.bank_details.change`, `payment.execute`, `crm.activity.log`,
`meeting.propose`, `meeting.create`) sind als Konstanten definiert, werden
aber **nirgends im Code tatsächlich abgefragt** — die Policy Engine
entscheidet nichts außer Lieferantenanlage.

Das bedeutet: §13 (kein direkter LLM-Zugriff), §15/16 (AI Provider Layer,
Trustworthiness-Prüfung), §51 (Prompt-Injection-Schutz) sind allesamt
**gegenstandslos**, weil der Pfad, den sie absichern sollen, nie ausgeführt
wird. Details und die drei konkreten nächsten Schritte für eine echte
Verdrahtung: [`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md).

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
(eventType)` ab. **Fehlt**: `before`/`after`-Felder (kein State-Diff, nur
ein generisches `payload`-JSON) und **`correlationId`** komplett — Events
aus demselben Vorgang lassen sich nicht programmatisch verknüpfen. Von
den 11 Beispiel-Event-Typen fehlen `EMAIL_RECEIVED`,
`APPROVAL_REQUESTED`, `EMAIL_SENT`, `CRM_UPDATED` (konsequent aus den
oben genannten Gründen: kein E-Mail-Eingang, keine generische
Approval-Nutzung, kein E-Mail-Versand, kein explizites CRM-Update-Event).
Kein Lese-Endpunkt für Audit-Daten (`GET /audit` fehlt).

## §32 — Frontend-Seiten

| Gefordert | Status |
|---|---|
| `/login` | ✅ |
| `/dashboard` | ✅ |
| `/inbox` | ❌ |
| `/cases`, `/cases/[id]` | ❌ |
| `/finance` | ❌ (nur `/finance/invoices`, `/finance/suppliers` direkt) |
| `/finance/invoices`, `/finance/invoices/[id]` | ✅ |
| `/sales` | ❌ |
| `/sales/leads` | ✅ (nur Liste, kein `[id]`) |
| `/sales/opportunities` | ❌ (obwohl `Opportunity`-Modell + API existieren) |
| `/approvals` | ⚠️ existiert, zeigt aber strukturell nie Inhalte (siehe §37) |
| `/tasks` | ✅ |
| `/activity` | ❌ |
| `/integrations` | ❌ |
| `/admin/users`, `/admin/policies`, `/admin/settings` | ❌ (alle drei) |

**9 von 17 spezifizierten Routen fehlen vollständig.**

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

❌ **Es gibt keine Lead-Detailseite.** Leads werden ausschließlich in
einer Listenansicht mit Quelle/Notizen/Status angezeigt. Keiner der
geforderten Abschnitte (Contact, Company, Summary, Intent, Opportunity,
Next Action, Suggested Follow-Up, Tasks, Meetings, CRM Sync Status,
Communication History) existiert als eigene Ansicht.

## §37 — Approval Center

⚠️ Die Seite `/approvals` existiert technisch, zeigt aber laut
`ASSUMPTIONS.md` #72 **strukturell immer eine leere Liste**: Weder
`SuppliersService` noch `InvoicesService` schreiben in die generische
`Approval`-Tabelle — sie nutzen stattdessen ihren eigenen
`PENDING_APPROVAL`-Status direkt auf der Entität. Freigaben passieren
faktisch *inline* auf der jeweiligen Invoice-/Supplier-Detailseite, nicht
über die im Master-Prompt vorgesehene **zentrale** Ansicht mit
Approve/Reject/Edit&Approve-Buttons und Risiko-/Confidence-Anzeige.

## §38 — Agent Activity

❌ Vollständig fehlend — konsistent mit dem Fehlen der Agentenarchitektur
selbst (§12-17). Es gibt keine Timeline-Ansicht einzelner Agent-Schritte,
weil keine Agent-Schritte je erzeugt werden.

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
`agent-runs`, `integrations`, `audit`, `webhooks` — **7 von 17**. Dafür
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
Beispiel-E-Mails/-Transkripte (da `EmailMessage`/`Call` ungenutzt). Die
geforderte Live-Demo "eingehende E-Mail → automatisch Case → Contact →
Company → Lead → Task → Follow-up" ist **nicht auslösbar** — es gibt
keinen Mechanismus, eine eingehende E-Mail zu simulieren.

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
| `ARCHITECTURE.md` | ✅ (Phase 16) |
| `PRODUCT_CONTEXT.md` | ✅ |
| `DOMAIN_MODEL.md` | ❌ |
| `AGENT_ARCHITECTURE.md` | ✅ (Phase 16) |
| `SECURITY.md` | ❌ |
| `INTEGRATIONS.md` | ✅ |
| `DATEV_INTEGRATION.md` | ⚠️ existiert, nur Platzhalter-Tiefe |
| `MICROSOFT_INTEGRATION.md` | ❌ |
| `GOOGLE_INTEGRATION.md` | ❌ |
| `HUBSPOT_INTEGRATION.md` | ❌ |
| `TELEPHONY.md` | ❌ |
| `LOCAL_DEVELOPMENT.md` | ✅ (Phase 16) |
| `DEPLOYMENT.md` | ❌ |
| `TESTING.md` | ❌ |
| `ASSUMPTIONS.md` | ✅ |
| `KNOWN_LIMITATIONS.md` | ✅ (Phase 16) |

**8 von 16 geforderten Dateien fehlen.** ❌ **Mermaid-Diagramme**: keines
der vorhandenen Dokumente enthält ein einziges Mermaid-Diagramm — weder
System Context noch Internal Architecture noch die beiden
Sequenzdiagramme (Finance/Sales) wie in §56 explizit gefordert. Ein reiner
Prosa-/Tabellen-Ansatz wurde stattdessen gewählt.

## §57-58 — UX-Prinzipien

✅✅ Konsequent eingehalten. `status-labels.ts` übersetzt jeden internen
Status in verständliche deutsche Begriffe, keine Entwickler-/AI-Fachbegriffe
im UI. ✅ Startseite ist explizit als Dashboard/Redirect gestaltet, nicht
als Chat — sogar mit einem Code-Kommentar, der §58 direkt zitiert.

## §59 — Abnahmekriterien (6 Szenarien)

| Szenario | Status |
|---|---|
| A — Finance (E-Mail → … → Transfer, 14 Schritte) | ⚠️ Kernkette (Extraktion→Dublettenprüfung→Buchungsvorschlag→Freigabe→Transfer→Audit) live verifiziert; Schritte 1-3 (E-Mail empfangen, Anhang speichern *aus* E-Mail, Case wird erzeugt) fehlen — Prozess beginnt bei direktem Upload, kein automatischer Case |
| B — Duplicate | ✅ vollständig, live getestet |
| C — Bank Change | ❌ vollständig fehlend (kein IBAN-Tracking, keine Risiko-Markierung) |
| D — Sales Email | ⚠️ Lead+Task-Erzeugung funktioniert; Schritt 1 (E-Mail-Erkennung/Intent) fehlt, Lead entsteht per Formular; kein "Follow-up-Vorschlag" als eigene Entität, nur die Task selbst |
| E — Phone/Twilio | ❌ vollständig fehlend (Telefonie-Connector in keinen Workflow eingebunden) |
| F — Multi Tenant | ✅✅ vollständig, mehrfach und auf zwei Ebenen bewiesen |

**Nur 2 von 6 benannten Abnahme-Szenarien sind vollständig erfüllt.**

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

Für eine Umsetzung über diesen Stand hinaus, nach Hebelwirkung sortiert:

1. **Agentenarchitektur verdrahten** (§12-17, größte Einzellücke) —
   `AgentModule` bauen, mindestens die Tools für Rechnungs- und
   Lead-Verarbeitung real registrieren, `AgentRuntime` an einen Trigger
   hängen. Ohne das bleibt das zentrale Produktversprechen unerfüllt.
2. **E-Mail-Eingang simulieren** (Grundlage für §59 Szenario A/D) — ein
   einfacher "E-Mail-Anhang hochladen"-Trigger würde bereits die
   Kernlücke in beiden Hauptprozessen schließen, auch ohne echten
   Mail-Connector.
3. **Fehlende Kern-Frontend-Seiten**: `/cases/[id]`, Lead-Detail,
   `/activity`, `/admin/policies` (Policy Engine hat sonst keine UI) —
   höchster Nutzen pro Aufwand, da Backend-Daten meist schon existieren.
4. **`docs/SECURITY.md`, `docs/DOMAIN_MODEL.md`, `docs/DEPLOYMENT.md`,
   `docs/TESTING.md`** nachziehen — reine Dokumentationsarbeit, kein
   Coderisiko.
5. **IBAN-Tracking + Bank-Change-Erkennung** (§59 Szenario C) — kleiner,
   klar umrissener Scope, schließt ein explizit benanntes
   Abnahme-Kriterium.
6. **DSGVO-Admin-Funktionen** (§52) — Datenexport, Nutzer-Deaktivierung,
   Tenant-Löschung: rechtlich relevant, aktuell komplett offen.
7. **Datenschutz/Security-Detailarbeit**: CREDENTIAL_ENCRYPTION_KEY
   tatsächlich nutzen, Datei-Upload-Limits serverseitig durchsetzen,
   Idempotency für künftige Webhooks vorbereiten.

Diese Datei ergänzt, ersetzt aber nicht
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) (Komponentenstatus)
und [`MVP_COMPLETION_REPORT.md`](MVP_COMPLETION_REPORT.md) (Management
Summary) — sie ist die Abschnitt-für-Abschnitt-Belegdatei für beide.
