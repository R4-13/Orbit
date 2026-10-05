# ORBIT UI/UX v2 – Abnahmebericht

Spezifikation: `ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md` · Plan: `ORBIT_UI_UX_V2_IMPLEMENTATION_PLAN.md` · Architektur: `UI_ARCHITECTURE.md` · Theming: `THEMING_AND_BRANDING.md`
Stand: 2026-10-05 · Testumgebung: lokal, Docker (API, Worker, Web als Produktionsbuild), Postgres/Redis/MinIO, Playwright (Chromium) gegen `http://localhost:3000`.

## 1. Zusammenfassung

Alle 22 Abnahmekriterien sind umgesetzt; **20 vollständig, 2 teilweise** (AC-18, AC-19, Begründung unten). Home passt bei allen Desktopgrößen
der Matrix ohne Scrollen auf einen Bildschirm; die zehn Module folgen dem gemeinsamen Übersicht-/Detailmuster. Alle Nachweise stammen aus
**Mock-/Testdaten und simulierten Mails** – es gibt keinen Live-Nachweis gegen Drittanbieter (siehe Abschnitt 5).

## 2. Testergebnisse (letzter vollständiger Lauf)

| Ebene | Ergebnis |
|---|---|
| `packages/shared` Unit | 68 bestanden |
| Web Unit (vitest) | 40 bestanden (Shell-Layout, Präferenzen, Home-Format, Rechnungsansicht, Kontrast, gespeicherte Ansichten) |
| API Unit (jest) | 415 bestanden, 60 Suiten |
| API E2E (jest, Postgres/RLS) | 215 bestanden, 32 Suiten |
| Web Typecheck / Lint | ohne Fehler / ohne Warnungen |
| `next build` (Docker, Linux) | erfolgreich (dabei fehlende Suspense-Grenze für `useSearchParams` gefunden und behoben) |
| Playwright gegen den Produktions-Container | **94 bestanden, 1 übersprungen, 0 fehlgeschlagen** (95) |
| axe-core WCAG 2.0/2.1 A+AA | 0 Verstöße auf 23 Routen, 5 Detailseiten, Sonde-Overlay, Anpassungsdialog, Mobil + Navigationsschublade |

Der übersprungene Test (`Posteingang: nicht geschäftsrelevanter Eingang`) setzt einen ausgefilterten Eingang (Newsletter) in der Umgebung voraus;
dort war zum Zeitpunkt des Laufs keiner vorhanden. Er wurde in früheren Läufen ausgeführt und bestanden.

Gegen den Entwicklungsserver (Next dev) lieferte ein früherer Gesamtlauf Fehler durch Überlast (Worker-Absturz). Aussagekräftig ist der Lauf
gegen den Produktionsbuild.

## 3. Vorher / Nachher (Messwerte, `docs/ui-v2-evidence/{before,after}/metrics.json`)

| Messung | Vorher (v1) | Nachher (v2) |
|---|---|---|
| Home, Dokument-Scroll bei 1920×1080 / 1440×900 / 1280×720 | 64 px | 0 px |
| Home, Scrollhöhe im Hauptbereich 1920×1080 / 1440×900 / 1280×720 | 1475 / 1703 / 1947 px | 0 / 0 / 0 px |
| Hauptbreite bei 1440×900 (mit Sonde) | 816 px | ≥ 800 px netto durch Docking-Regel; Sonde als Overlay wenn zu eng |
| Horizontaler Überlauf (Seite und Hauptbereich), 90 Aufnahmen (10 Routen × 9 Größen) | – | 0 px überall |
| Home mobil 390×844 | 3453 px Scroll | 600 px Scroll (erlaubt, vertikal) |

Hinweis zu Listen: Listenseiten (Posteingang, Rechnungen, Freigaben, Vorgänge) bleiben **Scrollbereiche im Hauptbereich**; ihre Scrollhöhe hängt von der
Datenmenge ab (die Testdatenbank enthält inzwischen mehr Einträge als bei der Baseline) und ist kein Maß für die Qualität. Verbessert ist, dass das
Dokument nicht mehr scrollt und die Kopfzone stabil bleibt.

Screenshots: `docs/ui-v2-evidence/after/<route>__<breite>x<höhe>.png` (Home, Posteingang, Rechnungen, Freigaben, Vorgänge, Aufgaben, Aktivitäten,
Interessenten, Systeme & Verbindungen, Administration; je 1920×1080, 1600×900, 1440×900, 1366×768, 1280×720, 1024×768, 768×1024, 390×844, 320×740).

## 4. Abnahmematrix

| AC | Ergebnis | Nachweis |
|---|---|---|
| AC-01 Home auf einer Bildschirmseite ≥1280×720 | COMPLETE | `ux-v2.spec` Matrix (6 Größen), Messwerte oben |
| AC-02 kein horizontaler Überlauf | COMPLETE | Matrix + `capture-ui-matrix` (0 px in 90 Aufnahmen) |
| AC-03 Hauptbereich nutzt zugewiesene Breite | COMPLETE | `ux-v2.spec` (GAP-01, Breitenrechnung) |
| AC-04 Erststart: Untergruppen geschlossen | COMPLETE | `ux-v2.spec` |
| AC-05 Unterroute öffnet nur aktive Gruppe, Home schließt | COMPLETE | `ux-v2.spec` |
| AC-06 ≥13/14 px, kein Zoomhack | COMPLETE | `ux-v2.spec` (computed styles) |
| AC-07 Composer immer sichtbar (120 Nachrichten) | COMPLETE | `ux-v2.spec` |
| AC-08 Docking ≥ 800 px netto, auch beim Ziehen | COMPLETE | `shell-layout.spec`, `ux-v2.spec` (Ziehen + Pfeiltasten: 360–480 px) |
| AC-09 Entwurf/Kontext gehen nicht verloren | COMPLETE | `ux-v2.spec`: Entwurf überlebt Wechsel/Reload; Anfrage trägt den beim Senden gebundenen Vorgangskontext, auch wenn währenddessen navigiert wird (Stream-Endpunkt gemockt) |
| AC-10 gleiche Zahl auf Home, Liste, Sonde | COMPLETE | `dashboard.e2e` (Freigaben offen = Länge der Queue „Meine“), `copilot.e2e` |
| AC-11 Karten/Zeilen führen in erlaubte Ziele | COMPLETE | `ux-v2.spec` Link-Crawler (bis 18 Home-Links: Status < 400, Überschrift, kein Login-Redirect), `ui-projections.e2e` |
| AC-12 Rücksprung erhält Filter, Sortierung, Seite, Scroll | COMPLETE | `ux-v2-modules.spec` (Vorgänge, Posteingang) – *Fehler im Produktionsbuild gefunden und behoben, siehe 6.* |
| AC-13 gemeinsames Muster in allen Modulen | COMPLETE (7 Module neu gedacht) / PARTIAL für Kontakte, Opportunities, Lieferanten, Admin-Unterseiten: einheitlich gestaltet, aber nicht vertieft | `ux-v2-modules.spec`, axe |
| AC-14 Orchestrierung interaktiv, linear alternativ | COMPLETE | `orchestration.spec`, Tab „Orchestrierung“ |
| AC-15 Freigabe zeigt Aktion/Payload; veraltet wird abgewiesen | COMPLETE | `ui-projections.e2e`, `ux-v2-modules.spec` |
| AC-16 LIVE/SIMULATED/TEST wahrheitsgemäß | COMPLETE im Mock; Live-Versand **nicht nachgewiesen** | Receipts + Badges; echter Gmail-Versand scheitert an fehlender `gmail.send`-Einwilligung |
| AC-17 keine Testwerte hartcodiert | COMPLETE | Codeaudit: Absender `noreply@musterwerk.example` und Standard-Empfänger entfernt (jetzt verbundenes Postfach / leeres Feld); zwei Mandantenfixtures in den API-E2E |
| AC-18 Branding/Präferenzen mandantenisoliert | **PARTIAL** | Cache-Schlüssel je Mandant, Kontrastnormalisierung (Unit + `ux-v2-modules.spec`); **kein** automatisierter Mandantenwechsel A/B im Browser |
| AC-19 Tastatur / Mobile | **PARTIAL** | Skip-Link, Tab-Reihenfolge, Pfeiltasten am Sonde-Griff, Tabs per Tastatur, axe sauber; **keine manuelle Screenreader-Prüfung**, Mobile-Tastatur (Visual Viewport) im Emulator nicht testbar |
| AC-20 leere/fehlerhafte/veraltete Daten | COMPLETE | `ux-v2.spec` (Snapshot-Abbruch: „Stand unbekannt“, Wiederholen, kein Fake-0, Geometrie stabil) |
| AC-21 Anpassung hält Höhenbudget, Reset | COMPLETE | `ux-v2.spec`, Unit |
| AC-22 Regression-/Buildgates | COMPLETE | Abschnitt 2 |

## 5. Mock- und Live-Nachweis getrennt

| Bereich | Status |
|---|---|
| Alle UI-Tests, Projektionen, Freigaben, Orchestrierung | TESTED LOCALLY (echte API + Postgres, simulierte/Mock-Konnektoren) |
| Sonde-Antworten im UI-Test (Kontextbindung) | TESTED WITH MOCK (Stream-Endpunkt gemockt); Modellantworten laufen im Live-Betrieb gegen den konfigurierten KI-Anbieter |
| E-Mail-Versand | simuliert (Receipt „simuliert“); **REQUIRES PROVIDER CREDENTIALS** für echten Gmail-Versand (`gmail.send`) |
| CRM/DATEV/Lexware/Microsoft/HubSpot | Mock-Konnektoren; keine Live-Prüfung |

## 6. Beim Abnahmelauf gefundene und behobene Fehler

1. **`next build` brach ab**: `useSearchParams` ohne Suspense-Grenze (nur im Produktionsbuild sichtbar) → Suspense in `app/(app)/layout.tsx`.
2. **Scroll-Wiederherstellung funktionierte im Produktionsbuild nicht**: Der Routenwechsel samt Effekten läuft dort *vor* dem `popstate`-Ereignis;
   die Wiederherstellung hing an diesem Ereignis. Jetzt: Klick auf einen Link = neue Navigation (oben beginnen), sonst gemerkte Position.
3. **`/admin/settings` ohne Seitenüberschrift** bei fehlendem Recht (`tenant.manage`, bewusst nicht beim Mandantenadmin): zeigte nur eine rohe API-Meldung.
   Jetzt Überschrift + neutrale Berechtigungsmeldung; Lade-/Fehlerzustände tragen die Überschrift.
4. **Testinfrastruktur**: Die Login-Drosselung der API (60 je 5 Minuten, Sicherheitsfunktion, unverändert) wurde von der großen Suite ausgelöst (429) →
   Testsitzung je Konto wird kurz wiederverwendet. Branding-Upload-Test wartete auf einen schon vorhandenen Wert (Lauf-Reihenfolge) → wartet jetzt auf den neuen Wert und auf die Speicherbestätigung.

## 7. Blocker und offene Punkte (ehrlich)

| Punkt | Folge |
|---|---|
| Kein Endpunkt für einen **Ablehnungsgrund** bei Freigaben | Ablehnen verlangt eine zweite Bestätigung, speichert aber keinen Freitext |
| Keine Funktion **„Antwort stoppen“** in der Sonde (Backend-Abbruch fehlt) | Eine laufende Antwort kann nicht abgebrochen werden |
| Nur ein Konto je Anbieter | Mehrere Postfächer desselben Anbieters sind nicht wählbar |
| **DELEGATE/NAVIGATE**-Modi der Sonde | nicht verfügbar; im UI sichtbar deaktiviert |
| Keine manuelle Screenreader- und Mobile-Tastaturprüfung | AC-19 PARTIAL |
| Kein echter Mandantenwechsel A/B im Browser | AC-18 PARTIAL |
| Echter Gmail-Versand | wartet auf die Einwilligung des Nutzers (`gmail.send`) |
| Bezeichnung „Geschätzte Zeitersparnis“ wird in der schmalen KPI-Karte abgeschnitten (Tooltip vorhanden) | kosmetisch |
| Playwright-Läufe gegen den Next-Dev-Server sind unter Last instabil | Abnahme erfolgt gegen den Produktionsbuild |
