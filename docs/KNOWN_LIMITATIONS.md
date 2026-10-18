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

## Agent-Runtime und Eingang

Die Agent-Runtime (LLM → Werkzeug-Register → Policy-Engine → Connector) ist live verdrahtet. Der Eingang läuft über den **echten Gmail-Abruf** (Poll-Adapter, Sync-Queue), eine
semantische Triage mit echtem Modell und die Prozess-Engine; `POST /api/v1/intake/emails` bleibt als simulierter Eingang für Tests und Demos. `/inbox` und `/activity` zeigen
Eingänge, Entscheidungen und Läufe. Was fehlt: Mail-Anbieter außer Gmail (Microsoft 365 braucht Zugangsdaten), ein Eingang über Webhooks mit Signaturprüfung und
**echte OCR** (`OCR_PROVIDER=tesseract` scheitert beim Boot wie jeder nicht implementierte Connector) – die Rechnungsauslesung nutzt den `MockOcrProvider`. Details:
[`docs/AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md), offene Punkte: [`OPEN_DEVELOPMENT_ITEMS.md`](OPEN_DEVELOPMENT_ITEMS.md).

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
- **Worker-Prozess** (`apps/api/worker`): Workflow-Läufe, Postfach-Abruf, Prozess-Sweep, Kundenstamm-Nachprüfung und Mitarbeitermeldungen laufen als Jobs. Die
  Mandanten-Fairness ist eine eigene Umsetzung (BullMQs Job-Gruppen sind eine kostenpflichtige Pro-Funktion, `docs/ASSUMPTIONS.md` #176). Ein **Lasttest** mit Latenzbudgets
  fehlt (`OPEN_DEVELOPMENT_ITEMS.md` UNI-01); für E2E-Läufe muss der Docker-Worker gestoppt werden (TEC-06).
- **OpenTelemetry**-Tracing (`OTEL_ENABLED`) ist verdrahtet (Jaeger); Alarmregeln auf den Prometheus-Metriken sind nicht ausgeliefert (TEC-09).
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
* **Anhänge in der Triage** (E21, BPF-02): Text aus Text/CSV/HTML, Word und PDF mit Textebene fließt in Triage und Extraktion ein (je Anhang 4.000, insgesamt 8.000 Zeichen, höchstens 5 Anhänge). **Gescannte PDFs, Bilder und Excel-Dateien werden nicht gelesen** (keine Texterkennung) – das steht dann so in der Anfrage an die KI.
* **Zweite Wartephase:** der Referenz-Blueprint der Angebotsfassung (1.0.0) stellt eine automatische Rückfrage (`maxAutoQuestions: 1`); bleiben Angaben nach der Antwort offen, entsteht eine manuelle Prüfaufgabe statt einer zweiten Rückfrage. Die Übergabefassung (2.0.0) fragt bis zu dreimal (#610).
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
* **Live-Abgleich:** ORBIT wiederholt simuliert abgeschlossene Schritte live und nimmt an einer Verbindung blockierte Schritte wieder auf, sobald der echte Weg verfügbar ist (`docs/ASSUMPTIONS.md` #549). Grenzen: nur Vorgänge der letzten 7 Tage; nichts, was dahinter schon etwas Unumkehrbares bewirkt hat; nie an reservierte Testadressen; der **Preis** bleibt „simuliert“, solange kein echtes Preissystem angebunden ist (Test-Preisquelle). Eine Wiederholung braucht eine neue Freigabe, wenn sich der Inhalt der Nachricht ändert (z. B. durch die nachgeholte KI-Analyse). Die Aufwertung ist mit Doubles und der Datenbank getestet; ein echter Verbindungsausfall mit anschließender Wiederaufnahme gegen Gmail/OpenAI ist nicht live nachgestellt.
* **Termine vereinbaren:** ORBIT erkennt den Terminbedarf, schlägt Vor-Ort- oder Telefontermine zu freien Zeiten vor (Google-Kalender, nur frei/belegt), hält die Terminwahl der Kundschaft als Fakt fest und kann den **gewählten Termin selbst im Kalender anlegen** (Fähigkeit `calendar.book`, Regel „Termin anlegen“, eigene Google-Zustimmung `calendar.events`; `docs/ASSUMPTIONS.md` #568). Nicht vorhanden: die Zuordnung eines bestimmten Monteurs, eine Umbuchung/Absage, gesetzliche Feiertage in der Terminvorschlags-Logik. Die Kalenderanbindung – Lesen **und** Schreiben – ist **nicht live gegen einen echten Google-Kalender** geprüft (Tests mit Doubles); bestehende Verbindungen brauchen die zusätzliche Zustimmung, und im Google-Testmodus läuft sie nach 7 Tagen ab.
* **KI-Anforderungsanalyse:** Qualität und Umfang der Rückfragen hängen vom Modell ab (live mit `gpt-6-luna` geprüft: Fenstertausch im Altbau → 4 gezielte Fragen + Vor-Ort-Termin). Der Branchenkontext stammt aus dem Leistungskatalog und der Firmenbezeichnung des Mandanten; branchenspezifische Prüflisten pro Leistung (z. B. Pflichtangaben je Gewerk) gibt es nicht als Konfiguration, die KI leitet sie ab. Die Analyse läuft einmal je Vorgang; ändert die Kundschaft die Anfrage später grundlegend, wird nicht neu analysiert.
* **Gmail-Verbindung und Google-Testmodus:** Steht der Google-Zustimmungsbildschirm auf „Testing“, läuft die Zustimmung nach 7 Tagen ab; ORBIT erkennt das (`invalid_grant`), meldet es per Banner und lässt Freigaben offen, kann die Zustimmung aber nicht selbst erneuern – dafür braucht es den Status „In production“ (ggf. mit Google-Verifizierung), siehe [`GOOGLE_INTEGRATION.md`](GOOGLE_INTEGRATION.md). Echter Versand über Gmail ist weiterhin nicht live gegen ein Postfach mit `gmail.send`-Zustimmung belegt.
* **Automatisierungsgrad:** Neue Mandanten starten auf „Vorsichtig“; die Eingangsrechnungs-Freigabe und die Prüfung unsicherer Eingänge sind eigene Kontrollen außerhalb der Stufen. Wie hoch der Anteil menschlicher Eingriffe im Echtbetrieb tatsächlich ist, ist mit den vorhandenen Testdaten nicht belastbar messbar.
* **Diagnose:** Es gibt eine Diagnoseseite und einen Export als Datei (nur Metadaten, geschwärzt, mit Step-up und Prüfsumme im Audit). Die Queue-/Worker-Gesundheit wird gemessen und alarmiert (Audit-Ereignis je Zustandswechsel, optionaler Webhook, Banner); der Arbeitsstand ist eine Momentaufnahme über alle Mandanten (Zähler, keine Aufschlüsselung nach Mandant oder Vorgang – die Einzelsicht liefert die Kennungssuche der Diagnose, die nur Kennungen kennt, keine Freitextsuche), es gibt keine Verlaufsansicht und keine Auswertung nach Mandant oder Auftragsart, und fällt die API selbst aus, alarmiert niemand – dafür braucht es einen externen Check (z. B. `/health/ready`). Getestet sind Flag-Änderung während Rollout, Connector-Sperre während einer offenen Freigabe und Notschalter + Neuplanung; ein echter **Neustart des Worker-Prozesses** mitten in einem Vorgang ist nicht automatisiert getestet (Wiederaufnahme nach Ausfall belegen der Sweep-Test AD-13 und der Live-Test mit gestopptem Worker).
* **Mandantenlebenszyklus:** `provision`/`offboard`/`close` sind keine Abläufe; es gibt keine Mandanten-Support-Historie.
* **Limits (BP-39):** Aktions- und Fehlerlimits gelten zentral (Standards und Plattformobergrenzen im Code, Blueprint nur verschärfend); ein **Kostenlimit je Vorgang** fehlt (die KI-Nutzung wird nicht einem Vorgang zugeordnet; Kosten-Leitplanken gibt es je Plattform, Mandant und Profil), und die Limits sind nicht je Mandant einstellbar. Der Zielstatus (`completion.evaluated`) steht als Ereignis in der Vorgangshistorie, nicht als eigene Ansicht.
* **Auflösungsleiter:** Stufen Fachsystem und weitere Quelle werden nur ausgewertet, soweit vorhandene Tools sie als Faktenquelle liefern.
* **Live-Nachweis:** Versand bleibt `SIMULATED` (echter Gmail-Versand **BLOCKED_BY_EXTERNAL_PERMISSION**); die neuen Pfade sind nicht mit einem echten Modell live bewiesen.
* **Mitarbeiterverzeichnis:** Der Abgleich über `PUT /staff/sync` authentifiziert mit dem Zugriffstoken eines Benutzers (`tenant.profile.manage`); ein eigener Dienstzugang (API-Schlüssel mit enger Berechtigung) und die direkte Anbindung an Personalsysteme (Personio, DATEV HR, Entra ID) fehlen (Zugangsdaten nötig). Die erfassten Kanäle Teams, WhatsApp, SMS und Anruf werden noch nicht bedient – Zustellung per E-Mail, im Profil ausgewiesen. Profil, Verzeichnis und Eskalationszeiten fließen noch nicht in Triage, Anforderungsanalyse und Meldungen ein (nächste Folge, `docs/AUTONOMY_ASSESSMENT.md`).
* **Neukunde anlegen:** Das Startpasswort des ersten Administrators wird einmalig angezeigt; mandantenseitig gibt es noch keinen erzwungenen Passwortwechsel bei der ersten Anmeldung und keine Einladung per E-Mail. Die Oberfläche hat keinen Playwright-Test (kein Betreiberzugang in der Testumgebung), die API ist per E2E abgedeckt.
* **Meldungen an Mitarbeiter:** Eine E-Mail je Vorgang, Person und Phase (keine Zusammenfassung bei hohem Aufkommen); die Vertretung greift nach Zeit, es gibt keine Abwesenheits-/Urlaubskalender. Erfasst sind die Zustände Prüfung, Freigabe, Fehler und Notfall; das Warten auf angeschlossene Systeme (CRM/ERP) und auf die Kundschaft ist noch nicht an die Eskalation angebunden. Der Takt wurde nur mit einem Versand-Double geprüft, nicht mit einem echten Postfach und echten Empfängern.
* **Notfälle:** ORBIT meldet einen als kritisch eingestuften Eingang sofort intern (Notfallzuständige, Eskalation nach 15/45 Minuten) und wendet das feste Notfallverfahren an, das der absendenden Person – je nach Regel `email.send.acknowledgement` mit Freigabe (Vorsichtig) oder autonom (ab Ausgewogen) – eine Eingangsbestätigung ohne Zusagen sendet (`docs/ASSUMPTIONS.md` #566). Grenzen: nur Deutsch; keine Bestätigung an Lieferanten, automatische Absender oder bei deaktivierter Regel; **nicht mit einem echten Postfach live gesendet**. Ob die Einstufung „kritisch“ stimmt, hängt vom Modell ab (live geprüft an vier Beispielen, `profile-triage`).
* **Kundenstamm-Prüfung:** Angebunden sind nur ORBITs eigene Kontakte; ein führendes CRM/ERP (HubSpot, Lexware, DATEV …) braucht einen Adapter mit Zugangsdaten und ist nicht vorhanden – die Logik (dreiwertig, nicht dort schreiben, nachprüfen, Mensch bitten) ist gegen ein Test-Double belegt. Abgeglichen wird nur über die E-Mail-Adresse. Der Angebotsablauf wartet nicht auf den Kundeneintrag und nutzt ihn auch noch nicht (z. B. Anrede, Konditionen).
* **Autonomer Vorgangs-Agent (Oktober 2026):** Nachrichten ohne hinterlegten Prozess laufen über feste Abläufe (Notfall, allgemeine Frage, Statusnachfrage) oder über einen von der KI geplanten Ablauf (Beschwerde, Bewerbung, Unbekanntes); jede Wirkung nach außen bleibt durch ihre eigene Regel geschützt (`docs/ASSUMPTIONS.md` #564, #570, #589–#592). **LIVE TESTED mit `gpt-6-luna` am 14.10.2026** an zehn Eingängen (Versand als Double): Sicherheitsgrenzen hielten in allen Läufen; die Abläufe sind ausführbar, nachdem die Prüfung erfundene Eingaben abfängt. **Grenzen:** kleine Stichprobe, das Modell schwankt (gleiche Nachricht, andere Kategorie), nur ein Modell geprüft; Preisfragen/Angebotsanfragen laufen weiter im alten Verkaufsablauf. Ohne echte KI bleibt es beim sicheren Rückfall (Vorgang zur Prüfung).
* **Auskunft aus dem Betriebswissen:** nur aus Profil und freigegebenen Antworten, ohne Quelle/Sicherheit ≥ 0,7/Textprüfung keine Antwort. Die Qualität der Antworten hängt von der Pflege des Profils ab; ohne echten KI-Anbieter wird nicht simuliert.
* **Bezug auf frühere Vorgänge:** nur über die E-Mail-Adresse des Absenders und die Einschätzung „Fortsetzung“ der KI; bei mehreren Kandidaten entscheidet eine Person – eine Oberfläche zum Setzen oder Ändern des Bezugs gibt es noch nicht.
* **Interessent anlegen:** nur zu Kontakten in ORBIT; liegt der Kundeneintrag in einem führenden CRM/ERP, wird kein Interessent angelegt (ein Mensch tut es dort).
* **Sprache der Antworten:** Deutsch und Englisch für Bestätigung, Statusauskunft, Anhang anfordern, Auskunft und Terminbestätigung, nur wenn der Betrieb die Sprache im Profil führt; Rückfragen und Angebote sind deutsch (`docs/ASSUMPTIONS.md` #571).
* **Startpasswort:** Neukunden müssen es bei der ersten Anmeldung ändern (#572); eine Einladung per E-Mail-Link fehlt.
* **Idempotenzschlüssel:** nur auf Wunsch des Clients (Header); die Oberfläche sendet sie nicht; keine Wiederholungssicherheit für Datei-Uploads und Antworten über 512 KB (#573).
* **Upload-Prüfung:** Größe und Magic Bytes werden nach dem Upload geprüft (#574); es gibt **keinen Virenscan** und keine Prüfung des Inneren von Office-/PDF-Dateien.
* **Qualität der Triage:** gemessen mit 40 versiegelten Fällen, einem Modell (`gpt-6-luna`) und einem Beispielprofil (Oktober 2026): Notfälle und Fehlalarme unauffällig, aber dieselbe Nachricht wird nicht immer gleich eingestuft (strenge Konsistenz 70 % bei Ziel 85 %; die Wahl des Wegs ist in 92,5 % gleich). Grenzfälle wie Lieferantenangebot gegen Newsletter und Bewerbung können zwischen Läufen wechseln. Für Planung und Auskunft gibt es noch keine solche Messung (BPF-05, `docs/evaluation/README.md`).
* **Termine und Monteure:** die Zuordnung folgt dem ersten freien Personenkalender in der Reihenfolge der Liste (keine Lastverteilung); die Person wird nicht gesondert benachrichtigt – der Eintrag liegt in ihrem Kalender (BPF-08, #600).
* **Passwortablauf:** standardmäßig aus (`PASSWORD_MAX_AGE_DAYS=0`); die Pflicht zum Wechsel greift beim Anmelden und beim Erneuern der Sitzung, nicht mitten in einer laufenden Sitzung (#602).
* **Lastverhalten:** nur gemessen als Lesepfade auf einer Instanz mit dem Demo-Datenbestand (#605): die Startseite braucht bei 10 gleichzeitigen Aufrufen p95 ≈ 1,5 s (ca. 8 Aufrufe/s je Instanz), die Rechnungsliste p95 ≈ 0,54 s. Schreiblast, mehrere Instanzen und große Datenbestände sind nicht gemessen.
* **Profil aus Datei:** bis 1,4 MB, nur PDF mit Textebene, Word und Text/HTML; Scans und Bilder werden nicht gelesen (#603).
* **Zweiter Faktor:** nur für Plattformzugänge, freiwillig (TOTP); kein WebAuthn, keine Pflicht, kein QR-Code (Geheimnis zum Eintippen); Mandantenkonten haben ihn nicht (#608). Verliert eine Person Gerät **und** Wiederherstellungscodes, setzt ein Owner den Faktor zurück – bei dem einzigen Owner gibt es dafür nur den Weg über die Datenbank.
* **Anfrage aufnehmen und übergeben (#610):** höchstens drei Klärungsrunden, danach übernimmt ein Mensch; ORBIT erstellt in diesem Ablauf kein Angebot. Der Termin wird nur gebucht, wenn die Kundschaft einen der **vorgeschlagenen** Termine eindeutig wählt – ein Gegenvorschlag wird als Wunsch an die zuständige Person übergeben, nicht verhandelt. Termine in HubSpot (Meetings) anlegen kann der Ablauf nicht; ohne Google-Kalender (Einwilligung nötig) fragt er nach Zeiträumen. Die Fassung 1.0.0 (Angebot) und 2.0.0 (Übergabe) sind getrennte Versionen; ein Betrieb nutzt die aktive.
* **Ausfall von Systemen (#614):** ORBIT wiederholt vorübergehend nicht erreichbare Systeme bis zu zwei Arbeitstage selbstständig; Feiertage zählen als Arbeitstage, die Zeit läuft je Schritt. Eine ungewisse Wirkung (z. B. Zeitüberschreitung beim Mailversand) wird nie automatisch wiederholt. Die Eingangsabfrage von Gmail hat eine eigene, einfachere Wiederholung (nächster Takt).
* **Einrichtungsassistent (#616):** er führt zu den Seiten, auf denen eingerichtet wird, und zeigt den Stand; er bettet keine Formulare ein und wird nach der ersten Anmeldung nicht von selbst geöffnet (Menü Administration oder Hinweis in der Checkliste). Die Zustände der Aufgaben sind eine Zusammenfassung der Regeln und Verbindungen, keine Zusage: ob ein einzelner Vorgang gelingt, hängt zusätzlich von seinem Inhalt ab.
* **Tests und Demo-Betrieb (#618):** Suiten, die Daten anlegen oder Verbindungen ändern, gehören in einen eigenen Betrieb (`createRoleTenant`/`useFreshTenant`). Die übrigen Suiten, die sich mit den Demo-Konten anmelden, lesen nur oder stellen ihren Zustand wieder her; ein neuer Test mit Schreibzugriffen im Demo-Betrieb ist ein Fehler. Playwright-Tests mit frischem Betrieb brauchen `DATABASE_URL` (`set -a && source .env && set +a`), sonst werden sie übersprungen.
* **HubSpot:** ein Account je Betrieb über einen Service-Schlüssel (kein OAuth für viele Kundenaccounts, keine Webhooks); Anfragen erscheinen als Deal in der ersten Phase der ersten Pipeline; HubSpots Suchindex hinkt einige Sekunden hinterher, Dubletten zwischen API und Worker sind dadurch in Einzelfällen möglich (#609).
