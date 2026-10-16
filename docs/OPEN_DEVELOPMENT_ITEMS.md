# Offene Entwicklungspunkte

Stand: 2026-10-13. Diese Liste ist aus den bekannten Spezifikationen und Plänen abgeleitet (Master-Spezifikation und Lückenanalyse, Unified Evolution, Master V3,
Sonde, Amendment 01/02/03, UI/UX v2, Channel Event Runtime, [`AUTONOMY_ASSESSMENT.md`](AUTONOMY_ASSESSMENT.md)) sowie aus der Codebasis-Prüfung
([`CODEBASE_REVIEW_2026-10.md`](CODEBASE_REVIEW_2026-10.md)). Was bereits umgesetzt ist, steht in [`FUNCTIONAL_OVERVIEW.md`](FUNCTIONAL_OVERVIEW.md).

**Legende**

| Spalte | Werte |
|---|---|
| **Art** | `ENG` = reine Entwicklung · `EXT` = braucht Zugangsdaten/Zustimmung Dritter (nie vorgetäuscht) · `PROD` = braucht zuerst eine Produktentscheidung · `MAN` = manuelle Prüfung |
| **Aufwand** | S = Stunden bis 1 Tag · M = einige Tage · L = Wochen |
| **Prio** | P1 = nächste Schritte mit größtem Nutzen für das Produktziel · P2 = danach · P3 = bei Bedarf |

---

## 1. Autonomie – „ORBIT versteht jeden Eingang und handelt selbst“ (Kernziel)

Quelle: [`AUTONOMY_ASSESSMENT.md`](AUTONOMY_ASSESSMENT.md). **P0** (jeder Eingang wird ein Vorgang, Notfall-Meldung) und **P1a** (Betriebsprofil) sind umgesetzt; die Meldung/Eskalation und die
Kundenstamm-Prüfung ebenfalls. Offen:

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| AUT-01 | ~~Autonomer Vorgangs-Agent~~ **umgesetzt und mit dem echten Modell belegt** (14.10.2026, zehn Eingänge, `ASSUMPTIONS.md` #564/#570/#589–#592). **Offen:** größere Stichprobe und weitere Modelle, bewährte Pläne als Prozess vorschlagen | ENG | M | P2 | Live-Suite `autonomy-agent.live.e2e-spec.ts` |
| AUT-02 | ~~Fähigkeiten~~ **umgesetzt (TESTED LOCALLY, Doubles für Mail/Kalender)**: Eingang bestätigen, Statusauskunft, fehlenden Anhang anfordern, Auskunft aus dem Betriebswissen, intern benachrichtigen, Interessent anlegen, Termin **buchen** + bestätigen (`ASSUMPTIONS.md` #567/#568); jetzt 13 Fähigkeiten. **Offen:** Live gegen Google (Zustimmung `calendar.events` nötig), Monteur-Zuordnung (BPF-08), Umbuchen/Absagen | ENG / EXT | M | P1 → P2 | |
| AUT-03 | ~~Zuordnung Absender → offene Vorgänge~~ **umgesetzt als Bezug (TESTED LOCALLY)**: genau ein Kandidat ⇒ `case.reference`, mehrere ⇒ Hinweis im Verlauf, nie Verschmelzung (`ASSUMPTIONS.md` #569). **Offen:** Oberfläche zum Setzen/Ändern des Bezugs, Abgleich über Name/Firma | ENG | S–M | P2 | |
| AUT-04 | ~~Eingangsbestätigung bei Notfällen~~ **umgesetzt (TESTED LOCALLY)** als festes Notfallverfahren; Vorsichtig ⇒ mit Freigabe, ab Ausgewogen ⇒ autonom (`ASSUMPTIONS.md` #566). **Offen:** Sprache der Kundschaft (AUT-07), Live-Versand | ENG | S | P2 | Standard ist meine Annahme – bitte bei Bedarf unter „Regeln & Freigaben“ ändern |
| AUT-05 | ~~Abwesenheitskalender~~ (`ASSUMPTIONS.md` #576) und ~~Meldungen bündeln~~ (#587) **umgesetzt**. **Offen:** Abwesenheit aus Google/Outlook übernehmen, Meldungen auch beim Warten auf Systeme und Kundschaft (Fristen der `WaitSubscription` → Eskalation) | ENG | S–M | P3 | |
| AUT-06 | Zustellkanäle **Teams, WhatsApp, SMS, Anruf** für Mitarbeitermeldungen | EXT | L je Kanal | P2 | als Wunsch bereits erfasst; Zustellung heute ehrlich per E-Mail |
| AUT-07 | ~~Antworten in der Sprache der Kundschaft~~ **umgesetzt für Deutsch/Englisch** bei Bestätigung, Statusauskunft, Anhang anfordern, Auskunft, Terminbestätigung (`ASSUMPTIONS.md` #571). **Offen:** Rückfragen und Angebotsversand, weitere Sprachen | ENG | S | P3 | |
| AUT-08 | Kundenstamm: persönliche Anrede ~~umgesetzt~~ (`ASSUMPTIONS.md` #588). **Offen:** Konditionen und bekannte Adresse im Ablauf nutzen, Abgleich auch über Name/Firma/Domain (mit Vorsicht gegen falsche Treffer) | ENG | M | P2 | |
| AUT-09 | **Echte CRM-/ERP-Adapter** für das Kundenverzeichnis: HubSpot (größere Betriebe), Lexware/DATEV (kleinere) – Port `CustomerDirectory` ist vorbereitet | EXT | L je Adapter | P2 | Client-ID/Secret bzw. Partner-Registrierung nötig |
| AUT-10 | **Betriebsprofil KI-gestützt einrichten** ~~aus eingefügtem Text~~ umgesetzt (`ASSUMPTIONS.md` #581). **Offen:** aus Dokumenten (PDF/Word), Preis- und Terminregeln, Terminlängen im Profil; Nachweis mit echtem Modell | ENG | M | P2 | |
| AUT-11 | ~~Lernen: „Wo greifen Menschen ein?“~~ **umgesetzt** als Bericht mit belegten Vorschlägen (`ASSUMPTIONS.md` #601, Seite `/admin/interventions`). **Entschieden:** keine zweite automatische Rückfrage-Runde (`maxAutoQuestions: 1`). **Offen:** Vorschläge aus einzelnen Korrekturen (Textänderungen an Entwürfen) | ENG | M | erledigt (Rest P3) | |
| AUT-12 | **Dienstzugang** ~~Zugriffsschlüssel mit enger Berechtigung für `PUT /staff/sync`~~ umgesetzt (`ASSUMPTIONS.md` #583). **Offen:** Adapter zu Personalsystemen (Personio, DATEV HR, Entra ID) | EXT | L | P3 | |
| AUT-13 | ~~Neukunde: erzwungener Passwortwechsel~~ **umgesetzt** (`ASSUMPTIONS.md` #572). **Offen:** Einladung per E-Mail statt Startpasswort; Playwright-Test der Neukunden-Oberfläche (braucht Betreiberzugang in der Testumgebung) | ENG / MAN | S | P3 | |

## 2. Master-Spezifikation (66 Abschnitte)

Quelle: [`MASTER_SPEC_GAP_ANALYSIS.md`](MASTER_SPEC_GAP_ANALYSIS.md), [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md), [`SPEC_STATUS_OVERVIEW.md`](SPEC_STATUS_OVERVIEW.md).

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| MST-01 | **Abnahmeszenario E „Anruf → Lead“** (Telefonie-Connector in keinen Ablauf eingebunden) | EXT | L | P2 | Twilio-Konto nötig; als einziges der sechs Szenarien noch ganz offen |
| MST-02 | **Finance-Pfad live** mit echter Rechnungsmail samt Anhang (Channel Event Runtime Increment F) | MAN / EXT | S | **P1** | nur ein Testpostfach mit einer Rechnung nötig |
| MST-03 | **Echte OCR** (statt Mock) | ENG / EXT | M–L | P2 | Tesseract lokal oder Cloud-Dienst |
| MST-04 | Finanzsysteme **DATEV, Lexware** (Lieferantenstamm, Buchungsübertragung) | EXT | L je System | P2 | Partner-/OAuth-Registrierung (`DATEV_INTEGRATION.md`) |
| MST-05 | **Microsoft 365** (Mail, Kalender) und **Google Calendar Schreiben** | EXT | L / M | P2 | Client-IDs und Zustimmung |
| MST-06 | **HubSpot** als CRM-Anbindung | EXT | L | P2 | siehe AUT-09 |
| MST-07 | ~~CSRF-Konzept~~ **dokumentiert** (`SECURITY.md` §6a) | ENG | S | erledigt | |
| MST-08 | ~~Allgemeine API-Idempotenzschlüssel~~ **umgesetzt** (`Idempotency-Key`, `ASSUMPTIONS.md` #573). **Offen:** die Oberfläche sendet noch keine Schlüssel (Doppelklick-Schutz im Client) | ENG | S | P3 | |
| MST-09 | ~~Upload-Prüfung auf Bytes~~ **umgesetzt** (Größe + Magic Bytes, `ASSUMPTIONS.md` #574). **Offen:** Virenscan (ClamAV o. Ä.), Prüfung des Inhalts von Office-Dateien | ENG / EXT | M | P2 | `SECURITY.md` §5 |
| MST-10 | Webhook-Endpunkt mit **Signaturprüfung** (sobald ein Anbieter Webhooks sendet) | EXT | M | P3 | Idempotenz-Infrastruktur steht |
| MST-11 | ~~Dependency-Scanning~~ **in der CI** (`pnpm audit`, Dependabot); 33 → 4 Funde (`SECURITY.md`) | ENG | S | erledigt | 4 verbleibende Funde: Entwicklungswerkzeuge, begründet |
| MST-12 | CI-Pipeline auf einem **echten GitHub-Runner** verifizieren | EXT | S | P2 | Erweiterungen nur gegen lokales Docker geprüft |
| MST-13 | ~~RLS für Tabellen ohne `tenant_id`~~ **umgesetzt** (`ASSUMPTIONS.md` #578, `SECURITY.md`) | ENG | M | erledigt | |
| MST-14 | Rechtevergabe nach `pnpm db:reset` auf wiederverwendetem Container automatisieren | ENG | S | P3 | `LOCAL_DEVELOPMENT.md` |
| MST-15 | Integrationstests für **Queue + Worker** (BullMQ mit Redis) über das Vorhandene hinaus | ENG | M | P3 | |
| MST-16 | Dokument-Upload gegen echtes MinIO durchgängig live nachweisen | MAN | S | P3 | |

## 3. Unified Evolution, Master V3, Sonde

Quelle: [`ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md`](ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md), [`ORBIT_MASTER_IMPLEMENTATION_PLAN.md`](ORBIT_MASTER_IMPLEMENTATION_PLAN.md), [`SONDE_CONCEPT.md`](SONDE_CONCEPT.md).

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| SON-01 | **Sonde DELEGATE-Modus** (Aufträge an die Prozess-Engine übergeben, Command-Ausführung durch Sonde) und NAVIGATE | ENG | L | P2 | Unified Phase 10 |
| SON-02 | Action-Cards mit **Bestätigen-Button**, `prepare_follow_up`, Token-Streaming (`message.delta`), **„Antwort stoppen“** (Abbruch im Backend) | ENG | M | P2 | |
| MV3-01 | Vollständiger **8-stufiger Agent-Lifecycle** (heute DRAFT/ACTIVE/DISABLED) | ENG | M | P3 | prüfen, was seit Amendment 03 abgedeckt ist |
| MV3-02 | **Evaluationslauf-Historie** (Verlauf der Auswertungsläufe je Agent) | ENG | M | P3 | |
| MV3-03 | ~~Generische Idempotenzschlüssel~~ **umgesetzt** zusammen mit MST-08 | ENG | M | erledigt | |
| UNI-01 | **Lasttests und Skalierungsnachweis** (Unified Phase 12), Latenzbudgets (p95) | ENG | M–L | P2 | Messskript siehe Codebasis-Review |
| UNI-02 | Phase 11 „echte Anbieter und Connectoren validieren“ | EXT | L | – | `BLOCKED_BY_EXTERNAL_CREDENTIALS` |

## 4. Amendment 01 – Integrationsframework

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| INT-01 | Phase 2: **aktives Health-Monitoring** der Connectoren, **Connector-Versionierung**, **Registry-Administration** | ENG | M | P2 | |
| INT-02 | Phase 3: **Sonde Guided Setup** und **Systemlandkarte** | ENG | L | P3 | laut Dokumentation nicht begonnen |
| INT-03 | **Mehrere Konten je Anbieter** (heute eines) | ENG | M | P3 | UI v2 |
| INT-04 | Google-Zustimmungsbildschirm auf **„In production“** (sonst läuft die Gmail-Zustimmung nach 7 Tagen ab) | EXT | S | **P1** | nur Sie können das in der Google Cloud Console tun |

## 5. Amendment 02 / 02 v1.2 – Prozess-Orchestrierung

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| BPF-01 | ~~Kostenlimit je Vorgang~~ **umgesetzt** (`ASSUMPTIONS.md` #585): Kosten werden dem Vorgang zugerechnet, ab der Grenze Prüfung durch einen Menschen. **Offen:** Wirkung nur mit gepflegtem Kostenprofil; die Triage vor der Anlage ist keinem Vorgang zugerechnet | ENG | S | P3 | |
| BPF-02 | ~~Anhänge in der Triage/Extraktion~~ **umgesetzt** für Text/CSV/HTML, Word und PDF mit Textebene (`ASSUMPTIONS.md` #598). **Offen:** Texterkennung für Scans und Bilder (MST-03), Excel, Anhangsinhalt in der Rechnungserfassung (liegt beim OCR-Anbieter) | ENG | M–L | erledigt (Rest P2) | |
| BPF-03 | ~~Aufbewahrung von `bodyText` und Fakten~~ **umgesetzt** als Kategorien `EMAIL_BODIES` und `SUPERSEDED_FACTS` (`ASSUMPTIONS.md` #577). **Offen:** automatischer Lauf nach Plan, Anhänge | ENG | S | P3 | |
| BPF-04 | ~~Limits je Mandant einstellbar~~ **umgesetzt** für vier Grenzen, nur verschärfend (`ASSUMPTIONS.md` #584) | ENG | S–M | erledigt | |
| BPF-05 | ~~Qualitätsmessung der KI~~ **umgesetzt** für die Triage (`ASSUMPTIONS.md` #593–595, `docs/evaluation/README.md`): versiegelter Prüfsatz, Kennzahlen, Gütekriterien, Wiederholungen, Vergleich mit früherem Lauf. Zweite Runde mit `holdout-v2` (80 Fälle) und `triage-prompt/5` (`ASSUMPTIONS.md` #596). **Offen:** strenges Konsistenzkriterium knapp verfehlt (83,8 % statt 85 %); `holdout-v3` vor jeder weiteren Anweisungsänderung; Bewertung des Agenten mit Punktzahlen; weitere Modelle | ENG | M | erledigt (Rest P3) | |
| BPF-06 | **Preisquelle** aus echtem Warenwirtschafts-/ERP-System statt Testbestand (`pricing.resolve` bleibt) | EXT | L | P2 | |
| BPF-07 | Plan-Editor/Drag-and-drop und besseres Graph-Layout (Kantenkreuzungen) | ENG | L | P3 | Aktionen laufen bewusst nur über Commands |
| BPF-08 | ~~Kalendereintrag automatisch anlegen~~ **und** ~~bestimmten Monteur zuordnen~~ **umgesetzt** (`ASSUMPTIONS.md` #600): Kalender der Monteure im Pool, Abwesenheit sperrt, Zuständiger im Eintrag. **Offen:** Lastverteilung, Benachrichtigung der Person, Live gegen Google | ENG | M | erledigt (Rest P3) | |
| BPF-09 | Auflösungsleiter: Stufen „Fachsystem“ und „weitere Quelle“ über vorhandene Tools hinaus | ENG | M | P3 | |

## 6. Amendment 03 – Plattformbetrieb

Quelle: [`PLATFORM_OPERATIONS_ACCEPTANCE_REPORT.md`](PLATFORM_OPERATIONS_ACCEPTANCE_REPORT.md) §4.

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| PLT-01 | **Plattform-UI vervollständigen:** KI-Anbieter/Modelle/Profilentwürfe/Plattformverbindungen anlegen, Flag-Ausnahmen, Zugriff auf Vorgangsinhalt per Support-Sitzung | ENG | M | P2 | heute teils nur per API |
| PLT-02 | **MFA/WebAuthn** statt Passwort-Re-Auth als Step-up | ENG | L | P2 | |
| PLT-03 | **Aktive periodische Health-Prüfung** der KI-Anbieter (OPS-12) | ENG | S–M | P3 | würde bezahlte Aufrufe auslösen → Kostenabwägung |
| PLT-04 | Connector-Sperre **beendet laufende Aktionen aktiv** (OPS-15) | ENG | M | P3 | |
| PLT-05 | **Mandantenspezifische Region/Datenrichtlinie** (OPS-27) | ENG | L | P3 | |
| PLT-06 | Mandantenlebenszyklus `offboard`/`close` als Abläufe, Support-Historie je Mandant | ENG | M | P2 | `provision` ist seit Oktober vorhanden |
| PLT-07 | ~~Passwort-Ablauf/-Verlauf~~ **umgesetzt** (`ASSUMPTIONS.md` #602). **Offen:** Einladung neuer Betreiber per E-Mail | ENG | S–M | erledigt (Rest P3) | |
| PLT-08 | **Zweiter echter KI-Anbieter** (Anthropic/OpenAI sind registriert, ein weiterer echter Aufruf fehlt) | EXT | M | P3 | |
| PLT-09 | ~~BYOK-Adapter senden `reasoning_effort` nicht mit~~ **bereits umgesetzt**: der OpenAI-Adapter der Registry übergibt `OPENAI_REASONING_EFFORT` (geprüft 2026-10-14); der Punkt war veraltet | ENG | S | erledigt | |

## 7. UI/UX Specification v2

Quelle: [`ORBIT_UI_UX_V2_ACCEPTANCE_REPORT.md`](ORBIT_UI_UX_V2_ACCEPTANCE_REPORT.md).

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| UX-01 | AC-18: automatisierter **Mandantenwechsel A/B im Browser** | ENG | S | P2 | |
| UX-02 | AC-19: **manuelle Screenreader- und Mobile-Tastaturprüfung** | MAN | S | P2 | nur automatisiert (axe) geprüft |
| UX-03 | ~~Ablehnungsgrund bei Freigaben~~ **umgesetzt** (`ASSUMPTIONS.md` #562) | ENG | S | erledigt | |
| UX-04 | Kontakte, Opportunities, Lieferanten und Admin-Unterseiten **vertiefen** (heute nur einheitlich gestaltet) | ENG | M | P3 | |
| UX-05 | **Seitenwechsel** ~~umgesetzt~~ im Browser für Kontakte, Lieferanten, Interessenten, Verkaufschancen, Rechnungen (`ASSUMPTIONS.md` #579). **Offen:** Server-Seiten/Suche über 1000 Zeilen; Ansichten für Firmen, Termine, Dokumente | ENG | M | P3 | |

## 8. Technische Schulden und Betrieb (aus der Codebasis-Prüfung)

| ID | Punkt | Art | Aufwand | Prio | Anmerkung |
|---|---|---|---|---|---|
| TEC-01 | ~~`.gitattributes`~~ **erledigt** (`ASSUMPTIONS.md` #575) | ENG | S | erledigt | |
| TEC-02 | ~~Spec-Dateien aus den `dist`-Ausgaben~~ **erledigt** für `shared`, `domain`, `config` (`ASSUMPTIONS.md` #582) | ENG | S | erledigt | |
| TEC-03 | ~~`knip` und `jscpd` in der CI~~ **erledigt** (`knip.json`, `.jscpd.json`, `ASSUMPTIONS.md` #580) | ENG | S | erledigt | |
| TEC-04 | Große Dienste aufteilen (`intake.service.ts` ≈ 900 Zeilen, `orchestrator.service.ts` ≈ 830) | ENG | M | P3 | nur bei weiterem Wachstum |
| TEC-05 | `next build` unter Windows (Standalone-Symlinks): Standalone nur im Docker-Build einschalten | ENG | S | P3 | |
| TEC-06 | **E2E-Suite beschleunigen:** 52 Suiten laufen seriell ≈ 25 Minuten, der Worker muss gestoppt werden, parallele Läufe stören sich (gemeinsame Datenbank) → Test-Datenbank/Schema je Lauf, Test-Modus für den Worker | ENG | M | P2 | |
| TEC-07 | ~~Schutz gegen hinterlassene Test-Mandanten~~ **erledigt** (`globalTeardown`, `ASSUMPTIONS.md` #575) | ENG | S | erledigt | |
| TEC-08 | ~~Backup-/Restore-Konzept, Migrationsstrategie, Rotation von Geheimnissen~~ **dokumentiert und lokal erprobt** (`DEPLOYMENT.md`, `scripts/backup-postgres.sh`, `rotate-credential-key.ts`; `ASSUMPTIONS.md` #586). **Offen:** Sicherungs-Zeitplan, MinIO-Sicherung, Rotationslauf gegen eine echte Datenbank | ENG / MAN | S | P3 | |
| TEC-09 | ~~Alarmregeln für Prometheus~~ **erledigt** (`infra/prometheus/orbit-alerts.yml`); offen: Schwellen nach Betriebserfahrung kalibrieren | ENG | S | erledigt | |
| TEC-10 | Playwright-Gesamtlauf und Live-Suite (mit echtem Modell) nach größeren Änderungen routinemäßig wiederholen | MAN | S | P2 | in dieser Prüfung nur gezielte Teilmengen gelaufen |

---

## Empfohlene Reihenfolge

1. **Umgesetzt (Stand 2026-10-13, zweite Hälfte):** AUT-01…04, UX-03, MST-07, MST-11, BPF-08 (Kalender anlegen). **Als Nächstes ohne Abhängigkeit:** Live-Nachweis des
   autonomen Vorgangs-Agenten mit echtem Modell (`autonomy-assessment` erweitern, `LIVE_AI=1`) – er entscheidet, ob die Voreinstellung „Ausgewogen = Plan autonom“ trägt.
2. **Nur mit Ihnen:** INT-04 (Google „In production“ – danach auch die neue Zustimmung „Termine anlegen“ erteilen), MST-02 (Rechnungsmail ins Testpostfach), Entscheidung zu AUT-11, Zugangsdaten für die Adapter
   (AUT-09, MST-01/03/04/05/06, AUT-06, PLT-08).
3. **Danach (P2):** Meldungen bündeln/Abwesenheit (AUT-05), Sprache (AUT-07), Kundenstamm-Nutzung (AUT-08), Qualitätsmessung (BPF-05), Kostenlimit je Vorgang (BPF-01),
   Anhänge (BPF-02), Aufbewahrung (BPF-03), Plattform-UI (PLT-01), MFA (PLT-02), Lasttest (UNI-01), Test-Infrastruktur (TEC-06/07).
