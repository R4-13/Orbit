# Bekannte Einschränkungen — Project ORBIT

Ehrlicher Statusüberblick über das, was der MVP (noch) nicht tut. Für den
Status jeder einzelnen Komponente siehe
[`docs/IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md); für die
Begründung jeder einzelnen Entscheidung siehe
[`docs/ASSUMPTIONS.md`](ASSUMPTIONS.md) (hier per Nummer verlinkt).

## Bewusste Nicht-Ziele des MVP (§60)

Keine automatische Bankzahlung (`payment.execute` ist hart auf `DISABLED`
gesperrt, nicht nur default-deaktiviert), keine Lohnbuchhaltung, keine
Steuererklärungen, kein vollautomatischer Monatsabschluss, keine
Anbindung an SAP/Salesforce/Pipedrive, kein vollwertiges CPQ/ERP, keine
native Mobile App, kein Kubernetes-Multi-Region-Deployment. Siehe
[`docs/PRODUCT_CONTEXT.md`](PRODUCT_CONTEXT.md).

## Reale Drittanbieter-Anbindungen: **REQUIRES PROVIDER CREDENTIALS**

Jeder Connector (Finance/Mail/Calendar/CRM/Telephony) hat ein fertiges
Interface + eine getestete Mock-Implementierung
(`packages/integration-core`) — aber keine reale Implementierung:

- **DATEV / Lexware** (Finance) — braucht Partner-/OAuth-Registrierung,
  siehe `docs/DATEV_INTEGRATION.md`.
- **Microsoft 365 / Gmail / Google Calendar** (Mail/Calendar) — braucht
  `MICROSOFT_CLIENT_ID`/`GOOGLE_CLIENT_ID` etc.
- **HubSpot** (CRM) — braucht `HUBSPOT_CLIENT_ID`/`_SECRET`.
- **Twilio** (Telephony) — Interface existiert, ist aber noch in keinen
  konkreten Workflow eingebunden (kein "Anruf → Lead"-Endpunkt).

Eine falsch konfigurierte Provider-Auswahl scheitert beim Boot laut
(`IntegrationUnavailableError`) statt still auf Mock zurückzufallen — kein
Implementierungsrückstand, ein echter Zugangsdaten-Blocker (§62 des
Master-Spec).

## Agent-Runtime: live verdrahtet, aber ohne echten Trigger

Seit Phase 18 gibt es ein `AgentModule` + einen echten Endpunkt (`POST
/api/v1/intake/emails`), der die volle Kette LLM → Tool Registry →
Policy Engine → Tool Gateway → Connector live gegen echte Postgres
ausführt (Communication/Intake-, Finance/AP- und Sales/CRM-Agent). Seit
Phase 19a lässt sich das Ergebnis auch tatsächlich im Frontend
nachvollziehen: `/activity` zeigt jeden `AgentRun` samt seinen
`ToolInvocation`s, `/cases/[id]` zeigt dieselben Läufe im Kontext des
jeweiligen Vorgangs. Was weiterhin fehlt: ein **echter Trigger** — der
Endpunkt *simuliert* eine eingehende E-Mail, es gibt keinen echten
Mail-Connector-Webhook, der ihn automatisch aufruft (kein Microsoft
Graph-/Gmail-Zugang), keine Unified-Inbox-UI, die ihn bedient (siehe
unten), und keinen vierten Agenten-Typ (Orchestrator) als eigenen
LLM-Lauf (das Routing ist deterministischer Code). Details:
[`docs/AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md).

Direkt daraus folgt weiterhin: **echte OCR** (Tesseract) ist nicht
implementiert (`OCR_PROVIDER=tesseract` scheitert beim Boot wie jeder
andere nicht-mock-Connector) — die Finance-Demo nutzt ausschließlich
`MockOcrProvider` mit vorgegebenen Ergebnissen, jetzt auch über den
Agent-Intake-Pfad.

## E-Mail-Eingang (Inbox)

Kein Mail-Connector-Workflow existiert, deshalb wurde auch keine
Inbox-/E-Mail-Ansicht im Frontend gebaut — der Finance-/Sales-Einstieg
"eingehende E-Mail wird erkannt" (§7) ist konzeptionell vorgesehen, aber
mangels Agent-Verdrahtung (siehe oben) noch nicht auslösbar.

## Sicherheit

- **Sitzungen der Mandanten- und der Betreiberanmeldung** liegen nicht mehr im Browser-Speicher: das Zugangstoken nur im Arbeitsspeicher des Tabs, das
  Refresh-Token in einem httpOnly-Cookie (`docs/ASSUMPTIONS.md` #530 Betreiber, #539 Mandanten; ersetzt #68/#92). **Restrisiko:** ein Skript auf der Seite
  (XSS) kann den Refresh im Namen des Browsers auslösen, solange die Seite offen ist – es kann die Tokens aber nicht mehr auslesen und mitnehmen. Nach dem
  Update müssen sich Mandantennutzer einmal neu anmelden (frühere Sitzungen lagen im `localStorage`).
- **Anmelde-Drosselung und Tests:** Die Playwright-Suite meldet sich je Test neu an (das Refresh-Token rotiert, eine Sitzung lässt sich nicht mehr zwischen
  Tests teilen). `AUTH_RATE_LIMIT_MAX` muss für Testläufe deshalb ausreichend hoch stehen (lokal 500); der Standard 60 je 5 Minuten bleibt für den Betrieb.
- **Row-Level Security** deckt 21 von 24 tenant-gescopten Tabellen ab;
  `role_permissions`, `user_roles`, `refresh_tokens` haben keine eigene
  `tenant_id`-Spalte und sind nur indirekt (über die Elterntabelle)
  abgesichert (`docs/ASSUMPTIONS.md` #87).
- **CI-Erweiterungen aus Phase 14/15** (MinIO-Service, RLS-Rollen-Setup-
  Schritt, Playwright-Browser-Install, API-Server-Start für die
  Frontend-E2E-Suite) sind **nicht live gegen einen echten
  GitHub-Actions-Runner verifiziert** — jede Einzelkomponente aber gegen
  das lokale Docker-Äquivalent (`docs/ASSUMPTIONS.md` #83, #89).
- **`pnpm db:reset`** auf einem wiederverwendeten (nicht neu erstellten)
  Postgres-Container verliert die automatische Rechtevergabe für neu
  angelegte Tabellen an die `orbit_app`-Rolle — siehe
  [`docs/LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md) für den Workaround.
- Kein Dependency-Vulnerability-Scanning (`pnpm audit` o. Ä.) ist bisher
  Teil der CI-Pipeline.

## Sonstiges

- **`next build` (Windows)**: schlägt lokal ohne aktivierten
  Windows-Entwicklermodus mit `EPERM: symlink` fehl (Docker-Build
  unbetroffen) — `docs/ASSUMPTIONS.md` #17.
- **Worker-Prozess** (`apps/api/worker`) verarbeitet seit Phase 22
  tatsächlich Jobs (`WorkflowRunProcessor`, siehe
  `docs/SCALABILITY_CONCEPT.md`) — bisher aber nur für den einen neuen,
  additiven `POST .../trigger-async`-Pfad; `POST /intake/emails` läuft
  weiterhin synchron, keine Pro-Tenant-Concurrency-Begrenzung (BullMQs
  Job-Gruppen sind eine kostenpflichtige Pro-Funktion, siehe
  `docs/ASSUMPTIONS.md` #176).
- **OpenTelemetry** ist als Env-Flag (`OTEL_ENABLED`) vorgesehen, aber
  nicht verdrahtet.
- **Dokument-Upload**: keine Antiviren-/Malware-Prüfung hochgeladener
  Dateien; Validierung beschränkt sich auf MIME-Type/Dateigröße im
  Presigned-URL-Request.
- **Demo-Rechnungen** haben keine echten Dokument-Anhänge (siehe
  `docs/DEMO_DATA.md` "Bekannte Einschränkung").

## Business Process Framework (Amendment 02)

* **Live-Nachweis Versand:** Gmail-Versand ist vollständig implementiert und per Unit-/E2E-Test mit Doubles belegt. Ein echter Versand
  braucht die Berechtigung `gmail.send` (Integrationen → „Sendeberechtigung erteilen“, bewusste Zustimmung der Mailbox-Inhaberin bzw. des -Inhabers)
  und `OUTBOUND_MAIL_MODE=gmail`. Ohne diese Zustimmung ist die Fähigkeit `email.send` für den Mandanten **nicht ausführbar** (mit Begründung in der Oberfläche) –
  sie wird nicht „live“ genannt. Im Testbetrieb läuft der Versand mit `OUTBOUND_MAIL_MODE=simulated` und ist überall als **Simuliert** gekennzeichnet.
* **Preisquelle:** der Referenzprozess liest Preise aus einem Test-System-of-Record (`reference_catalog_items`, aus Fixtures). Ein echtes Warenwirtschafts-/ERP-System
  ist nicht angebunden; die Capability-Verträge (`pricing.resolve`) bleiben gleich, die Quelle ist austauschbar. Angebote tragen „Preise aus einem Testdatenbestand – nicht verbindlich“.
* **Reasoning-Modell:** `gpt-6-luna` wird für Tool-Aufrufe mit `reasoning_effort=none` betrieben (Chat Completions lehnt Function-Tools sonst ab). Eine Umstellung auf die Responses-API wäre die Alternative.
  BYOK-Verbindungen senden bisher keinen `reasoning_effort`.
* **Qualität der KI-Extraktion/Planung** ist nur mit wenigen Live-Stichproben geprüft, nicht systematisch bewertet (kein Evaluationskatalog).
* **Anhänge in der Triage** (E21): Anhangsinhalt fließt noch nicht in die Triage/Extraktion ein.
* **Zweite Wartephase:** der Referenz-Blueprint stellt eine automatische Rückfrage (`maxAutoQuestions: 1`); bleiben Angaben nach der Antwort offen, entsteht eine manuelle Prüfaufgabe statt einer zweiten Rückfrage.
* **Graph:** automatisches Schichtlayout ohne Kantenkreuzungs-Optimierung; sehr große Pläne (> 60 Knoten) sind per Validator ausgeschlossen. Kein Drag-and-drop-Editor für Pläne (Aktionen laufen nur über Commands).
* **Aufbewahrung** von `bodyText`/Fakten ist noch nicht an die Retention-Konfiguration gekoppelt.
* **UI v2 – Freigaben:** es gibt keinen Endpunkt für einen Ablehnungsgrund; „Ablehnen“ verlangt eine zweite Bestätigung, speichert aber keinen Freitext.
* **UI v2 – Sonde:** keine Funktion „Antwort stoppen“ (kein Abbruch einer laufenden Modellantwort im Backend); die Modi DELEGATE/NAVIGATE sind nicht verfügbar.
* **UI v2 – Konnektoren:** pro Anbieter ist nur ein Konto wählbar.
* **UI v2 – Prüfungen:** keine manuelle Screenreader- und Mobile-Tastaturprüfung (nur axe-core automatisiert); kein automatisierter Mandantenwechsel A/B im Browser.

## Plattformbetrieb (Amendment 03) und adaptive Orchestrierung (Amendment 02 v1.2)

Stand 07.10.2026. Details: [`PLATFORM_OPERATIONS_ACCEPTANCE_REPORT.md`](PLATFORM_OPERATIONS_ACCEPTANCE_REPORT.md).

* **Plattform-UI teilweise:** `/platform/*` bietet Anmeldung, Übersicht, Mandantenliste mit Zustandsänderung, Feature-Flags, Support-Sitzungen (Vier-Augen), KI-Register mit Routen und Profil-Veröffentlichung, Betreiberzugänge, Notschalter, Anbindungskatalog und Audit ([`PLATFORM_UI.md`](PLATFORM_UI.md)). Anbieter/Modelle/Profilentwürfe/Plattformverbindungen anlegen, Flag-Ausnahmen und der Zugriff auf Vorgangsinhalte in Support-Sitzungen sind nur über die API bedienbar. Betreiber-Zugänge werden mit `scripts/platform-bootstrap.ts` angelegt (Passwort aus der Umgebung, nie im Chat/Log).  Die Betreibersitzung nutzt ein httpOnly-Cookie fürs Refresh-Token und hält das Zugangstoken nur im Arbeitsspeicher (siehe PLATFORM_UI.md); ein Skript auf der Seite kann den Refresh weiterhin auslösen, das Token aber nicht entwenden. Der Mandanten-Teil der Anwendung speichert seine Token weiterhin im `localStorage` (MVP-Vereinfachung, Sicherheitshärtung offen).
* **Passwort:** Betreiber können ihr Passwort selbst ändern (andere Sitzungen enden). Der Owner kann ein vergessenes Passwort zurücksetzen (einmaliges Startpasswort, Wechsel erzwungen). Eine Ablaufdauer und ein Passwort-Verlauf gibt es nicht; die Weitergabe des Startpassworts liegt beim Owner (kein E-Mail-Versand).
* **Kein MFA:** Step-up ist Passwort-Re-Authentifizierung; eine echte zweite Stufe (TOTP/WebAuthn) fehlt.
* **KI-Anbieter:** zwei Adapter sind registriert und mit Mock getestet; ein zweiter echter Anbieter ist **REQUIRES PROVIDER CREDENTIALS**. Profil-Fähigkeiten werden für BYOK-Modelle nicht geprüft; `BUSINESS_DRAFTING` hat noch keinen Aufrufer.
* **Health/Kosten:** Health entsteht aus echten Aufrufen, es gibt keine aktive periodische Prüfung (sie würde echte, bezahlte Aufrufe auslösen). Kosten entstehen nur mit hinterlegtem Kostenprofil; Kosten-Leitplanken (Warnung, Soft-, Hard-Limit, Anomalie-Alarm) bewerten ausschließlich diese Messwerte – Aufrufe ohne Kostenprofil werden getrennt ausgewiesen, ihr Betrag ist unbekannt. Limits sind monatlich (UTC), eine Währung je Limit; Mandanten mit eigenem Schlüssel (BYOK) sind ausgenommen.
* **Connector-Sperre:** neue Verbindungen und Aktionen werden gesperrt, bereits laufende Aktionen aber nicht aktiv beendet.
* **Region:** Region-/Datenrichtlinie wird vor der Modellwahl geprüft, es gibt keine mandantenspezifische Region.
* **Termine vereinbaren:** ORBIT erkennt den Terminbedarf, schlägt Vor-Ort- oder Telefontermine zu freien Zeiten vor (Google-Kalender, nur frei/belegt) und hält die Terminwahl der Kundschaft als Fakt fest. Der **Kalendereintrag** selbst und die Zuordnung eines bestimmten Monteurs werden nicht automatisch angelegt (dafür wäre Schreibzugriff und die Richtlinie „Termin anlegen“ nötig); danach wartet der Vorgang auf das Ergebnis des Termins (Aufmaß/Befund), das eine Person einträgt. Gesetzliche Feiertage kennt die Terminvorschlags-Logik nicht. Die Kalenderanbindung ist **nicht live gegen einen echten Google-Kalender** geprüft.
* **KI-Anforderungsanalyse:** Qualität und Umfang der Rückfragen hängen vom Modell ab (live mit `gpt-6-luna` geprüft: Fenstertausch im Altbau → 4 gezielte Fragen + Vor-Ort-Termin). Der Branchenkontext stammt aus dem Leistungskatalog und der Firmenbezeichnung des Mandanten; branchenspezifische Prüflisten pro Leistung (z. B. Pflichtangaben je Gewerk) gibt es nicht als Konfiguration, die KI leitet sie ab. Die Analyse läuft einmal je Vorgang; ändert die Kundschaft die Anfrage später grundlegend, wird nicht neu analysiert.
* **Gmail-Verbindung und Google-Testmodus:** Steht der Google-Zustimmungsbildschirm auf „Testing“, läuft die Zustimmung nach 7 Tagen ab; ORBIT erkennt das (`invalid_grant`), meldet es per Banner und lässt Freigaben offen, kann die Zustimmung aber nicht selbst erneuern – dafür braucht es den Status „In production“ (ggf. mit Google-Verifizierung), siehe [`GOOGLE_INTEGRATION.md`](GOOGLE_INTEGRATION.md). Echter Versand über Gmail ist weiterhin nicht live gegen ein Postfach mit `gmail.send`-Zustimmung belegt.
* **Automatisierungsgrad:** Neue Mandanten starten auf „Vorsichtig“; die Eingangsrechnungs-Freigabe und die Prüfung unsicherer Eingänge sind eigene Kontrollen außerhalb der Stufen. Wie hoch der Anteil menschlicher Eingriffe im Echtbetrieb tatsächlich ist, ist mit den vorhandenen Testdaten nicht belastbar messbar.
* **Diagnose:** Es gibt eine Diagnoseseite und einen Export als Datei (nur Metadaten, geschwärzt, mit Step-up und Prüfsumme im Audit). Die Queue-/Worker-Gesundheit wird gemessen und alarmiert (Audit-Ereignis je Zustandswechsel, optionaler Webhook, Banner); der Arbeitsstand ist eine Momentaufnahme über alle Mandanten (Zähler, keine Aufschlüsselung nach Mandant oder Vorgang – die Einzelsicht liefert die Kennungssuche der Diagnose, die nur Kennungen kennt, keine Freitextsuche), es gibt keine Verlaufsansicht und keine Auswertung nach Mandant oder Auftragsart, und fällt die API selbst aus, alarmiert niemand – dafür braucht es einen externen Check (z. B. `/health/ready`). Getestet sind Flag-Änderung während Rollout, Connector-Sperre während einer offenen Freigabe und Notschalter + Neuplanung; ein echter **Neustart des Worker-Prozesses** mitten in einem Vorgang ist nicht automatisiert getestet (Wiederaufnahme nach Ausfall belegen der Sweep-Test AD-13 und der Live-Test mit gestopptem Worker).
* **Mandantenlebenszyklus:** `provision`/`offboard`/`close` sind keine Abläufe; es gibt keine Mandanten-Support-Historie.
* **Limits (BP-39):** Aktions- und Fehlerlimits gelten zentral (Standards und Plattformobergrenzen im Code, Blueprint nur verschärfend); ein **Kostenlimit je Vorgang** fehlt (die KI-Nutzung wird nicht einem Vorgang zugeordnet; Kosten-Leitplanken gibt es je Plattform, Mandant und Profil), und die Limits sind nicht je Mandant einstellbar. Der Zielstatus (`completion.evaluated`) steht als Ereignis in der Vorgangshistorie, nicht als eigene Ansicht.
* **Auflösungsleiter:** Stufen Fachsystem und weitere Quelle werden nur ausgewertet, soweit vorhandene Tools sie als Faktenquelle liefern.
* **Live-Nachweis:** Versand bleibt `SIMULATED` (echter Gmail-Versand **BLOCKED_BY_EXTERNAL_PERMISSION**); die neuen Pfade sind nicht mit einem echten Modell live bewiesen.
