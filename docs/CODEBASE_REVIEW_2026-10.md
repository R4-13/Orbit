# Codebasis-Prüfung Oktober 2026

Gegenstand: Plattform (Betreiber) und Mandantenlösung, API, Worker, Web und alle Pakete. Ziel: Struktur und Laufzeitverhalten prüfen, die Lösung schneller und schlanker
machen, überflüssigen Code entfernen. Umgesetzt wurde, was **messbar oder eindeutig** besser ist und durch Tests abgesichert werden konnte; alles andere steht als Empfehlung in
[`OPEN_DEVELOPMENT_ITEMS.md`](OPEN_DEVELOPMENT_ITEMS.md). Funktionsumfang: [`FUNCTIONAL_OVERVIEW.md`](FUNCTIONAL_OVERVIEW.md).

## 1. Vorgehen

| Prüfung | Werkzeug | Ergebnis |
|---|---|---|
| Größe und Struktur | Zeilenzählung, Dateigrößen | Quellcode ≈ 66 000 Zeilen, Tests ≈ 14 200; größte Datei 899 Zeilen (`intake.service.ts`), keine unübersichtlichen Riesen |
| Ungenutzter Code | `knip` (Dateien, Exporte, Abhängigkeiten) + Gegenprüfung per Suche | siehe 3 |
| Doppelter Code | `jscpd` (≥ 12 Zeilen / 90 Tokens, ohne Tests) | **0,1 %** (4 Treffer, 64 Zeilen) – kein Handlungsbedarf |
| Antwortzeiten der API | Messskript gegen den laufenden Stack (nur lesende Aufrufe, Median aus 5) | siehe 2.1 |
| Datenbank | Tabellen-/Indexübersicht, Abfragemuster im Code, Zeilenzahlen | siehe 2.3 |
| Browser-Bundle | `next build` (Docker, Routen-Tabelle) vor und nach der Änderung | siehe 2.2 |
| Abfragen in Schleifen | Suche nach `await` in `for`-Schleifen, Einzelprüfung der heißen Stellen | siehe 2.4 |
| Test-Hygiene | Mandantenanzahl der gemeinsamen Datenbank | siehe 4 |

**Wichtige Einschränkung:** Die Entwicklungsdatenbank ist klein (Hunderte Zeilen je Tabelle). Antwortzeiten auf dieser Datenmenge belegen, dass nichts auffällig langsam ist, **nicht**
wie sich die Lösung bei zehntausenden Datensätzen verhält. Indizes und Obergrenzen sind deshalb vorsorglich (anhand der Abfragemuster), nicht aus Messwerten begründet.
Ein Lasttest steht aus (`UNI-01`).

## 2. Befunde und Änderungen

### 2.1 Antwortzeiten (Ausgangslage, Entwicklungsdaten)

| Aufruf | Median | Antwortgröße |
|---|---|---|
| `GET /dashboard/snapshot` (Startseite, alle 60 s) | 181 ms | 8 kB |
| `GET /cases/overview` | 62–74 ms | 12 kB |
| `GET /inbox/items` | 54 ms | 19 kB |
| `GET /leads/overview` | 53 ms | 49 kB |
| `GET /agent-runs` | 53 ms | **241 kB** |
| `GET /approvals` | 45 ms | **223 kB** |
| `GET /invoices` | 41 ms | **164 kB** |
| `GET /meetings`, `/tasks`, `/documents`, `/suppliers`, `/contacts` | 18–31 ms | 58–150 kB |
| übrige Lese-Endpunkte | < 25 ms | < 25 kB |

Befund: **Keine langsame Abfrage**; auffällig ist die Antwortgröße der einfachen Listen-Endpunkte, die **unbegrenzt** alles liefern. Die Oberfläche nutzt dafür eigene,
seitenweise Übersichten (`/…/overview`); die einfachen Listen dienen der Schnittstelle und Auswahlfeldern, würden aber bei großen Mandanten alles laden.

### 2.2 Browser-Bundle: ESM-Build für `@orbit/shared` (größte messbare Verbesserung)

`@orbit/shared` (Typen, Berechtigungen, Schemas mit Zod, Labels) wurde nur als CommonJS gebaut. Der Bundler kann CommonJS nicht „bereinigen“: jede Seite, die auch nur eine
Konstante importierte, zog das **ganze** Paket samt Zod in ihr Bundle.

Änderung: zusätzlicher ESM-Build (`dist/esm`), `module`-Feld und `"sideEffects": false` im Paket. Die API und die Tests nutzen weiter die CommonJS-Ausgabe (`main`), nur der
Browser-Bundler nimmt die ESM-Variante.

| Seite | First Load JS vorher | nachher | Änderung |
|---|---|---|---|
| `/admin` | 193 kB | 129 kB | −33 % |
| `/admin/company` | 195 kB | 144 kB | −26 % |
| `/admin/staff` | 196 kB | 147 kB | −25 % |
| `/cases` | 199 kB | 134 kB | −33 % |
| `/cases/[id]` | 214 kB | 166 kB | −22 % |
| `/dashboard` | 200 kB | 137 kB | −32 % |
| `/inbox` | 204 kB | 154 kB | −25 % |
| `/integrations` | 204 kB | 141 kB | −31 % |
| `/platform` | 191 kB | 128 kB | −33 % |
| `/platform/tenants` | 194 kB | 131 kB | −32 % |
| von allen Seiten geteilt | 104 kB | 102 kB | |

(Quelle: Routen-Tabelle von `next build` im Docker-Build vor/nach der Änderung. Gemessen wird die Download-Größe des ersten Seitenaufrufs, nicht die Renderzeit.)
Die Oberfläche wurde danach mit 92 Playwright-Tests (Shell, Module, Barrierefreiheit, Anmeldung, Verwaltung) bestätigt.

### 2.3 Datenbank

Neue Indizes (additive Migration `performance_indexes`, anhand der Abfragemuster):

| Tabelle | Index | Abfrage, die davon profitiert |
|---|---|---|
| `cases` | `(tenant_id, updated_at)`, `(orchestration_status, updated_at)` | Vorgangsübersicht sortiert nach Aktualisierung; Prozess-Sweep über alle Mandanten |
| `intake_events` | `(case_id)` | Zuordnung Vorgang ↔ Eingang (Triage-Kategorie, Absendername, Antwort-Zuordnung) |
| `leads`, `invoices` | `(case_id)` | Gegenüber in der Vorgangsübersicht |
| `invoices` | `(tenant_id, created_at)` | Rechnungsliste |
| `contacts` | `(tenant_id, email)` | Absenderprüfung bei jedem Eingang (Kundenstamm) |
| `email_messages` | `(tenant_id, from_address)`, `(tenant_id, created_at)` | frühere Vorgänge einer Adresse, Nachrichtenliste |
| `agent_runs` | `(tenant_id, case_id)`, `(tenant_id, started_at)` | Läufe je Vorgang, Aktivitätsliste |

Der Nutzen ist erst bei großen Datenmengen messbar (auf den Entwicklungsdaten wählt Postgres ohnehin Sequenzscans). Die Kundenverzeichnis-Suche fragt zuerst über den Index
(Adresse wie angegeben/klein geschrieben) und fällt nur bei Nichtfund auf die groß/klein-unabhängige Suche zurück.

### 2.4 Abfragen im Code

| Stelle | Änderung | Wirkung |
|---|---|---|
| `PlanStoreService.create` | Knoten und Kanten mit `createMany` statt einer Abfrage je Element | ein Plan mit 15–20 Knoten: ≈ 35 Abfragen weniger je Plan-Anlage/Neuplanung |
| `AttentionService.notifyPhase` | bestehende Meldungen des Eintrags mit **einer** Abfrage statt einer je Empfänger | |
| `CasesOverviewService.list` | Gesamtzahl der Ansicht aus dem Filter-Zähler übernommen (vorher 5 statt 4 Zählungen, eine davon mit identischer Bedingung) | eine Abfrage weniger je Listenaufruf |
| `DashboardService.metrics` | die drei unabhängigen Kennzahlen laufen gleichzeitig (vorher nacheinander) | kürzeste Zeit der Startseite = längste Kette statt Summe |
| einfache Listen-Endpunkte (`tasks`, `cases`, `invoices`, `documents`, `suppliers`, `leads`, `opportunities`, `approvals`, `contacts`, `companies`, `meetings`) | Obergrenze 1000 Zeilen (`LIST_HARD_LIMIT`) | Schutz vor unbegrenzten Antworten |

Geprüft und **bewusst unverändert** gelassen: die Schleifen in `ConnectorStatusService` und `Orchestrator` (kleine, früh endende Mengen), die Anlage eines Mandanten
(einmalig je Betrieb), die Dashboard-Abfragen (sind bereits parallel).

### 2.5 Überflüssiger Code und Abhängigkeiten

| Entfernt | Begründung (per Suche gegengeprüft) |
|---|---|
| `apps/web/src/lib/hooks/use-meetings.ts` | Datei ohne Verwender |
| Hooks `useAgentRun`, `useApprovals`, `useCases`, `useSendMessage`, `useEmailMessages`, `useCreateInvoiceFromDocument`, `useLeads`, `useTasks` | ohne Verwender (die Oberfläche nutzt die Übersichts-Projektionen) |
| `caseTypeLabel` samt Tabelle | ohne Verwender |
| Abhängigkeit `passport-local`, `uuid` (+ `@types/…`) in `apps/api` | nirgends importiert (JWT-Strategie genügt) |
| Abhängigkeit `@orbit/config`, `clsx`, `tailwind-merge`, `next-intl`, `zod` in `apps/web` | nirgends im Web importiert (`clsx`/`tailwind-merge` nutzt `@orbit/ui` selbst) |
| Abhängigkeit `@orbit/shared`, `zod` in `packages/integration-core`, `@faker-js/faker` in `packages/testing` | ungenutzt |

`pnpm-lock.yaml` wurde neu aufgelöst (−174 Zeilen); der Docker-Build mit gefrorener Lockdatei läuft durch.

Geprüft, aber **bleibt**: die übrigen „ungenutzten Exporte“ aus `knip` (≈ 40 Konstanten, ≈ 100 Typen) werden von Tests, Modulen oder Dateien desselben Pakets verwendet oder
sind absichtlich öffentlich; der Gewinn beim Entfernen wäre null, das Risiko nicht. Dienste, die nur über `onModuleInit` oder das Werkzeug-Register eingehängt werden
(Prozess-Werkzeuge, Entwurfs-Bearbeitung, Metriken), sind keine toten Klassen.

## 3. Struktur – Bewertung

* **Schichtung ist sauber:** Controller dünn, Fachlogik in Diensten, reine Entscheidungslogik in `@orbit/shared` (Routing/Eskalation, Anforderungen, Preise, Projektionen) und
  damit ohne Datenbank testbar. Eine Quelle der Wahrheit je Verantwortung (Audit, Policy, Connector-Registry), wie in `SPEC_GOVERNANCE_INDEX.md` gefordert.
* **Mandantentrennung zweifach:** Anwendungsschicht (`forTenant`) und Postgres-RLS. Neue Mandantentabellen müssen in `TENANT_SCOPED_MODELS` eingetragen werden – sonst
  schlägt der erste Schreibzugriff an der RLS fehl (in dieser Arbeit einmal passiert, jetzt in `ASSUMPTIONS.md` #552 festgehalten).
* **Doppelter Code:** 0,1 % – kein Zusammenführen nötig.
* **Größte Dateien** (`intake.service.ts` 899, `orchestrator.service.ts` 834 Zeilen) sind kohärent; Aufteilen lohnt erst bei weiterem Wachstum (`TEC-04`).
* **Tests:** Unit ≈ 870, API-E2E 52 Suiten gegen echte Postgres, Playwright ≈ 130 Fälle inkl. Barrierefreiheit.

## 4. Test-Hygiene

Fünf API-E2E-Suiten (`copilot`, `ai-providers`, `agent-evaluation`, `retention`, `branding`) haben ihre Test-Mandanten nie gelöscht. In der gemeinsamen Entwicklungsdatenbank lagen
dadurch **381 Mandanten** (zusammen 30 833 Rollenrechte, 9 884 Regelzeilen, 4 305 Refresh-Tokens …), die jede Mandantenabfrage mit durchsuchte. Die Suiten räumen jetzt am Ende selbst auf
(auch Reste früherer Läufe), die Datenbank hat nun 6 Mandanten und 482 Rollenrechte. Der Demo-Mandant `musterwerk` wurde nicht angefasst.

Weitere Beobachtungen für die Testinfrastruktur: parallele Jest-Läufe auf derselben Datenbank erzeugen Fehlalarme (in dieser Prüfung einmal passiert und durch einen sauberen,
seriellen Wiederholungslauf aufgeklärt); der Docker-Worker muss für E2E-Läufe gestoppt werden (`TEC-06`).

## 5. Verifikation

| Ebene | Ergebnis |
|---|---|
| Lint | API, Web, Shared sauber (`--max-warnings 0`) |
| Typprüfung | API, Web, Shared, Domain sauber |
| Unit | API 504, Shared 198, Web 40, agent-core 51, integration-core 32, ui 16, config 13, domain 10 – alle grün |
| API-E2E | **vollständiger serieller Lauf nach allen Änderungen (Worker gestoppt): 49 von 52 Suiten grün, 3 Live-Suiten (echtes Modell) übersprungen; 405 Tests bestanden, 21 übersprungen** |
| Playwright | Organisation (9), UX v2 inkl. Barrierefreiheit und Module, Anmeldung – 92 bestanden, 1 übersprungen (wie zuvor) |
| Docker | API, Worker, Web neu gebaut und gestartet |

**Nicht erneut gelaufen:** die vollständige Playwright-Suite und die Live-Tests mit echtem Modell nach diesen Änderungen (`TEC-10`); die Änderungen berühren dort nur Bundling,
Listenobergrenzen und Abfragen. Der letzte kleine Eingriff (Zähler der Vorgangsübersicht) liegt vor dem vollständigen E2E-Lauf.

## 6. Reproduzieren

```bash
npx knip@5 --no-progress --reporter compact                       # ungenutzter Code und Abhängigkeiten
npx jscpd@4 apps/api/src apps/web/src packages/*/src --min-lines 12 --min-tokens 90 --ignore "**/*.spec.ts,**/dist/**"
docker compose build --progress=plain web                          # Routen-Tabelle mit „First Load JS“
```
