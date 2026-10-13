# Funktionsumfang – Project ORBIT

Stand: 2026-10-13 (Commit nach `9b58d9d`). Diese Datei beschreibt, **was die Lösung heute tut** – getrennt nach der Mandantenlösung (die Betriebe nutzen) und der
Plattform (der Betrieb von ORBIT selbst). Sie ersetzt keine Detaildokumente, sondern verweist auf sie. Jede Zeile trägt den ehrlichen Status aus
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md):

| Status | Bedeutung |
|---|---|
| **IMPLEMENTED** | Code vorhanden, folgt der Zielarchitektur |
| **TESTED LOCALLY** | automatisiert und lokal gegen echte Postgres geprüft (Modell/Versand als Doubles) |
| **TESTED WITH MOCK** | gegen einen Mock-Connector bzw. ein Test-Double geprüft |
| **LIVE TESTED** | gegen echte Infrastruktur oder einen echten Dienst (z. B. Modell `gpt-6-luna`, Gmail-Lesen) nachgewiesen |
| **REQUIRES PROVIDER CREDENTIALS** | braucht Zugangsdaten bzw. Zustimmung Dritter, die in dieser Umgebung nicht vorliegen |

Die offenen Entwicklungspunkte stehen in [`OPEN_DEVELOPMENT_ITEMS.md`](OPEN_DEVELOPMENT_ITEMS.md), die Ergebnisse der Codebasis-Prüfung in
[`CODEBASE_REVIEW_2026-10.md`](CODEBASE_REVIEW_2026-10.md).

---

## 1. Aufbau

**Monorepo** (pnpm + Turborepo), TypeScript durchgehend, rund 80 000 Zeilen (Quellcode 66 000: API 36 000, Web 18 600, Pakete 11 700; dazu 14 200 Zeilen Tests).

| Baustein | Aufgabe |
|---|---|
| `apps/api` (NestJS) | REST-API für Mandanten (`/api/v1/…`) und Plattform (`/api/v1/platform/…`), 50 Module |
| `apps/api/worker` | Hintergrundverarbeitung (BullMQ): Workflow-Läufe, Postfach-Abruf, Prozess-Sweep, Kundenstamm-Nachprüfung, Meldungen/Eskalation |
| `apps/web` (Next.js 15) | Oberfläche für Mandanten (`/…`) und Betreiber (`/platform/…`) |
| `packages/shared` | gemeinsame Typen, Berechtigungen, Prozess-Schemas, Projektionen, Labels, Routing/Eskalationslogik (reine Funktionen); **CJS + ESM-Build** |
| `packages/domain` | Prisma-Schema (81 Modelle, 53 Migrationen), Migrationen, mandantengebundener Client (`forTenant`) |
| `packages/agent-core` | LLM-Anbieter (Anthropic, OpenAI), Werkzeug-Register, Policy-Engine, Prompt-Schichten, Agent-Runtime |
| `packages/integration-core` | Connector-Verträge (Finance, Mail, Kalender, CRM, Telefonie, OCR, **Kundenverzeichnis**) mit Mocks und Registry |
| `packages/ui` | Komponentenbibliothek (Button, Card, Badge, Diagramme, sortierbare Tabellen …) |
| `packages/config` | Umgebungs- und Branding-Konfiguration (Zod-validiert) |
| Infrastruktur | Postgres (Row-Level-Security), Redis, MinIO (S3), Jaeger; Docker Compose für den vollen Stack |

**Zwei getrennte Sicherheitsdomänen:** Mandantenanmeldung (eigenes Geheimnis, Rollen je Mandant) und Plattformanmeldung (eigene Identitäten, eigenes Geheimnis,
Step-up, unveränderliches Plattform-Audit). Kein Token der einen Domäne gilt in der anderen.

---

## 2. Mandantenlösung (die Betriebe)

### 2.1 Zugang, Rollen, Mandantentrennung

| Funktion | Status | Kern |
|---|---|---|
| Anmeldung (JWT, Refresh-Token als httpOnly-Cookie, Zugangstoken nur im Arbeitsspeicher) | LIVE TESTED | Drosselung, Abmeldung widerruft |
| Rollen und Berechtigungen | LIVE TESTED | TENANT_ADMIN, FINANCE_USER, SALES_USER, APPROVER, VIEWER, SYSTEM_ADMIN; Berechtigungen als Zeilen je Rolle |
| Mandantentrennung | LIVE TESTED | Postgres-Row-Level-Security auf allen mandantengebundenen Tabellen, `forTenant()`-Client, Test auf Fremdmandanten |
| Benutzerverwaltung, Deaktivierung | LIVE TESTED | `/admin/users` |
| Datenschutz: Datenexport, Löschantrag, Aufbewahrungsfristen | LIVE TESTED | `/admin/settings`, `/admin/retention` |
| Erscheinungsbild (Logo, Farben, Kontrast-Absicherung) | LIVE TESTED | `/admin/branding`, mandantengetrennt gecacht |

### 2.2 Eingang und Verstehen (Posteingang → Vorgang)

| Funktion | Status | Kern |
|---|---|---|
| Gmail-Anbindung (OAuth, Lesen, Senden, Kalender frei/belegt) | LIVE TESTED (Lesen, Senden); Google-Testmodus läuft nach 7 Tagen ab | Zustimmung je Mandant, Banner bei Unterbrechung, `invalid_grant` vs. vorübergehende Fehler |
| Normalisierte Eingangsereignisse, Abruf im Takt, Idempotenz | LIVE TESTED | `IntakeEvent`, Poll-Adapter, Sync-Queue |
| **Semantische Triage mit echtem Modell** | LIVE TESTED (`gpt-6-luna`) | Relevanz, Kategorie, Dringlichkeit (CRITICAL nach Inhalt, gewerkeunabhängig), Rollenhypothese, Risikohinweise; nie Schlüsselwörter; bei Ausfall zurückgestellt statt gefiltert |
| Betriebsprofil in der Anweisung | LIVE TESTED | Branche, Leistungen, Ausschlüsse, Einsatzgebiet, Zeiten, Notdienst, Tonalität fließen in Triage und Anforderungsanalyse |
| Posteingang `/inbox`, „Kein Prozess ausgelöst“-Ansicht, Entscheidung korrigieren | LIVE TESTED | Suche, Sortierung, Datum, Absprung auf den Treffer |
| **Jede relevante Nachricht wird ein Vorgang** | TESTED LOCALLY | auch ohne hinterlegten Prozess (Beschwerde, Notfall, Bewerbung …) als neutraler Prüfvorgang |
| Zuordnung von Antworten zum Vorgang | LIVE TESTED | starke Verweise (Thread, In-Reply-To), fremde Absender werden nicht zugeordnet |

### 2.3 Prozess-Engine (Amendment 02)

| Funktion | Status | Kern |
|---|---|---|
| Universal Case, Fakten mit Herkunft und Beleg, Korrelation | TESTED LOCALLY / LIVE | Fakten gelten nur mit wörtlichem Beleg als bestätigt |
| Blueprints (Registry, Versionen, Aktivierung), Capability-Katalog (9 Fähigkeiten), Planer + deterministischer Validator, Orchestrator, Action-Ledger | TESTED LOCALLY | Ad-hoc-Pläne brauchen Freigabe; Limits für Aktionen/Fehler (BP-39) |
| **Referenzprozess „Angebotsanfrage“** | LIVE TESTED (Modell echt, Versand teils simuliert → live) | Kontext → Angaben entnehmen → Anforderungen → Rückfrage (Freigabe oder autonom) → Antwort fortsetzen → Preis aus Quelle → Angebot → Dokument → Versand mit Nachweis |
| KI-Anforderungsanalyse | LIVE TESTED | gezielte Fragen je Leistung, Vor-Ort-/Telefontermin-Entscheidung |
| Terminvorschläge aus dem Kalender (frei/belegt) | LIVE TESTED (Gmail-Kalender), kein automatischer Eintrag | Terminwahl wird als Fakt festgehalten |
| Wartepunkte, Fristen, Wiederaufnahme nach Neustart (Sweep) | TESTED LOCALLY | Zustand liegt in Postgres, die Queue ist nur Auslöser |
| **Live-Abgleich** | TESTED LOCALLY | simulierte oder an einer Verbindung hängende Schritte werden automatisch live wiederholt (mit Schutzregeln) |
| Orchestrierungsansicht (Schritte, Graph, Historie, Knotendetails, ehrlicher Ausführungsmodus Live/Simuliert) | TESTED LOCALLY (Playwright) | `/cases/[id]` |
| Ehrliche Fehler: `SUCCEEDED / FAILED / OUTCOME_UNKNOWN`, nie doppelt senden | TESTED LOCALLY | Ergebnis unbekannt → Abgleich durch einen Menschen |

### 2.4 Freigaben und Regeln

| Funktion | Status | Kern |
|---|---|---|
| Policy-Engine (DISABLED / SUGGEST_ONLY / REQUIRE_APPROVAL / AUTONOMOUS je Aktion, feste Obergrenzen) | LIVE TESTED | `payment.execute` bleibt gesperrt, Bankdaten/Lieferanten immer mit Freigabe |
| **Automatisierungsgrad** (Vorsichtig / Ausgewogen / Hochautomatisiert) | TESTED LOCALLY | bei der Anlage des Betriebs wählbar, später jederzeit; „Individuell“ bei Abweichungen |
| Freigabe-Warteschlange und -Detail (Wirkung, Nachweise, Risiko) | TESTED LOCALLY (Playwright) | bindet die Freigabe an Nutzlast-Hash und Planrevision |
| Freigaben, die wegen unterbrochener Verbindung nicht ausgeführt werden können | TESTED LOCALLY | bleiben offen, kein falsches „erledigt“ |

### 2.5 Fachbereiche

| Bereich | Status | Kern |
|---|---|---|
| **Finance**: Rechnungseingang, OCR (Mock), Dublettenprüfung, Bankänderungs-Erkennung, Lieferanten-Freigabe, Buchungsvorschlag, FiBu-Übertragung (Mock) | LIVE TESTED (Workflow), Finanzsystem **REQUIRES PROVIDER CREDENTIALS** | `/finance/invoices`, `/finance/suppliers` |
| **Sales**: Firmen, Kontakte, Leads, Opportunities, Termine | LIVE TESTED | `/sales/…`; CRM-Abgleich über Mock |
| Aufgaben | LIVE TESTED | Fälligkeit, Zuordnung, Übersicht mit Datum und Sortierung |
| Aktivitätsfeed, globale Suche (Absprung auf genau den Treffer) | LIVE TESTED | |
| Startseite auf einer Bildschirmseite (Aufmerksamkeit, Eingang, Aufgaben, Erledigtes, Kennzahlen mit definierter Herkunft) | TESTED LOCALLY | serverseitige Projektion, gleiche Zahl auf Startseite, Liste und Sonde |

### 2.6 KI-Assistenz und -Konfiguration

| Funktion | Status | Kern |
|---|---|---|
| **Sonde** (Chat-Assistenz): Fragen, Vorbereiten, Handeln (mit Freigabe), SSE-Streaming, Vorgangskontext | LIVE TESTED | nicht: DELEGATE, „Antwort stoppen“ |
| Agenten-Konfiguration (Versionen, Rollback, Testlauf, Auswertungsfälle) | LIVE TESTED | `/admin/agents` |
| Durable Workflows mit Freigabe-Fortsetzung | LIVE TESTED | `/admin/workflows` |
| KI-Anbieter je Mandant (Plattform-verwaltet oder eigener Schlüssel, BYOK) | LIVE TESTED (strukturell); zweiter echter Anbieter **REQUIRES PROVIDER CREDENTIALS** | `/admin/ai-providers` |
| Prompt-Schichtung, Injection-Grenze (`wrapUntrustedContent`) | LIVE TESTED | Kundentext nie als Anweisung |

### 2.7 Betriebswissen, Mitarbeiter, Meldungen (neu, Oktober 2026)

| Funktion | Status | Kern |
|---|---|---|
| **Unternehmensprofil** `/admin/company` | TESTED LOCALLY | Branche, Leistungen, Ausschlüsse, Einsatzgebiet, Zeiten, Notdienst, Tonalität, Sprachen, häufige Fragen, Erinnerungs-/Eskalationszeiten |
| **Mitarbeiterverzeichnis** `/admin/staff` | TESTED LOCALLY | Rolle, Zuständigkeiten, bevorzugter Kanal, Vorgesetzte/r, Vertretung; manuell, CSV (Vorschau → Übernahme) oder `PUT /staff/sync` |
| Einrichtungs-Checkliste und Verzeichnislücken | TESTED LOCALLY | wird aus dem Stand berechnet |
| **Meldung → Erinnerung → Eskalation** bei wartenden Vorgängen | TESTED LOCALLY | zuständig → Vertretung → Vorgesetzte/Leitung; Notfälle 15/45 min; „Ich kümmere mich“; Zustellung per E-Mail |
| **Kundenstamm-Prüfung** (gefunden / nicht gefunden / nicht erreichbar) mit Selbstanlage oder Bitte an einen Menschen und Nachprüfung | TESTED LOCALLY; führendes System **TESTED WITH MOCK** | kein echtes CRM/ERP angebunden |
| Teams-, WhatsApp-, SMS-, Anrufkanal | **REQUIRES PROVIDER CREDENTIALS** | als Wunsch erfasst, zugestellt wird (ehrlich ausgewiesen) per E-Mail |

### 2.7a Integrationen

| Connector | Status |
|---|---|
| Gmail (Lesen, Senden, Kalender frei/belegt) | LIVE TESTED |
| Microsoft 365, Google Calendar (Schreiben), DATEV, Lexware, HubSpot, Twilio | Verträge + Mocks (**TESTED WITH MOCK**); echte Anbindung **REQUIRES PROVIDER CREDENTIALS** |
| Registry (7 Typen mit Fähigkeiten), Credential-Vault (AES-256-GCM), generischer OAuth2-Dienst, strukturierte Formulare ohne JSON | LIVE TESTED |

---

## 3. Plattform (Betrieb von ORBIT, Amendment 03)

Eigene Oberfläche unter `/platform/*`, eigene API unter `/api/v1/platform/*`, eigene Identitäten (8 Betreiberrollen: Owner, Operator, Support, Security, FinOps,
Release Manager, Engineering, Auditor – Rechte als Scopes).

| Funktion | Status | Kern |
|---|---|---|
| Betreiberanmeldung, Passwortwechsel, Rücksetzen durch den Owner, Step-up (Passwort-Re-Auth) | TESTED LOCALLY | kein MFA |
| Mandantenregister, **Zustand ändern** (Vorschau mit Wirkung, Bestätigung gebunden an die Vorschau), Sperren je Bereich | TESTED LOCALLY | |
| **Neukunde anlegen** (Branche, Automatisierungsstufe, erster Administrator, Startpasswort einmalig) | TESTED LOCALLY (API-E2E); Oberfläche ohne Playwright | |
| Feature-Flags mit Kohorten und Rollout | TESTED LOCALLY | |
| Kill-Switches (global, KI, Connector, Mandant) | TESTED LOCALLY | wirken verschärfend, nie lockernd |
| Connector-Lebenszyklus und -Sperre | TESTED LOCALLY | laufende Aktionen werden nicht aktiv beendet |
| **KI-Governance**: Register (Anbieter, Modelle, Profile, Routen), Plattform-Verbindungen, Geheimnis-Tresor, Messung jedes Aufrufs, Health aus echten Aufrufen, Kosten-Leitplanken und Anomalie-Alarm | TESTED LOCALLY / WITH MOCK | keine aktive Health-Prüfung (würde bezahlte Aufrufe auslösen) |
| **Diagnose**: Referenzsuche, Vorgangs-Projektion ohne Inhalte, Export als Datei (Step-up, Prüfsumme im Audit) | TESTED LOCALLY | |
| **Support-Sitzungen** (Vier-Augen, Umfang, Ablauf) | TESTED LOCALLY | tieferer Zugriff nur darüber |
| **Plattform-Audit** (unveränderlich, rollenabhängige Sicht) | TESTED LOCALLY | |
| Laufzeitüberwachung der Queues/Worker, Alarm-Banner, optionaler Webhook | LIVE TESTED (Stack) | |
| Betreiber-Bootstrap per Skript | LIVE TESTED | `apps/api/scripts/platform-bootstrap.ts` |

---

## 4. Querschnitt

| Thema | Stand |
|---|---|
| **Audit** | ein Besitzer: `AuditLog` (Mandant) und Domäne `PLATFORM`; Audit-Einträge enthalten nie Adressen/Texte/Passwörter |
| **Observability** | Prometheus-Metriken (`/metrics`), strukturiertes Logging (pino), OpenTelemetry-Tracing → Jaeger |
| **Skalierung** | Worker/Queue mit Mandanten-Fairness, Redis-gestützte Drosselung, Retention-Grundlage; Lasttest steht aus |
| **Sicherheit** | Row-Level-Security, AES-256-GCM-Tresor, Upload-Limits, Webhook-Idempotenz, Injection-Grenze, Sitzungen im Cookie |
| **Tests** | Unit ≈ 870 (API 504, shared 198, agent-core 51, web 40, integration-core 32, ui 16, config 13, domain 10), API-E2E 52 Suiten (≈ 410 Fälle, gegen echte Postgres), Playwright 17 Dateien (≈ 130 Fälle inkl. axe), Live-Tests mit echtem Modell (nur mit `LIVE_AI=1`) |
| **Dokumentation** | `docs/` mit Spezifikationen, Annahmenregister (`ASSUMPTIONS.md`, Nummern bis 559), Statusdateien |
