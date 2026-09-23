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

**~~Zweitgrößte Lücke: Frontend-Seitenabdeckung~~ Vollständig behoben
in Phase 19a/19h/19i** (§32) — `/cases` + `/cases/[id]`, `/sales/leads/[id]`,
`/sales/opportunities` + `/sales/opportunities/[id]`, `/activity`,
`/admin/policies`, `/inbox`, `/integrations`, `/admin/users` und
`/admin/settings` existieren jetzt alle, mit den passenden neuen
Backend-Endpunkten (`GET /api/v1/agent-runs`, angereicherte
`CasesService.findOne()`/`LeadsService.findOne()`, neues
`PolicyController`-CRUD, neues `EmailMessagesModule`, `GET
/tenants/me`). Alle live im Browser gegen echte Postgres/MinIO
verifiziert.

**Drittgrößte Lücke:** Von 6 benannten Abnahme-Szenarien (§59) sind seit
Phase 19e 3 vollständig erfüllt (Duplicate, ~~Bank-Change~~, Multi-Tenant),
2 seit Phase 18 deutlich näher am Soll aber nicht vollständig (Finance,
Sales — der Trigger bleibt simuliert statt real), 1 vollständig unerfüllt
(Telefonie, braucht Twilio-Credentials).

**Dokumentation:** ~~8~~ ~~4~~ 0 von 16 geforderten Dateien fehlen noch.
`SECURITY.md`, `DOMAIN_MODEL.md`, `DEPLOYMENT.md`, `TESTING.md` seit
Phase 19d geschrieben, inkl. der zuvor komplett fehlenden
Mermaid-Diagramme (§56: System Context, Internal Architecture, beide
Sequenzdiagramme Finance/Sales — jetzt alle in `ARCHITECTURE.md`). Die
vier Provider-spezifischen Integrationsdokumente
`MICROSOFT_INTEGRATION.md`, `GOOGLE_INTEGRATION.md`,
`HUBSPOT_INTEGRATION.md`, `TELEPHONY.md` seit Phase 19i geschrieben —
sie dokumentieren ehrlich, was für eine echte Anbindung fehlt
(Credentials/App-Registrierung, bei Telefonie zusätzlich der komplett
fehlende Anruf-Workflow), ohne Drittanbieter-API-Endpunkte zu erfinden.

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
| TenantModule | ✅ seit Phase 19i — `tenants.module.ts` hat jetzt einen echten REST-Controller (`GET /tenants/me`, `/export`, `/deletion-request`, `/deletion-confirm`), vorher nur intern für Bootstrap/Login nutzbar |
| UserModule | ✅ seit Phase 19f/19i — eigenes `UsersModule` (`GET /users`, `PATCH /users/:id/deactivate`), Frontend `/admin/users` seit Phase 19i. **Weiterhin fehlend**: Einladen (Nutzer-Anlage geht bisher nur über Tenant-Bootstrap/Seed, kein Self-Service-Invite-Flow) |
| CaseModule | ✅ (`cases`) |
| TaskModule | ✅ (`tasks`) |
| DocumentModule | ✅ (`documents`) |
| CommunicationModule | ⚠️ kein Modul dieses Namens, aber `EmailMessage` existiert seit Phase 18 als Modell + eigenes `EmailMessagesModule` seit Phase 19i (`GET /email-messages`); `Call`/`CallTranscript` existieren weiterhin nicht (siehe §28/`docs/TELEPHONY.md`) |
| FinanceModule | ⚠️ funktional abgedeckt, aber als `suppliers`+`invoices` statt einem Modul |
| SalesModule | ⚠️ funktional abgedeckt, aber als `companies`+`contacts`+`leads`+`opportunities`+`meetings` |
| ApprovalModule | ✅ seit Phase 19c — `approvals` hat funktionierende Freigeben-/Ablehnen-Aktionen (siehe §37) |
| PolicyModule | ✅ (`policy`), inkl. Admin-CRUD seit Phase 19h |
| AgentModule | ✅ seit Phase 18 — `AgentModule`, `IntakeService`, 15 Tools, `POST /intake/emails`, live verdrahtet (siehe §12-17) |
| IntegrationModule | ✅ seit Phase 19g/19i — `IntegrationsModule` (`GET/PUT/DELETE /integrations`), verschlüsseltes `IntegrationCredential`-Handling, Frontend `/integrations` |
| NotificationModule | ❌ existiert nicht |
| AuditModule | ✅ (`audit`), aber weiterhin kein Lese-Endpunkt (`GET /audit` existiert nicht — Audit-Daten sind nur eingebettet über andere Endpunkte einsehbar, z. B. `TenantDataExport`) |
| MetricsModule | ❌ existiert nicht |
| AdminModule | ⚠️ kein eigenes Backend-Modul dieses Namens, aber die Admin-Funktionalität selbst ist seit Phase 19h/19i vollständig verteilt vorhanden (`PolicyModule`, `IntegrationsModule`, `UsersModule`, `TenantsController`) und im Frontend unter `/admin/*` gebündelt |

**Nur noch 2 von 17 geforderten Modulen fehlen vollständig**
(NotificationModule, MetricsModule — beide bräuchten Infrastruktur, die
in diesem MVP bewusst nicht existiert, siehe §60 Nicht-Ziele/§3 Queue),
3 weitere sind aus benannten Gründen nur teilweise/strukturell vorhanden
(CommunicationModule, FinanceModule/SalesModule als Namenskonvention
statt fachlicher Lücke, AdminModule als Namenskonvention). Stand zu
Beginn dieser Session (Phase 16): 7 fehlten vollständig, 4 weitere nur
teilweise — der Großteil dieser Lücke wurde in den seither
durchlaufenen Phasen (18–19i) geschlossen.

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
`iban`✅(seit Phase 19e, als `supplierIban`) `dueDate`✅ `paymentTerms`❌
`lineItems`❌. **6 von 14 Feldern fehlen** noch. `iban` schließt direkt
§59 Szenario C (siehe dort). `confidence`/`source` pro Feld ⚠️ nur global
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

⚠️ **Idempotency-Infrastruktur seit Phase 19g vorbereitet, aber noch
kein tatsächlicher Webhook-Endpunkt.** Neues `WebhookEvent`-Modell
(eigene RLS-Migration) + `WebhookIdempotencyService.recordIfNew()`
unterscheidet Duplikate DB-atomar über `(tenantId, source,
externalEventId)` — mit echtem Nebenläufigkeitstest (5 parallele
Zustellungen desselben Ereignisses, genau eine gewinnt) live
verifiziert. **Weiterhin fehlend**: kein konkreter `POST
/webhooks/:provider`-Endpunkt, keine Signaturprüfung (z. B. Twilios
`X-Twilio-Signature`, Microsoft-Graph-Validation-Tokens) — beides kann
erst sinnvoll gebaut werden, sobald eine der realen Mail-/CRM-/
Telefonie-Anbindungen existiert, die tatsächlich Webhooks sendet
(siehe `docs/MICROSOFT_INTEGRATION.md`/`GOOGLE_INTEGRATION.md`/
`TELEPHONY.md`) — ein echter, dokumentierter Credentials-Blocker,
keine offene Implementierungslücke der Idempotenz-Logik selbst.

## §30 — Integrations-Credentials

✅ Seit Phase 19g tatsächlich implementiert: `CredentialEncryptionService`
(`apps/api/src/security/`) nutzt `CREDENTIAL_ENCRYPTION_KEY` für echtes
AES-256-GCM (IV + Auth-Tag + Chiffretext in einem `Bytes`-Feld,
`Integration.encryptedCredentials`), verdrahtet über das neue
`IntegrationsModule` (`PUT /integrations/:connectorType/credentials`).
Klartext wird nie über die API zurückgegeben (nur `hasCredentials:
boolean`). Live verifiziert: Chiffretext im `psql`-Hexdump bestätigt,
kein Klartext-Fund. Seit Phase 19i zusätzlich über die
`/integrations`-Frontend-Seite bedienbar (siehe §39).

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
| `/inbox` | ✅ seit Phase 19i — siehe §34 |
| `/cases`, `/cases/[id]` | ✅ seit Phase 19a — Liste (mit Finance/Sales-Filter) + Detailseite mit allen verknüpften Datensätzen (Tasks, Dokumente, E-Mails, Rechnungen, Leads, Agent-Läufe inkl. Tool-Aufrufe) |
| `/finance` | ❌ (nur `/finance/invoices`, `/finance/suppliers` direkt) |
| `/finance/invoices`, `/finance/invoices/[id]` | ✅ |
| `/sales` | ❌ |
| `/sales/leads`, `/sales/leads/[id]` | ✅ seit Phase 19a — Detailseite mit Kontakt/Firma, Status-Wechsel, verknüpften Opportunities |
| `/sales/opportunities`, `/sales/opportunities/[id]` | ✅ seit Phase 19a — Liste, Anlage-Formular, Detailseite mit Stage-Wechsel |
| `/approvals` | ✅ seit Phase 19c — funktionierende Freigeben-/Ablehnen-Buttons, korrekt dispatchend je Entitätstyp (siehe §37) |
| `/tasks` | ✅ |
| `/activity` | ✅ seit Phase 19a — Agent-Run-Feed mit Tool-Aufrufen, Filter nach Agent-Typ, Link zum zugehörigen Vorgang |
| `/integrations` | ✅ seit Phase 19i — Frontend über neue `use-integrations.ts`-Hooks gegen das seit Phase 19g fertige Backend (`GET/PUT/DELETE /integrations`), alle 7 Connector-Typen, live verifiziert inkl. Credential-Verschlüsselung in der DB |
| `/admin/policies` | ✅ seit Phase 19h — Liste aller 16 Policy-Actions mit Modus-Dropdown je Zeile, live gegen echtes Backend, respektiert gesperrte Ober­grenzen |
| `/admin/users` | ✅ seit Phase 19i — Liste aller Tenant-Nutzer mit Status-Badge, Deaktivieren-Aktion (eigenes Konto geschützt), live verifiziert |
| `/admin/settings` | ✅ seit Phase 19i — Tenant-Stammdaten, DSGVO-Datenexport-Download, zweistufiger Lösch-Workflow (Beantragen → Name-Bestätigung → Löschen), live bis vor dem irreversiblen letzten Schritt verifiziert |

**Alle spezifizierten Detail-/Funktionsrouten sind vorhanden.** Nur
`/finance` und `/sales` als reine Übersichtsseiten (ohne eigene Funktion
über die Unterrouten hinaus) bleiben offen — niedrige Priorität, da
jede Unterroute direkt erreichbar und voll funktional ist.

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

✅ seit Phase 19i: `/inbox` zeigt jede `EmailMessage` (Richtung, Von/An,
Betreff, Klassifikation, verknüpfter Vorgang) über einen neuen,
lesenden `GET /email-messages`-Endpunkt (neues `EmailMessagesModule`).
Enthält zusätzlich ein Formular, das eine eingehende E-Mail direkt aus
dem UI simuliert (ruft denselben `POST /intake/emails`-Endpunkt wie
zuvor nur per curl/Test erreichbar auf) — der Agent-Lauf dahinter ist
dabei vollständig echt, nur der Auslöser bleibt manuell (kein echter
Mail-Connector-Webhook, siehe §23/§29). Live verifiziert: E-Mail
simuliert, als „Sales" klassifiziert, Case automatisch angelegt, in der
Liste sichtbar mit funktionierendem Link zum Vorgang.

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

⚠️ **Backend seit Phase 19g, Frontend seit Phase 19i.** `IntegrationsModule`:
`GET /integrations` (Status je Connector-Typ, inkl. `hasCredentials`,
nie die Credentials selbst), `PUT /integrations/:connectorType/credentials`
(verschlüsselt speichern, siehe §52/`docs/SECURITY.md` Abschnitt 4),
`DELETE /integrations/:connectorType` (trennen). `/integrations` zeigt
jetzt alle 7 Connector-Typen (DATEV, Lexware, Microsoft, Gmail, Google
Calendar, HubSpot, Twilio) mit Status-Badge und einem
Credentials-Formular (JSON-Textarea) je Zeile. Live verifiziert: DATEV
mit Test-Credentials verbunden, `encrypted_credentials` in der DB per
`psql`-Hexdump als echtes Chiffrat bestätigt (kein Klartext), danach
erfolgreich wieder getrennt. **Weiterhin bewusst fehlend**: ein
Test-Connection-Button — `testConnection()` existiert zwar auf jeder
Connector-Ebene, ist aber bewusst noch nicht an die neuen Endpunkte
angebunden (der `IntegrationConnectorType`-Enum ordnet z. B.
`MICROSOFT` sowohl Mail als auch Kalender zu, eine eindeutige Zuordnung
zu genau einem der fünf `*_CONNECTOR`-DI-Tokens bräuchte eine eigene
Design-Entscheidung, die hier bewusst nicht mitgezogen wurde).

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
Postgres verifiziert (siehe `intake-workflow.e2e-spec.ts`) — seit Phase
19i zusätzlich direkt aus dem UI heraus auslösbar (`/inbox`-Seite mit
Simulations-Formular, siehe §34). **Einschränkung bleibt**: der Trigger
ist weiterhin simuliert (manueller Aufruf, jetzt auch per UI statt nur
per API), kein echter Mail-Connector-Webhook ruft ihn automatisch auf.

*Hinweis: Die aktuell laufende Datenbank enthält durch wiederholte
E2E-Testläufe dieser Session deutlich mehr Datensätze (33 Lieferanten, 49
Rechnungen etc.) als das Seed-Skript selbst anlegt — das ist ein
Testartefakt, kein Demo-Design, und wird durch `pnpm prisma:seed`
zurückgesetzt.*

## §46-47 — Tests und Qualitätskriterien

✅ Unit-Tests für Policy Engine, Duplicate Detection, Tenant Isolation,
Permission Checks, Connector Mapping — vorhanden und aussagekräftig.
✅ "Agent Tool Validation" seit Phase 18 auch für reale, live verdrahtete
Tools (15 konkrete Tools über `ToolRegistry`, siehe §12-17) — vorher nur
gegen die damals noch ungenutzte `ToolRegistry` selbst getestet. ❌
Integration-Tests für Queue+Worker: weiterhin nicht vorhanden (keine
Queue, siehe §3, bewusstes Nicht-Ziel dieses MVP). ✅ Agent-Workflow-Tests:
seit Phase 18 vorhanden (`intake-workflow.e2e-spec.ts`, deckt Finance-
und Sales-Pfad sowie den OTHER-Pfad ab, live gegen echte Postgres/MinIO).
E2E mit Playwright: Finance-Szenario
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
Datei-Uploads (Presigned-URL-Pattern), Path-Traversal-Schutz. ✅ **Secret
Encryption**: siehe §30 — seit Phase 19g tatsächlich implementiert
(vorher nur validierte, aber ungenutzte Env-Var). ⚠️ **Dateigrößenlimits/
MIME-Prüfung**: seit Phase 19g serverseitig durchgesetzt
(`MAX_UPLOAD_SIZE_BYTES`/`ALLOWED_UPLOAD_MIME_TYPES`, 403 bei
Überschreitung/falschem Typ, live verifiziert) — **Einschränkung**: geprüft
werden die vom Client deklarierten `sizeBytes`/`mimeType`-Metadaten vor
Ausstellung der Presigned-URL, nicht die tatsächlich zu MinIO
hochgeladenen Bytes selbst (siehe `docs/SECURITY.md` §5). ⚠️ **Webhook
Verification**: siehe §29 — Idempotency-Infrastruktur seit Phase 19g
vorbereitet, aber weiterhin kein echter Webhook-Endpunkt mit
Signaturprüfung (Blocker: keine reale Anbindung, die Webhooks sendet).
❌ **CSRF-Konzept**: weiterhin nicht dokumentiert (mildernd: Bearer-Token
statt Cookie-Session reduziert das Risiko strukturell, ersetzt aber kein
explizites Konzept wie gefordert). ❌ **Idempotency (allgemeine
API-Idempotency-Keys für Schreiboperationen)**: weiterhin nirgends
implementiert — zu unterscheiden von der oben genannten,
webhook-spezifischen Duplikat-Erkennung, die einen anderen, engeren
Zweck erfüllt. ⚠️ Sichere Tokens: JWT in `localStorage` statt
httpOnly-Cookie (bewusste, dokumentierte MVP-Abwägung, ASSUMPTIONS
#68/#92).

## §51 — Prompt-Injection-Schutz

⚠️ **Seit Phase 18 nicht mehr gegenstandslos — es gibt jetzt einen
echten Code-Pfad**, der potenziell angreifer-kontrollierten Input in
einen LLM-Aufruf einbettet: `IntakeService.classify()`
(`apps/api/src/intake/intake.service.ts`) baut aus `input.subject` +
`input.bodyText` einer eingehenden E-Mail direkt den `user`-Message-
Inhalt zusammen (`Betreff: ${subject}\n\n${bodyText}`), getrennt vom
statisch im Code verankerten `systemPrompt` über die reguläre
System-/User-Rollentrennung der `LLMProvider`-Schnittstelle (analog zu
Anthropics `system`- vs. `messages`-Kanaltrennung). **Was tatsächlich
vorhanden ist**: die grundlegende Rollentrennung (System-Instruktion
kommt nie aus Nutzerdaten) sowie die nachgelagerte Policy-Engine, die
jeden vom Modell vorgeschlagenen Tool-Aufruf unabhängig vom Prompt-Inhalt
gegen feste Autonomie-Regeln prüft (ein injizierter Befehl wie "führe
`payment.execute` aus" würde trotzdem an der gesperrten Policy scheitern,
siehe §17/§39) — eine echte, wenn auch indirekte Verteidigungsschicht.
**Was fehlt**: die explizit geforderte Vier-Wege-Trennung SYSTEM
INSTRUCTIONS/BUSINESS DATA/USER CONTENT/TOOL RESULTS als eigenes
Konzept (aktuell nur zwei Kanäle: System vs. User), keine Auszeichnung
von E-Mail-Inhalt mit Delimitern/Warnhinweisen ("der folgende Text ist
Nutzerdaten, keine Instruktion"), keine Ausgabe-Validierung gegen
prompt-injizierte Tool-Aufrufe über die ohnehin vorhandene
Policy-Engine-Prüfung hinaus. Kein dedizierter Test für einen
Prompt-Injection-Versuch in einer simulierten E-Mail vorhanden.

## §52 — Datenschutz

⚠️ **Seit Phase 19f größtenteils umgesetzt, eine Anforderung bewusst
zurückgestellt.** Neu:

- **Datenexport** (`GET /tenants/me/export`): ein einzelnes JSON-Bundle
  aller ~19 tenant-gescopten Collections (Users ohne Passwort-Hash,
  Cases, Tasks, Documents, Invoices, Suppliers, Leads, Opportunities,
  AgentRuns, AuditLogs, …), live gegen echte Postgres verifiziert.
- **Nutzer-Deaktivierung** (`PATCH /users/:id/deactivate`, neues
  `UsersModule`): setzt `User.status = DEACTIVATED` **und** widerruft
  sofort alle aktiven Refresh-Tokens (nicht nur künftige Logins
  gesperrt) — live per E2E-Test verifiziert, inkl. Ablehnung der
  Selbst-Deaktivierung.
- **Tenant-Löschungsworkflow** (`POST /tenants/me/deletion-request`,
  `DELETE /tenants/me/deletion-request` zum Abbrechen,
  `POST /tenants/me/deletion-confirm`): zweistufig als bewusste
  Sicherheitshürde gegen versehentliche Löschung. `confirmDeletion()`
  löscht die Tenant-Zeile tatsächlich (kaskadiert durch alle Kindtabellen)
  — live gegen einen frisch angelegten Wegwerf-Tenant verifiziert, nie
  gegen den Musterwerk-Demo-Mandanten.

**Bewusst nicht umgesetzt**: Retention-Settings (keine
Aufbewahrungsfristen-Konfiguration und kein automatisierter
Lösch-/Anonymisierungs-Job nach Ablauf einer Frist) — dafür gibt es
im Schema keinerlei Grundlage (kein Retention-Policy-Feld auf Tenant
oder einzelnen Entitäten) und kein Scheduler/Cron-Mechanismus im
MVP; ein unvollständiger Konfigurations-Stub ohne tatsächliche
Durchsetzung wäre schlechter als eine ehrlich offene Lücke gewesen
(§63). Alle drei umgesetzten Endpunkte sind zudem nur für Mitglieder
der (pro Tenant seedbaren) `SYSTEM_ADMIN`-Rolle erreichbar
(`TENANT_MANAGE`), nicht für `TENANT_ADMIN` — konsistent mit der
bereits bestehenden `DEFAULT_ROLE_PERMISSIONS`-Entscheidung, siehe
`docs/ASSUMPTIONS.md` #126.

Nebenbei gefunden und behoben: ein echter, bis dahin nie ausgelöster
Bug in `packages/domain/src/tenant-scope.ts` (`RefreshToken`,
`RolePermission`, `UserRole` fälschlich als "tenant-scoped" gelistet,
obwohl keines eine eigene `tenant_id`-Spalte hat) — siehe
`docs/ASSUMPTIONS.md` #129.

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
| `MICROSOFT_INTEGRATION.md` | ✅ (Phase 19i) |
| `GOOGLE_INTEGRATION.md` | ✅ (Phase 19i) |
| `HUBSPOT_INTEGRATION.md` | ✅ (Phase 19i) |
| `TELEPHONY.md` | ✅ (Phase 19i) |
| `LOCAL_DEVELOPMENT.md` | ✅ (Phase 16) |
| `DEPLOYMENT.md` | ✅ (Phase 19d) |
| `TESTING.md` | ✅ (Phase 19d) |
| `ASSUMPTIONS.md` | ✅ |
| `KNOWN_LIMITATIONS.md` | ✅ (Phase 16) |

**0 von 16 geforderten Dateien fehlen noch.** Die vier Provider-
spezifischen Integrationsdokumente `MICROSOFT_INTEGRATION.md`,
`GOOGLE_INTEGRATION.md`, `HUBSPOT_INTEGRATION.md`, `TELEPHONY.md` sind
seit Phase 19i geschrieben — jede dokumentiert ehrlich, was für eine
echte Anbindung fehlt (Credentials/App-Registrierung/OAuth-Consent), was
bereits als providerunabhängige Schnittstelle steht (`MailConnector`,
`CalendarConnector`, `CrmConnector`, `TelephonyConnector` + ihre
Mock-Implementierungen) und welche konkreten Provider-API-Endpunkte erst
bei Vorliegen echter Credentials aus der jeweiligen offiziellen
Dokumentation ergänzt werden (nie erfunden, siehe CLAUDE.md).
`TELEPHONY.md` hält zusätzlich fest, dass dort — anders als bei den
anderen drei — nicht nur Credentials fehlen, sondern auch der komplette
fachliche Anruf-Workflow (kein `Call`-Modell, kein Intake-Endpunkt, kein
Klassifikations-Tool), was eine eigene Implementierungsphase wäre. ✅
**Mermaid-Diagramme** seit Phase 19d: System-Context- und
Internal-Architecture-Diagramm in `ARCHITECTURE.md`, die beiden
geforderten Sequenzdiagramme (Finance/Sales) ebenfalls dort, plus sechs
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
| C — Bank Change | ✅ seit Phase 19e: `extract_invoice`/OCR liefert jetzt `supplierIban`, `InvoicesService.createFromDocument()` vergleicht sie gegen die beim Lieferanten hinterlegte IBAN (Format-normalisiert), flaggt bei Abweichung `BANK_CHANGE_SUSPECTED` (neuer `InvoiceStatus`-Wert), erzeugt einen Approval-Eintrag + `SUPPLIER_BANK_DETAILS_CHANGED`-Audit-Event. Neuer Endpunkt `PATCH /invoices/:id/confirm-bank-change` aktualisiert nach menschlicher Bestätigung die Lieferanten-IBAN und setzt den normalen Freigabe-Workflow fort; `reject()` funktioniert ebenfalls für diesen Status. Frontend: Warnbanner mit altem/neuem IBAN-Vergleich auf der Rechnungsdetailseite, korrekt dispatchendes Freigabe-Center. Live gegen echte Postgres verifiziert (neuer E2E-Test + manueller Browser-Durchlauf über beide Wege). Neues Demo-Szenario in `packages/domain/prisma/seed.ts` (Case 5, IT-Service Nord). |
| D — Sales Email | ⚠️ Seit Phase 18 deutlich näher am Soll: `POST /intake/emails` erkennt Sales-Intent (Klassifikation), identifiziert/legt Kontakt und Firma an (`create_company`→`create_contact`, reagieren auf echte Zwischenergebnisse), erzeugt Lead + Case + automatische Folgeaufgabe — live verifiziert. **Fehlt weiterhin**: kein separater "Follow-up-Vorschlag" als eigene Entität (nur die Task selbst), CRM-Sync-Bestätigung nicht im UI sichtbar. |
| E — Phone/Twilio | ❌ vollständig fehlend (Telefonie-Connector in keinen Workflow eingebunden) |
| F — Multi Tenant | ✅✅ vollständig, mehrfach und auf zwei Ebenen bewiesen |

**3 von 6 Szenarien vollständig erfüllt (B, C, F), 2 deutlich verbessert
aber nicht vollständig (A, D — echter Trigger fehlt weiterhin), 1
weiterhin vollständig offen (E, braucht Twilio-Credentials).**

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
3. ~~**Fehlende Kern-Frontend-Seiten**~~ — vollständig erledigt in
   Phase 19a/19h/19i: `/cases` + `/cases/[id]`, `/sales/leads/[id]`,
   `/sales/opportunities` + `/sales/opportunities/[id]`, `/activity`
   (zeigt echte `AgentRun`-Daten inkl. Tool-Aufrufe), `/admin/policies`
   (16 Policy-Actions, Modus-Dropdown, respektiert gesperrte
   Obergrenzen), `/inbox` (echte `EmailMessage`-Liste + Simulations-
   Formular gegen den echten Intake-Endpunkt), `/integrations` (alle 7
   Connector-Typen, Credentials-Formular), `/admin/users`
   (Nutzerliste + Deaktivieren), `/admin/settings` (Stammdaten,
   DSGVO-Export, zweistufige Tenant-Löschung), neue Endpunkte
   `GET /api/v1/agent-runs`, `GET/PATCH /api/v1/policies`,
   `GET /email-messages(/:id)`, `GET /tenants/me`. Alle live im Browser
   verifiziert.
4. ~~**`docs/SECURITY.md`, `docs/DOMAIN_MODEL.md`, `docs/DEPLOYMENT.md`,
   `docs/TESTING.md`**~~ — erledigt in Phase 19d, inkl. der zuvor
   fehlenden Mermaid-Diagramme (§56). ~~Verbleibend~~ Ebenfalls erledigt
   in Phase 19i: `MICROSOFT_INTEGRATION.md`, `GOOGLE_INTEGRATION.md`,
   `HUBSPOT_INTEGRATION.md`, `TELEPHONY.md`.
5. ~~**IBAN-Tracking + Bank-Change-Erkennung**~~ (§59 Szenario C) —
   erledigt in Phase 19e: neuer `InvoiceStatus.BANK_CHANGE_SUSPECTED`,
   Erkennung beim Rechnungs-Upload, `PATCH /invoices/:id/confirm-bank-change`,
   Frontend-Warnbanner, korrekt dispatchendes Freigabe-Center, neuer
   E2E-Test + Demo-Szenario. Live verifiziert.
6. ~~**DSGVO-Admin-Funktionen**~~ (§52) — erledigt in Phase 19f:
   Datenexport, Nutzer-Deaktivierung (inkl. Session-Widerruf),
   zweistufiger Tenant-Löschungsworkflow, alle live verifiziert. Dabei
   nebenbei einen echten, bis dahin nie ausgelösten Bug in
   `tenant-scope.ts` gefunden und behoben. Bewusst offen gelassen:
   Retention-Settings (keine Schema-/Scheduler-Grundlage vorhanden).
7. ~~**Datenschutz/Security-Detailarbeit**~~ — erledigt in Phase 19g:
   CREDENTIAL_ENCRYPTION_KEY tatsächlich genutzt (neues
   `IntegrationsModule` + `CredentialEncryptionService`, AES-256-GCM,
   live verifiziert), Datei-Upload-Limits serverseitig durchgesetzt
   (`MAX_UPLOAD_SIZE_BYTES`/`ALLOWED_UPLOAD_MIME_TYPES`, live
   verifiziert — Einschränkung: nur die *deklarierten* Metadaten werden
   geprüft, nicht die tatsächlich hochgeladenen Bytes, siehe
   `docs/SECURITY.md` §5), Webhook-Idempotenz vorbereitet
   (`WebhookIdempotencyService` + neues `WebhookEvent`-Modell, DB-atomar,
   live inkl. echtem Nebenläufigkeitstest verifiziert — noch kein echter
   Webhook-Empfänger, der es aufruft). Dabei nebenbei einen weiteren
   pre-existing Bug gefunden und behoben: CIs
   `CREDENTIAL_ENCRYPTION_KEY`-Platzhalter dekodierte zu 31 statt 32
   Bytes.
8. ~~**Approval-Center-Frontend nachziehen**~~ — erledigt in Phase 19c:
   funktionierende Freigeben-/Ablehnen-Buttons für `SUPPLIER`/`INVOICE`,
   live verifiziert. Offen bleibt der Resume-Mechanismus für
   `FOLLOW_UP`-Einträge (blockierte Agent-Tool-Aufrufe) — siehe §37.
9. ~~**`/admin/policies`-Backend + Frontend**~~ — erledigt in Phase 19h:
   neues `PolicyController` (`GET /policies`, `PATCH /policies/:action`)
   + `PolicyConfigService` mit Ceiling-Durchsetzung für gesperrte
   Actions (z. B. `payment.execute` kann nie über `DISABLED` hinaus
   geändert werden), neue `/admin/policies`-Seite. Live verifiziert,
   inkl. Audit-Trail (neuer Event-Typ `POLICY_CONFIG_UPDATED`).
10. ~~**Verbleibende Frontend-Lücken + Provider-Doku**~~ — erledigt in
    Phase 19i: `/inbox`, `/integrations`, `/admin/users`,
    `/admin/settings` (samt `EmailMessagesModule` und `GET /tenants/me`
    als neue, dafür nötige Backend-Bausteine) sowie die vier
    verbliebenen Provider-Integrationsdokumente. Damit sind — nach
    bestem Wissen, Stand dieser Datei — **alle im Master-Prompt
    geforderten und ohne externe Provider-Credentials umsetzbaren
    Punkte abgeschlossen.** Die verbleibenden offenen Punkte in dieser
    Datei sind ausnahmslos entweder (a) explizit als niedrige Priorität
    gekennzeichnete Detailtiefe (z. B. Rechnungspositionen,
    Dokumenten-Viewer, Lead-Summary/Meetings-Abschnitt, `/finance`-
    und `/sales`-Übersichtsseiten), (b) bewusste, dokumentierte
    Scope-Entscheidungen (z. B. Tool-Aufruf-Resume-Mechanismus für
    `FOLLOW_UP`, Test-Connection-Button), oder (c) echte externe
    Blocker, die reale Zugangsdaten/Registrierungen bei Drittanbietern
    voraussetzen (Microsoft/Google/HubSpot/Twilio/DATEV-Live-Connectoren,
    echter Mail-Connector-Webhook-Trigger, der komplett fehlende
    Telefonie-Workflow) — siehe §62/§63 sowie die jeweiligen
    `*_INTEGRATION.md`/`TELEPHONY.md`-Dateien.

Diese Datei ergänzt, ersetzt aber nicht
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) (Komponentenstatus)
und [`MVP_COMPLETION_REPORT.md`](MVP_COMPLETION_REPORT.md) (Management
Summary) — sie ist die Abschnitt-für-Abschnitt-Belegdatei für beide.
