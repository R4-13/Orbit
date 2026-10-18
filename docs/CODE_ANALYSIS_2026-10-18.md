# Codebasis-Analyse, Problemliste, offene Punkte und Prioritäten

Stand: 2026-10-18, Commit `977afd9`. Gegenstand ist der gesamte Code: **Mandantenseite** (Betriebe nutzen ORBIT), **Betreiberseite** (Plattform, mit der der Betreiber Betriebe
anlegt, überwacht und unterstützt) und das, was beide tragen (Prozess-Engine, Datenmodell, Betrieb, Tests, Dokumentation).

**Wie belastbar ist das?** Jede Aussage trägt eine Kennzeichnung:

* **[gemessen]** – in dieser Prüfung ausgeführt (Typprüfung, Lint, Unit-Tests, `pnpm audit`, Abfragen gegen die Datenbank, Zählungen im Code).
* **[gelesen]** – im Quelltext geprüft, aber nicht ausgeführt.
* **[Doku]** – aus den Projektdokumenten übernommen, nicht neu geprüft.
* **[nicht geprüft]** – bewusst offen; steht unter „Grenzen dieser Analyse“.

---

## 1. Urteil in einer Minute

**Der Kern trägt.** Das Prozessmodell (Blueprint, Plan, deterministische Prüfung, Ausführung mit Nachweis), die Mandantentrennung in der Datenbank und der Umgang mit Wirkungen
nach außen (Freigaben, Nachweise, Wiederholung) sind sauber gebaut und durch viele Tests abgesichert. Der Code ist ungewöhnlich ordentlich: keine unterdrückten Typfehler,
keine offenen `TODO`-Marken, wenige Lint-Ausnahmen. Der Weg „Anfrage → Rückfragen → Termin → Übergabe an das CRM“ ist mit echtem Modell, Gmail, Google-Kalender und HubSpot
live belegt.

**Die Lücken liegen nicht im Kern, sondern darum herum:**

1. **Konten und Zugang der Betriebe sind für einen echten Betrieb zu dünn** (kein „Passwort vergessen“, keine MFA, keine Kontosperre, Einladung per Startpasswort).
2. **Die Betreiberseite ist weniger abgesichert, als ihr Gewicht verlangt** (MFA nicht erzwungen, Browser-Tests laufen ohne Betreiberzugang nicht, Oberfläche unvollständig,
   kein Offboarding, keine Abrechnung).
3. **ORBIT hängt an genau einem Kanal und je einem Anbieter** (nur Gmail für Mail und Kalender, nur HubSpot als CRM, ein KI-Anbieter) – gemessen an der Produktidee „viele
   Eingangs- und Ausgangskanäle, angepasst an die Systeme des Betriebs“ ist das die größte fachliche Lücke.
4. **Zwei Prozessmodelle laufen nebeneinander** (alte Agenten/Workflows und die neue Prozess-Engine); das kostet Wartung und verwirrt.
5. **Betriebshärtung ist nur dokumentiert, nicht gelebt:** Entwicklungs-Compose mit offenen Ports und Standardpasswörtern, Beispiel-Geheimnisse werden im Produktivstart nicht
   abgelehnt, einzelne ausgehende Aufrufe ohne Zeitlimit, CI nie auf einem echten Runner gelaufen.

---

## 2. Kennzahlen

| Bereich | Wert | Quelle |
|---|---|---|
| API (`apps/api/src`) | 40.925 Zeilen in 414 Dateien, 57 Module | gemessen |
| Worker | 700 Zeilen | gemessen |
| Web (`apps/web/src`) | 19.623 Zeilen in 149 Dateien | gemessen |
| Gemeinsame Pakete (`shared`, `agent-core`, `integration-core`, `ui`, `config`, `domain`) | rund 13.700 Zeilen | gemessen |
| Datenmodell | 82 Tabellen mit erzwungener Zeilensicherheit (RLS), 65 Migrationen | gemessen |
| Betreiberseite | API 3.750 Zeilen (`platform`, `platform-control`, `security`), Web 3.613 Zeilen | gemessen |
| Tests | 143 Unit-Spezifikationen, **1.022 Unit-Tests grün**, 70 API-E2E-Dateien, 20 Playwright-Dateien | gemessen |
| Typprüfung | 14 von 14 Aufgaben ohne Fehler | gemessen |
| Lint (`--max-warnings=0`) | ohne Befund | gemessen |
| Abhängigkeitsprüfung (`pnpm audit --prod`) | 4 Funde: 1 hoch, 3 mittel (siehe S5) | gemessen |
| Codegeruch im Produktivcode | 0 × `@ts-ignore`, 1 × `any`, 6 × `eslint-disable` (alle begründet), 0 offene `TODO`/`FIXME` | gemessen |
| Größte Dateien | `intake.service.ts` 928, `orchestrator.service.ts` 923, `reference-process.tools.ts` 676 Zeilen | gemessen |
| Dokumentation | 70 Dateien; `ASSUMPTIONS.md` mit 618 Einträgen auf über 1.100 Zeilen | gemessen |

**Nicht in dieser Prüfung gelaufen:** die gesamte API-E2E-Suite (rund 25 Minuten seriell) und der gesamte Playwright-Lauf; gelaufen sind gezielte Teilmengen (Prozess,
Einrichtungsassistent, Finance, Oberfläche), alle grün. Die Live-Suiten mit echtem Modell (kostenpflichtig) wurden nicht wiederholt.

---

## 3. Probleme

Schweregrad: **hoch** = verhindert den produktiven Einsatz oder gefährdet Daten · **mittel** = merkliches Risiko oder spürbare Lücke · **niedrig** = Schönheitsfehler oder
Vorsorge. Die IDs sind neu und nur in diesem Dokument gültig (Abgleich mit der bestehenden Liste in Abschnitt 5).

### 3.1 Sicherheit und Datenschutz

| ID | Problem | Schwere | Beleg | Folge | Empfehlung |
|---|---|---|---|---|---|
| S1 | **Kein „Passwort vergessen“ für Mandantenbenutzer**, keine E-Mail-Verifizierung; neue Benutzer bekommen ein Startpasswort (erzwungener Wechsel). Zurücksetzen nur durch Betreiber/Administration. | hoch | [gelesen] kein Zurücksetzen-Pfad außer in `platform.controllers.ts`; `AUT-13` in der Liste | Ein Betrieb kann sich ohne Eingriff nicht selbst helfen; Startpasswörter laufen über Dritte | Einladung und Zurücksetzen per E-Mail mit einmaligem, kurzlebigem Link; Verifizierung der Adresse |
| S2 | **Keine MFA für Mandantenkonten.** Beim Betreiber ist TOTP da, aber **nicht erzwungen**. | hoch | [gelesen] MFA nur in `platform/`; `PLT-02`: „Pflicht zum Faktor“ offen | Ein gestohlenes Passwort genügt; beim Betreiberkonto öffnet es alle Betriebe (mit Support-Sitzung) | TOTP für alle Konten, für Administratoren und Betreiber verpflichtend |
| S3 | **Keine Kontosperre nach Fehlversuchen**, nur Drosselung (60 Versuche je 5 Minuten). | mittel | [gelesen] kein `failedLogin`/`lockedUntil` im Code oder Schema | Langsames Erraten bleibt unter der Drosselung | Zähler je Konto mit wachsender Sperre und Meldung an die Administration |
| S4 | **Beispiel-Geheimnisse werden im Produktivstart akzeptiert**: `JWT_SECRET` muss nur 16 Zeichen haben (das Beispiel „change_me_dev_only…“ erfüllt das); `CREDENTIAL_ENCRYPTION_KEY` wird erst bei der Nutzung auf 32 Byte geprüft. Compose hat feste Passwörter und veröffentlicht Postgres (5432), Redis (6379), MinIO (9000/9001), Jaeger und OTLP an **alle** Schnittstellen. `/metrics` ist ohne Anmeldung erreichbar (Schutz nur über den Reverseproxy, so dokumentiert). | mittel (hoch auf einem Server) | [gelesen] `packages/config/src/env.ts`, `docker-compose.yml`, `metrics.controller.ts` | Auf einem erreichbaren Rechner sind Datenbank und Speicher offen | Produktionsprüfung beim Start (Beispielwerte ablehnen), Ports nur an `127.0.0.1`, Metriken mit Token |
| S5 | **Abhängigkeiten mit bekannten Schwachstellen:** `deepmerge-ts` <8 (hoch, nur über das Prisma-Kommando, kein Laufzeitpfad), `file-type` (2 × mittel), **`@nestjs/core` ≤ 11.1.17** (mittel, Einschleusung; das Projekt nutzt 10.4.22, ein Major-Upgrade ist nötig). | mittel | [gemessen] `pnpm audit --prod` | Bekannte Lücken im Framework | Nest 10 → 11 (Aufwand M), Prisma/`file-type` nachziehen |
| S6 | **Ausgehende Aufrufe ohne Zeitlimit:** Gmail-Lesen (`gmailFetch`), OAuth-Tokenaustausch und -Widerruf. Die **KI-Clients** (OpenAI/Anthropic) werden ohne eigene Zeit- und Wiederholungsvorgabe erzeugt (SDK-Standard, bei OpenAI 10 Minuten). | mittel | [gelesen] `gmail-connector.service.ts:490`, `oauth2.service.ts:77,134`, `openai-llm-provider.ts:66` | Ein hängender Aufruf blockiert den Takt oder einen Vorgang minutenlang; die neue Ausfall-Wiederholung greift erst, wenn der Aufruf endet | Überall `AbortSignal.timeout`, KI-Aufrufe z. B. 60–90 s mit festen Wiederholungen |
| S7 | **36 Stellen umgehen die Zeilensicherheit** (`withRlsBypass`, 11 im Prozessmodul, 7 in der Anmeldung, 8 in Betreiber/Plattform). Notwendig (Betrieb nach Kennung suchen, Anmeldung), aber die größte Fehlerfläche für Mandantentrennung. | mittel | [gemessen] Zählung | Ein Fehler dort wirkt über Betriebsgrenzen | Allowlist mit Begründung je Stelle, Test, der jede Nutzung einem Betrieb zuordnet; Review-Regel |
| S8 | **Kein Virenscan** der Uploads (Prüfung nur auf Größe und Dateikopf). | mittel | [Doku] `MST-09` | Schadsoftware in Anhängen erreicht Mitarbeitende | ClamAV o. Ä. vor der Ablage |
| S9 | **Sitzungen:** Refresh-Token mit Rotation und Widerruf sind da; eine Geräteliste oder „überall abmelden“ für Benutzer ist **nicht geprüft**. | niedrig | [nicht geprüft] | – | prüfen, ggf. ergänzen |

Positiv, ebenfalls gemessen: **jede** Tabelle mit `tenant_id` hat eine Zeilensicherheits-Richtlinie, auf 82 Tabellen ist sie erzwungen (`FORCE`); Zugangsdaten im Tresor, verschlüsselt (AES-256-GCM);
Zugriffsschlüssel nur als Hash; Cookies `httpOnly`/`sameSite=Strict`; `helmet`; getrennte Schlüssel für Betreiber und Betriebe; Eingaben mit Zod geprüft; unvertraue
Inhalte (Mails, Anhänge) werden vor jedem Modellaufruf als Daten gekennzeichnet, Texte an die Kundschaft auf Links, Adressen und Zahlungsaufforderungen geprüft.

### 3.2 Robustheit und Betrieb

| ID | Problem | Schwere | Beleg | Folge | Empfehlung |
|---|---|---|---|---|---|
| R1 | **Ein einziger Worker-Prozess;** Mehrinstanzbetrieb, Schreiblast und Produktionsdatenbestand sind nicht nachgewiesen. Der Lasttest deckt nur Lesepfade ab (zwei Routen über Budget). | mittel | [Doku] `UNI-01`; [gemessen] ein Worker-Container | Unklar, wo die Grenze liegt | Lasttest mit Schreibpfaden und zwei API-/Worker-Instanzen |
| R2 | **Verwaiste Alt-Vorgänge:** 4 × „Empfangen“, 4 × „In Bearbeitung“, 2 × „Wartet auf Freigabe“ (überwiegend Demodaten vom 04.10.), dazu 4 × „Manuelle Prüfung“. Es gibt keine Alterung, Eskalation oder Archivierung für Vorgänge, die niemand anfasst. | mittel | [gemessen] Abfrage Betrieb „musterwerk“ | Arbeit bleibt unbemerkt liegen; die Zahlen auf Startseite und Bericht sind verzerrt | Fristen je Status, Eskalation nach X Tagen, „Archivieren“-Aktion |
| R3 | **Ausfall-Wiederholung nur je Schritt:** die Zwei-Arbeitstage-Uhr läuft je Schritt, nicht je Vorgang; ungewisse Wirkungen (`OUTCOME_UNKNOWN`, z. B. Zeitüberschreitung nach dem Mailversand) werden bewusst nie automatisch wiederholt und haben **keine Frist**. | mittel | [gelesen] `orchestrator.service.ts`, `ASSUMPTIONS.md` #614 | Ein ungewisser Versand wartet ohne Termin auf einen Menschen | Frist und Erinnerung für ungewisse Wirkungen; Abgleich mit dem Gesendet-Ordner automatisieren |
| R4 | **Ausfall-Wiederholung nur per Test belegt**, nie mit einem echten Netzausfall; die 72-Stunden-Wartezeit auf Kundenantworten ebenfalls nur simuliert. | mittel | [Doku] #612–614 | Verhalten im Ernstfall unbekannt | Fehlerinjektion im laufenden System (kurzer Schalter), Zeit-Beschleunigung |
| R5 | **Keine Sicherungsplanung:** Sicherung und Wiederherstellungsprobe sind per Skript möglich, es gibt aber keinen Zeitplan, keine Sicherung von MinIO (Belege/Anhänge) und keine Aufbewahrung außerhalb des Rechners. | mittel | [gemessen] heute erstmals manuell gesichert und geprobt | Datenverlust bei Plattenausfall | Täglicher Lauf, Ablage extern, Wiederherstellungsübung |
| R6 | **Nur Docker-Compose,** keine Infrastruktur als Code, keine Vorlage für TLS/Reverseproxy, keine Staging-Umgebung. CI ist nie auf einem echten GitHub-Runner gelaufen. | mittel | [gelesen] `infra/` enthält nur Alarmregeln; `MST-12` | Produktivstart ist Handarbeit; Fehler zeigen sich erst spät | Referenz-Deployment (Proxy, TLS, Secrets), CI-Lauf auf Runner |
| R7 | **Eingang nur per Abfrage** (alle zwei Minuten, Gmail); kein Push, keine Historie-Kennung für lückenlosen Abgleich nach Ausfall geprüft. | niedrig | [gelesen] `channel-sync` | Verzögerung bis 2 Minuten; Lücken nach langem Ausfall möglich | Gmail-Push oder Historie-Abgleich prüfen |

### 3.3 Fachliche Korrektheit und Produkt (Mandantenseite)

| ID | Problem | Schwere | Beleg | Folge | Empfehlung |
|---|---|---|---|---|---|
| K1 | **„Kunden anlegen“-Aufgaben schließen sich nicht**, wenn der Kunde inzwischen gefunden ist (3 offene Aufgaben für `tomorbit777`, bei zwei davon steht die Kundenprüfung auf „gefunden“). | mittel | [gemessen] Abfrage | Aufgabenliste füllt sich mit Erledigtem | Aufgabe automatisch abschließen, sobald der Eintrag da ist |
| K2 | **Automatische Absender (no-reply) erzeugen „Kunden anlegen“-Aufgaben** (`noreply@notifications.hubspot.com`), obwohl Antwortentwürfe an solche Adressen gesperrt sind. | mittel | [gemessen] Aufgabe vorhanden; [gelesen] Sperre nur im Entwurf | Rauschen, unnötige Eskalationen (eine Meldung steht „eskaliert“) | Dieselbe Erkennung auch bei der Kundenprüfung |
| K3 | **Freigaben-Liste ohne Filter und Gewichtung;** nach 99+ Einträgen fand Sie eine echte Freigabe nicht. Entschiedene Freigaben verschwinden ohne Verlauf in der Liste. | mittel | [gemessen] Abzeichen „99+“, Nachfrage in dieser Sitzung | Echte Freigaben gehen unter | Filter nach Art/Alter/„von ORBIT vorbereitet“, Verlauf der letzten Entscheidungen |
| K4 | **Vorgänge nur über Titel suchbar;** gleichlautende Titel (drei „Badsanierung“) sind nicht unterscheidbar, Kennungen werden nicht angezeigt. | niedrig | [gemessen] | Verwechslung | Kurz-Kennung im Kopf und in der Suche (`UX-06`) |
| K5 | **Kundenmails sind fest im Code** (Deutsch/Englisch); ein Betrieb kann Texte, Anrede, Tonfall und Wartezeiten (72 h, drei Runden) nicht anpassen – obwohl das Profil einen „Ton“ kennt. | mittel | [gelesen] `communication-templates.ts` („kann später ersetzt werden“), keine Vorlagentabelle | ORBIT klingt für jeden Betrieb gleich; Produktidee „passt sich an“ ist hier nicht eingelöst | Vorlagen je Betrieb (mit Prüfung auf verbotene Zusagen), Fristen im Profil |
| K6 | **Terminlogik vereinfacht:** nur Hauptkalender und Kalender erfasster Mitarbeitender, feste Dauer (90 Minuten Vor-Ort), keine Wegezeiten, kein Umbuchen/Absagen, Zeitfenster aus Standard-Öffnungszeiten. | mittel | [gelesen] `appointment-slots.ts`; [Doku] `AUT-02` | Vorschläge passen nicht zu jedem Gewerk | Dauer je Leistung, Wege, Umbuchen/Absagen, mehrere Kalender |
| K7 | **Übergabe-Zusammenfassung mit Rauschen:** Angaben wie „Name: Tom Orbit“ oder „Angebotswunsch: Angebot erbeten“; die KI-Zusammenfassung spricht in der dritten Person und nennt Leistungen des Betriebs. | niedrig | [gemessen] Deals der Live-Tests | Weniger Nutzen für die Person im CRM | Pflicht-/Kernangaben von Allgemeinplätzen trennen; Vorlage je Branche |
| K8 | **HubSpot-Deal immer in der ersten Phase der ersten Pipeline** (Annahme); die Einstellung existiert im Code (`dealSettingsFor`), ob die Oberfläche sie anbietet, ist nicht belegt. | niedrig | [gelesen] | Deals landen in der falschen Phase | Phase/Pipeline in der Verbindung wählbar machen |
| K9 | **Mehrdeutige Eingangsarten nicht abgedeckt:** Anhänge als Scan/Bild (keine Texterkennung), Excel, Sprachnachrichten, Formulare, Anrufe. | mittel | [Doku] `MST-03`, `BPF-02`, `MST-01` | Teile der Anfragen bleiben unlesbar | Echte OCR, Formular-Eingang, Telefonie |
| K10 | **KI-Qualität:** Triage-Konsistenz 83,8 % gegen Ziel 85 % (knapp verfehlt), ein Modell, **kein Ausweichanbieter** – fällt der Anbieter aus, steht die Verarbeitung (die Wiederholung überbrückt nur bis zu zwei Arbeitstage). | mittel | [Doku] `BPF-05`, `PLT-08` | Abhängigkeit und Restfehlerrate | Zweiter Anbieter mit Umschaltung, `holdout-v3`, Fehlerkatalog |
| K11 | **Kein Lizenz-, Abrechnungs- oder Nutzungsmodell,** keine Selbstregistrierung; der Betrieb entsteht nur durch den Betreiber. | mittel | [gemessen] kein Plan/Abo im Schema | Das Produkt lässt sich nicht verkaufen und abrechnen | Tarif, Nutzungszähler (KI-Kosten je Betrieb sind vorhanden), Rechnungsstellung |
| K12 | **Nur Deutsch** in der Oberfläche, kein Übersetzungsrahmen; Antworten an die Kundschaft nur Deutsch/Englisch. | niedrig | [gemessen] kein i18n-Paket | Markt außerhalb DACH nicht erreichbar | Rahmen einführen, bevor mehr Text entsteht |

### 3.4 Betreiberseite

| ID | Problem | Schwere | Beleg | Folge | Empfehlung |
|---|---|---|---|---|---|
| B1 | **Die Browser-Tests der Betreiberoberfläche (7 Dateien) laufen nur mit Betreiber-Zugangsdaten** und werden sonst übersprungen; die Umgebung der CI setzt sie vermutlich nicht. API-seitig gibt es 10 Dateien. | hoch | [gemessen] `test.skip(!EMAIL …)` in allen `platform*.spec.ts`; [gelesen] CI-Umgebung | 3.613 Zeilen Betreiber-Oberfläche ohne Regressionsschutz im Alltag | Betreiber-Testkonto per Skript im Lauf anlegen (wie der frische Betrieb), in die CI aufnehmen |
| B2 | **MFA nicht erzwungen,** keine Passkeys, Einladung neuer Betreiber ohne E-Mail (siehe S2). | hoch | [Doku] `PLT-02`, `PLT-07` | Das mächtigste Konto ist das schwächste Glied | Pflicht-MFA, Wiederherstellungsprozess, Einladung per E-Mail |
| B3 | **Kein Offboarding/Schließen eines Betriebs als Ablauf** (Löschen ist ein zweistufiger Vorgang in den Einstellungen des Betriebs), keine Support-Historie je Betrieb. | mittel | [Doku] `PLT-06` | Datenschutzpflichten beim Vertragsende nicht abbildbar | Offboarding mit Frist, Export, Löschnachweis |
| B4 | **Betreiberoberfläche unvollständig:** KI-Anbieter, Modelle, Profilentwürfe, Plattformverbindungen und Flag-Ausnahmen teils nur per API. | mittel | [Doku] `PLT-01` | Betrieb nur mit API-Kenntnis | Oberfläche vervollständigen |
| B5 | **Kein Nutzungs- und Kostenbericht je Betrieb für die Abrechnung** (KI-Kosten werden je Vorgang gemessen, Leitplanken existieren, aber kein Bericht/Export). | mittel | [gelesen] `platform-control`; kein Bericht | Preisgestaltung ohne Datenbasis | Bericht und Export je Betrieb und Monat |
| B6 | **Kein aktives Gesundheitsprüfen der KI-Anbieter, keine automatische Sperre von Anbindungen im Lauf** (`PLT-03`, `PLT-04`). | niedrig | [Doku] | Ausfälle zeigen sich erst im Vorgang | Gezielte Prüfung mit Kostenabwägung |
| B7 | **Kein zweiter echter KI-Anbieter eingerichtet** (Anthropic/OpenAI registriert, nur einer im Einsatz). | mittel | [Doku] `PLT-08` | siehe K10 | Zugangsdaten für den zweiten Anbieter |

### 3.5 Architektur, Code und Dokumentation

| ID | Problem | Schwere | Beleg | Folge | Empfehlung |
|---|---|---|---|---|---|
| A1 | **Zwei Prozessmodelle nebeneinander:** die älteren Agenten/Workflows (`/admin/agents`, `/admin/workflows`, `Case.status`) und die neue Prozess-Engine (`orchestrationStatus`, Blueprint, Plan). Ein Vorgang hat zwei Statusfelder; Altvorgänge (R2) stecken im alten Modell. | mittel | [gemessen] Vorgänge mit `RECEIVED`/`IN_PROGRESS` ohne Blueprint; [gelesen] zwei Pfade | Doppelte Pflege, Verwirrung, Fehler an der Nahtstelle | Entscheidung: Altpfad ablösen oder klar abgrenzen; Statusfelder zusammenführen |
| A2 | **Große Dienste:** `intake.service.ts` (928), `orchestrator.service.ts` (923, jetzt mit Ausfall-Wiederholung und Zulassungsprüfung), `reference-process.tools.ts` (676). | niedrig | [gemessen] | Schwerer zu ändern und zu testen | Aufteilen nach Verantwortung (`TEC-04`) |
| A3 | **`next lint` ist veraltet** und entfällt in Next 16. | niedrig | [gemessen] Hinweis im Lint-Lauf | Bruch beim nächsten Upgrade | Auf ESLint-CLI umstellen |
| A4 | **Dokumentation wächst unübersichtlich:** 70 Dateien, `ASSUMPTIONS.md` mit 618 Einträgen (eine Zeile je Eintrag, teils über 2.000 Zeichen), Statusdatei mit überlangen Zeilen, die Liste offener Punkte ist von **13.10.** und enthielt eine **doppelte ID** (`UX-02`, inzwischen als `UX-06` getrennt) sowie überholte Aussagen (z. B. „keine zweite Rückfragerunde“, ersetzt durch #610). | mittel | [gemessen] | Entscheidungen sind schwer auffindbar; Widersprüche | Eine gepflegte Liste (dieses Dokument ersetzt sie als Ausgangspunkt), Entscheidungen nach Thema gliedern |
| A5 | **Prozess-Konfiguration fest im Blueprint:** Wartezeit 72 h, Rundenzahl, Texte lassen sich je Betrieb nicht ändern (nur verschärfende Grenzen). | niedrig | [gelesen] | siehe K5 | Betriebsspezifische Parameter mit Obergrenzen der Plattform |

### 3.6 Tests und Qualitätssicherung

| ID | Problem | Schwere | Beleg | Folge | Empfehlung |
|---|---|---|---|---|---|
| T1 | **Tests konnten den Demo-Betrieb verändern oder zerstören** (Logo, 160 Test-Freigaben, **echte HubSpot-Verbindung gelöscht**). Sechs API-Suiten und zwei Playwright-Dateien sind seit heute umgestellt; **eine technische Sperre fehlt**, die verhindert, dass ein neuer Test wieder dort schreibt. | hoch (behoben im Kern) | [gemessen] Vorher/Nachher-Zähler; `ASSUMPTIONS.md` #618 | Wiederholungsgefahr bei jedem neuen Test | Test-Wächter: Lauf bricht ab, wenn sich der Demo-Betrieb verändert (Zähler-Vergleich), und Regel in der Review-Liste |
| T2 | **E2E-Suite dauert rund 25 Minuten seriell,** der Worker muss gestoppt werden, parallele Läufe stören sich (gemeinsame Datenbank). | mittel | [Doku] `TEC-06` | Selten vollständig gelaufen | Datenbank je Lauf, Worker im Testmodus |
| T3 | **Playwright-Tests mit eigenem Betrieb brauchen `DATABASE_URL`** und werden sonst **stillschweigend übersprungen**; ein grüner Lauf kann also Lücken verbergen. | mittel | [gelesen] `useFreshTenant` | Scheinbare Abdeckung | Übersprungene Tests in der CI als Fehler werten |
| T4 | **Live-Suiten mit echtem Modell laufen nur von Hand** (Kosten); KI-Qualitätsregressionen fallen erst bei manuellen Läufen auf. | mittel | [Doku] | Unbemerkte Verschlechterung nach Prompt-/Modelländerung | Kleiner täglicher Stichprobenlauf mit Budgetgrenze |
| T5 | **Keine Abdeckungsschwellen in der CI;** Abdeckung wird nicht gemessen oder veröffentlicht. | niedrig | [gelesen] `test:cov` vorhanden, nicht erzwungen | – | Schwelle für Kernpakete |
| T6 | **Gestrichene Browser-Prüfungen:** Screenreader/Tastatur auf Mobilgeräten nur automatisiert (axe) geprüft. | niedrig | [Doku] `UX-02` (Altbestand) | Barrieren, die axe nicht findet | Einmal von Hand prüfen |

---

## 4. Beobachtungen aus den Live-Tests dieser Sitzung (zur Einordnung)

Alle behoben, bis auf die in Abschnitt 3 genannten offenen:

* Absendername wurde nicht übernommen → Kontakte ohne Namen (behoben, Commit `90249d7`).
* KI-Zusammenfassung stand in der Kundenmail, mit Zusagen aus dem Profil (behoben, `#611`).
* Die KI verlangte Terminzeiten als zusätzliche Angabe → dreimal dieselbe Frage (behoben, `#613`).
* Ein Netzausfall ließ eine freigegebene Buchung stillschweigend entfallen und scheiterte die CRM-Übergabe sofort (behoben, `#613`/`#614`).
* Eine Testsuite löschte die HubSpot-Verbindung (behoben, `#618`; Verbindung von Ihnen erneut eingerichtet).
* Rohe Schlüssel in KI-Begründungen, Nachrichtentext nicht per Tastatur erreichbar (behoben, `#617`).

---

## 5. Offene Entwicklungspunkte (vollständig, abgeglichen)

Quelle: die Liste vom 13.10. (`OPEN_DEVELOPMENT_ITEMS.md`), fortgeschrieben um den Stand von heute und um die Funde oben. **Erledigtes ist nicht mehr aufgeführt.**
Art: ENG = Entwicklung · EXT = braucht Zugang/Zustimmung Dritter · PROD = braucht Ihre Entscheidung · MAN = Handarbeit.

### 5.1 Sicherheit, Konten, Betrieb

| Punkt | Art | Aufwand | Bezug |
|---|---|---|---|
| Passwort zurücksetzen, E-Mail-Einladung und -Verifizierung für Mandantenbenutzer | ENG | M | S1, `AUT-13` |
| MFA (TOTP) für Mandantenkonten; Pflicht für Administratoren und Betreiber; Wiederherstellung; später Passkeys | ENG | L | S2, B2, `PLT-02` |
| Kontosperre nach Fehlversuchen mit Meldung | ENG | S | S3 |
| Produktionsprüfung beim Start; Compose-Ports an `127.0.0.1`; `/metrics` mit Token | ENG | S | S4 |
| Nest 10 → 11 und weitere Abhängigkeiten aktualisieren | ENG | M | S5 |
| Zeitlimits für Gmail-Lesen, OAuth und KI-Clients; feste Wiederholungsvorgaben | ENG | S | S6 |
| Allowlist und Test für die 36 RLS-Umgehungen | ENG | S–M | S7 |
| Virenscan für Uploads | ENG/EXT | M | S8, `MST-09` |
| Sicherungszeitplan, MinIO-Sicherung, externe Ablage, Wiederherstellungsübung | ENG/MAN | S–M | R5, `TEC-08` |
| Referenz-Deployment (Reverseproxy, TLS, Geheimnisse), CI-Lauf auf echtem Runner | ENG/EXT | M | R6, `MST-12` |
| Mehrinstanz- und Schreiblast-Test, Skalierungsnachweis | ENG | M | R1, `UNI-01` |
| Fristen/Alterung/Archivierung für liegengebliebene Vorgänge; Frist für ungewisse Wirkungen | ENG | M | R2, R3 |
| Echter Ausfalltest (Fehlerinjektion) und Beschleunigung der 72-Stunden-Wartezeit | ENG/MAN | S–M | R4 |
| Gmail-Push bzw. Historie-Abgleich | ENG | M | R7 |
| **Google-Zustimmungsbildschirm auf „In production“** (sonst läuft die Gmail-Zustimmung nach 7 Tagen ab) | **EXT (nur Sie)** | S | `INT-04` |

### 5.2 Produkt – Mandantenseite

| Punkt | Art | Aufwand | Bezug |
|---|---|---|---|
| Freigaben-Liste: Filter (Art, Alter, „von ORBIT vorbereitet“), Verlauf entschiedener Freigaben | ENG | S–M | K3 |
| „Kunden anlegen“-Aufgaben automatisch schließen; automatische Absender ausnehmen | ENG | S | K1, K2 |
| Kurz-Kennung in Vorgangskopf und Suche (Liste, Sonde) | ENG | S | K4, `UX-06` |
| Mandantenspezifische Mailvorlagen, Ton, Fristen und Rundenzahl (mit Prüfung gegen unzulässige Zusagen) | ENG/PROD | M | K5, A5 |
| Terminlogik: Dauer je Leistung, Wege, Umbuchen/Absagen, Lastverteilung, Benachrichtigung der Person | ENG | M | K6, `AUT-02`, `BPF-08` |
| Übergabe-Zusammenfassung verdichten (Kernangaben, Vorlage je Branche); HubSpot-Phase/Pipeline wählbar | ENG | S | K7, K8 |
| Bezug zu früheren Vorgängen in der Oberfläche setzen/ändern; Abgleich über Name/Firma | ENG | S–M | `AUT-03`, `AUT-08` |
| Konditionen und bekannte Adresse im Ablauf nutzen | ENG | M | `AUT-08` |
| Preis- und Terminregeln im Betriebsprofil; Nachweis der Profilhilfe mit echtem Modell | ENG | M | `AUT-10` |
| Meldungen auch beim Warten auf Systeme/Kundschaft; Abwesenheit aus Google/Outlook | ENG | S–M | `AUT-05` |
| Sprache: Rückfragen und Angebotsversand, weitere Sprachen; Übersetzungsrahmen für die Oberfläche | ENG | S–M | `AUT-07`, K12 |
| Einrichtungsassistent: automatisch nach der ersten Anmeldung, Formulare einbetten, Einladung der Mitarbeitenden | ENG | M | #616 |
| Oberfläche für Vertiefungen: Kontakte, Verkaufschancen, Lieferanten, Firmen, Termine, Dokumente, Seiten >1000 Zeilen | ENG | M | `UX-04`, `UX-05` |
| Sonde: Aufträge an die Prozess-Engine übergeben, Bestätigen-Karten, Streaming, „Antwort stoppen“ | ENG | L | `SON-01`, `SON-02` |

### 5.3 Kanäle, Anbindungen, Qualität der KI

| Punkt | Art | Aufwand | Bezug |
|---|---|---|---|
| **Weitere Eingangs- und Ausgangskanäle:** Microsoft 365/Outlook und IMAP, Formular/Webhook-Eingang, Teams, WhatsApp, SMS, Anruf (Meldungen und Kundenkontakt) | EXT | L je Kanal | K9, `AUT-06`, `MST-05`, `MST-01` |
| Weitere CRM/ERP: Lexware, DATEV, HubSpot über OAuth für viele Betriebe | EXT | L je System | `AUT-09`, `MST-04`, `MST-06` |
| Echte Preisquelle aus Warenwirtschaft/ERP | EXT | L | `BPF-06` |
| Echte OCR für Scans und Bilder; Excel; Anhangsinhalt in der Rechnungserfassung | ENG/EXT | M–L | `MST-03`, `BPF-02` |
| Finanzpfad live mit echter Rechnungsmail | MAN/EXT | S | `MST-02` |
| Zweiter echter KI-Anbieter mit Umschaltung | EXT | M | K10, `PLT-08` |
| Qualitätsmessung: `holdout-v3`, Konsistenz ≥ 85 %, weitere Modelle, täglicher Stichprobenlauf | ENG | M | K10, T4, `BPF-05` |
| Größere Stichprobe für den autonomen Vorgangs-Agenten; bewährte Pläne als Prozess vorschlagen | ENG | M | `AUT-01` |
| Konnektor-Gesundheit aktiv prüfen, Versionierung, Registry-Verwaltung; mehrere Konten je Anbieter; Systemlandkarte | ENG | M–L | `INT-01`–`INT-03` |
| Webhook-Signaturprüfung (sobald ein Anbieter Webhooks sendet) | EXT | M | `MST-10` |

### 5.4 Betreiberseite

| Punkt | Art | Aufwand | Bezug |
|---|---|---|---|
| Browser-Tests der Betreiberoberfläche im Alltag und in der CI (Testkonto per Skript) | ENG | M | B1 |
| Betreiberoberfläche vervollständigen (KI-Anbieter, Modelle, Profilentwürfe, Verbindungen, Flag-Ausnahmen, Zugriff auf Vorgangsinhalt per Support-Sitzung) | ENG | M | B4, `PLT-01` |
| Offboarding/Schließen als Ablauf; Support-Historie je Betrieb; Löschnachweis | ENG | M | B3, `PLT-06` |
| Lizenz-/Tarifmodell, Nutzungszähler, Bericht und Export je Betrieb, Rechnungsstellung; Selbstregistrierung | PROD → ENG | L | K11, B5 |
| Einladung neuer Betreiber per E-Mail | ENG | S | `PLT-07` |
| Aktive Prüfung der KI-Anbieter; Sperre beendet laufende Aktionen; mandantenspezifische Region | ENG | S–L | B6, `PLT-03`–`PLT-05` |

### 5.5 Architektur, Tests, Dokumentation

| Punkt | Art | Aufwand | Bezug |
|---|---|---|---|
| Entscheidung und Umsetzung zum Altmodell (Agenten/Workflows, `Case.status`) | PROD → ENG | M–L | A1 |
| Große Dienste aufteilen | ENG | M | A2, `TEC-04` |
| `next lint` → ESLint-CLI; `next build`-Standalone nur im Docker-Build | ENG | S | A3, `TEC-05` |
| E2E-Suite beschleunigen (Datenbank je Lauf, Worker im Testmodus) | ENG | M | T2, `TEC-06` |
| Test-Wächter für den Demo-Betrieb; übersprungene Tests in der CI als Fehler | ENG | S | T1, T3 |
| Abdeckungsschwellen für Kernpakete | ENG | S | T5 |
| Handprüfung Screenreader und Mobiltastatur | MAN | S | T6 |
| Playwright-Gesamtlauf und Live-Suite nach größeren Änderungen routinemäßig | MAN | S | `TEC-10` |
| Dokumentation ordnen: eine gepflegte Offene-Punkte-Liste, `ASSUMPTIONS.md` nach Themen, Statusdatei kürzen | ENG | S–M | A4 |
| Lebenszyklus der Agenten (8 Stufen), Verlauf der Auswertungsläufe, Plan-Editor/Graph-Layout | ENG | M–L | `MV3-01`, `MV3-02`, `BPF-07` |
| Aufbewahrung: automatischer Lauf nach Plan, Anhänge; Kostenprofil pflegen, Triage-Kosten zurechnen | ENG | S | `BPF-03`, `BPF-01` |
| Adapter zu Personalsystemen (Personio, DATEV HR, Entra ID) | EXT | L | `AUT-12` |
| Idempotenzschlüssel auch aus der Oberfläche senden; Queue-/Worker-Integrationstests; Upload live gegen MinIO | ENG/MAN | S–M | `MST-08`, `MST-15`, `MST-16` |

---

## 6. Prioritäten

Rangfolge nach **Risiko × Nutzen ÷ Aufwand**. Die Stufen sind Zeitfenster, keine Zusagen.

### Stufe 0 – diese Woche (klein, aber teuer, wenn man es lässt)

| # | Maßnahme | Aufwand | Warum jetzt |
|---|---|---|---|
| 1 | **Google auf „In production“ stellen** (nur Sie) | S | Sonst bricht Gmail alle 7 Tage; ohne Postfach nimmt ORBIT nichts mehr an |
| 2 | **Test-Wächter für den Demo-Betrieb** (Lauf bricht ab, wenn sich Zähler ändern; übersprungene Tests in der CI melden) | S | Die heutige HubSpot-Löschung darf sich nicht wiederholen |
| 3 | **Zeitlimits** für Gmail-Lesen, OAuth und KI-Clients | S | Ohne sie greift die neue Ausfall-Wiederholung erst nach Minuten |
| 4 | **Produktionsprüfung beim Start**, Compose-Ports an `127.0.0.1`, `/metrics` mit Token | S | Billige Härtung; heute wäre ein erreichbarer Rechner offen |
| 5 | **„Kunden anlegen“-Aufgaben:** automatisch schließen, automatische Absender ausnehmen | S | Sichtbares Rauschen, jeden Tag mehr |

### Stufe 1 – nächste zwei bis vier Wochen (Voraussetzung für echte Kunden)

| # | Maßnahme | Aufwand | Warum |
|---|---|---|---|
| 6 | **Freigaben-Liste** mit Filtern, Alter und Verlauf | S–M | Sie haben es selbst erlebt; direkt spürbarer Nutzen |
| 7 | **Passwort zurücksetzen, E-Mail-Einladung, Kontosperre** | M | Ohne das kann kein Betrieb sich selbst helfen (S1, S3) |
| 8 | **MFA** für Mandantenkonten, **Pflicht** für Administratoren und Betreiber | L | Größtes Sicherheitsrisiko (S2, B2) |
| 9 | **Betreiber-Browser-Tests** im Alltag und in der CI | M | 3.600 Zeilen Oberfläche ohne Regressionsschutz (B1) |
| 10 | **Nest 10 → 11** und übrige Abhängigkeitsfunde | M | Bekannte Lücke im Framework (S5) |
| 11 | **CI auf einem echten Runner** verifizieren, Playwright mit eigenem Betrieb dort lauffähig | S | Bisher nie gelaufen (R6, T3) |
| 12 | **Alterung/Eskalation liegengebliebener Vorgänge** und ungewisser Wirkungen; Altbestand archivieren | M | Arbeit bleibt sonst unbemerkt liegen (R2, R3) |
| 13 | **Echter Ausfalltest** (Fehlerinjektion) und Beschleunigung der 72-Stunden-Wartezeit | S–M | Verhalten im Ernstfall nur per Test belegt (R4) |
| 14 | **Mandantenspezifische Mailvorlagen und Fristen** | M | Einlösung des Versprechens „ORBIT passt sich dem Betrieb an“ (K5) |
| 15 | **Finanzpfad live** mit einer echten Rechnungsmail (nur ein Testpostfach nötig) | S | Letzter nicht live belegter Hauptpfad (`MST-02`) |
| 16 | **Sicherungszeitplan** und externe Ablage | S–M | Datenverlust ist nicht verhandelbar (R5) |
| 17 | **Kurz-Kennung** in Vorgangskopf und Suche (`UX-06`) | S | Kleiner Aufwand, spart Verwirrung (K4) |

### Stufe 2 – ein bis drei Monate (Produktbreite und Betrieb)

| # | Maßnahme | Aufwand |
|---|---|---|
| 18 | Entscheidung zum Altmodell (Agenten/Workflows) und Zusammenführung der Statusfelder | M–L |
| 19 | Weitere Kanäle: Microsoft 365/Outlook und IMAP, Formular-Eingang, danach Teams/WhatsApp/SMS | L je Kanal |
| 20 | Weitere CRM/ERP (Lexware, DATEV, HubSpot über OAuth), echte Preisquelle | L je System |
| 21 | Lizenz-/Tarifmodell, Nutzungsbericht, Selbstregistrierung (vorher Produktentscheidung) | L |
| 22 | Betreiber: Offboarding, Oberfläche vervollständigen, Einladung per E-Mail, Support-Historie | M |
| 23 | Zweiter KI-Anbieter mit Umschaltung; `holdout-v3`; täglicher Stichprobenlauf | M |
| 24 | Terminlogik vertiefen (Dauer, Wege, Umbuchen/Absagen, mehrere Kalender) | M |
| 25 | Mehrinstanz- und Schreiblast-Test; Referenz-Deployment mit TLS | M |
| 26 | Virenscan; echte OCR; Excel-Anhänge | M–L |
| 27 | E2E-Suite beschleunigen (Datenbank je Lauf) | M |
| 28 | Dokumentation ordnen (eine gepflegte Liste, Entscheidungen nach Thema) | S–M |

### Stufe 3 – bei Bedarf

Sonde (Delegieren, Streaming, Stopp), Plan-Editor, Lebenszyklus der Agenten, Verlauf der Auswertungsläufe, mehrere Konten je Anbieter, Systemlandkarte, Personalsystem-Adapter,
Übersetzungsrahmen, Aufteilen großer Dienste, `next lint`-Migration, Passkeys, mandantenspezifische Region.

### Empfohlene Reihenfolge der Umsetzung (Wellen)

1. **Welle A (Tage):** 1–5. Danach ist das System sicherer, die Tests tun keinen Schaden mehr, und die Aufgabenliste ist ruhig.
2. **Welle B (Wochen 1–3):** 6, 7, 8, 11, 12, 17. Konten und Alltag werden tragfähig.
3. **Welle C (Wochen 3–5):** 9, 10, 13, 14, 15, 16. Absicherung (Betreiber, Abhängigkeiten, Ausfall, Sicherung) und das Versprechen der Anpassung an den Betrieb.
4. **Danach** nach Ihrer Produktentscheidung: Kanäle (19), Anbindungen (20), Abrechnung (21).

**Entscheidungen, die nur Sie treffen können** (blockieren die jeweilige Gruppe): Google „In production“; Zugang zu Rechnungsmail/Testpostfach (15); welche weiteren Kanäle
und Systeme zuerst (19/20); Tarifmodell und Selbstregistrierung (21); ob das Altmodell (18) abgelöst wird; ob MFA für alle Betriebe verpflichtend sein soll (8).

---

## 7. Grenzen dieser Analyse

* **Nicht ausgeführt:** die vollständige API-E2E-Suite und der vollständige Playwright-Lauf (nur gezielte Teilmengen, alle grün); die Live-Suiten mit echtem Modell.
* **Nicht geprüft:** Benutzer-Sitzungsverwaltung (Geräteliste), Barrierefreiheit über das automatisierte Maß hinaus, Datenschutz-Folgenabschätzung und Auftragsverarbeitung mit den KI-Anbietern
  (rechtlich), Leistung der Oberfläche unter Last, Verhalten bei sehr großen Postfächern.
* **Aus Dokumenten übernommen, nicht neu geprüft:** der Status der Punkte mit der Kennzeichnung [Doku]. Dort gilt der Stand vom 13.10. bzw. dem Eintrag in `ASSUMPTIONS.md`.
* **Bewertung der Schwere** ist eine Einschätzung aus Sicht „produktiver Einsatz bei fremden Betrieben“; für den heutigen Entwicklungs- und Testbetrieb auf einem Rechner sind
  S1–S4 und R6 deutlich weniger dringend, als sie dort stehen.
