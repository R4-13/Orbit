# ORBIT UI/UX v2 – Umsetzungsplan

Grundlage: `docs/ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md` (ersetzt `ORION_UI_UX_DEVELOPMENT_SPECIFICATION_v1.md`, dort als HISTORISCH markiert).
Ergebnisse: `ORBIT_UI_UX_V2_ACCEPTANCE_REPORT.md`. Entscheidungen: `ASSUMPTIONS.md` #472–#487.

## 1. Priorisierung

| Stufe | Inhalt | Begründung |
|---|---|---|
| UX-0 | Baseline messen (Screenshots + Geometriekennzahlen, 5 Seiten × 4 Größen) | Ohne Ausgangswerte ist „besser“ nicht belegbar. `docs/ui-v2-evidence/before/` |
| P0 | Shell-Geometrie, geschlossene Navigation, Home auf einer Bildschirmseite, Sonde mit festem Composer | Betrifft jede Seite; Home-Scroll (64 px Dokument, 1475–1703 px Main) war der größte Mangel |
| Daten | Serverseitige gemeinsame Projektionen und Label-Registry | Voraussetzung für konsistente Zahlen (DATA-01) und für korrekte Links |
| P1 | Alle zehn Module im gemeinsamen Muster, Freigabe-Detail, Vorgangs-Tabs, Systeme & Verbindungen mit Assistent, Kunden-CI, Präferenzen | Aufbauend auf Projektionen |
| Härtung | Barrierefreiheit (axe), Kontrast, Rückspringen, Tests | AC-19/AC-22 |

## 2. Anforderung → Komponente → Test

Status: COMPLETE / PARTIAL / MISSING / BLOCKED (siehe Abnahmebericht für Belege).

| Bereich (Spec) | Komponente(n) | Lücke vorher | Änderung | Test | Status |
|---|---|---|---|---|---|
| Shell (§§ 6–8) | `shell-layout.ts`, `app-shell`, `app-header` | Hauptbereich 816 px bei 1440, Sonde dockte immer | Layoutvertrag, Docking ab netto 800 px, Rail, Schublade | `shell-layout.spec`, `ux-v2.spec` | COMPLETE |
| Navigation (§ 7) | `navigation.tsx` | offene Untergruppen, Zähler uneinheitlich | geschlossene Gruppen, aktive Gruppe, Zähler aus Projektion | `ux-v2.spec` (AC-04/05) | COMPLETE |
| Home (§§ 9–12) | `dashboard/page`, `home-cards`, `DashboardService` | 1475–1703 px Scroll, widersprüchliche Zahlen | One-Screen, Aufmerksamkeitsliste, Snapshot mit Stand | `ux-v2.spec` Matrix, `dashboard.e2e` | COMPLETE |
| Sonde (§§ 13–15) | `sonde-panel`, `sonde-workspace`, `copilot-runtime` | Composer scrollte weg, Kontext ging verloren, keine Moduswahl | fester Composer, Entwurf persistiert, Kontext beim Senden gebunden, Modus serverseitig | `ux-v2.spec`, `copilot.e2e`, Unit | COMPLETE (Lücken s. Bericht) |
| Links/Vorschau/Zurück (§§ 16–17) | `EntityLink`, `EntityPreviewDrawer`, `usePersistentState`, Scroll-Wiederherstellung | tote Links, Zustandsverlust | `EntityRef` vom Server, getrennte Vorschau, Zustand je Route | `ux-v2-modules.spec` | COMPLETE |
| Module (§ 18) | Posteingang, Freigaben, Vorgänge, Aufgaben, Aktivitäten, Finance, Vertrieb, Systeme, Admin | uneinheitliche Muster | `PageHeader` + `FilterTabs` + Tabelle + Zustände | `ux-v2-modules.spec` | COMPLETE für 7, PARTIAL für Kontakte/Opportunities/Lieferanten/Admin (restyled, nicht neu gedacht) |
| Freigaben (§ 19) | `ApprovalPresenterService`, `approvals/[id]` | kein konkretes Payload, keine Veraltung | Detail mit Aktion/Empfänger/Payload, `stale`-Abweisung | `ui-projections.e2e`, `ux-v2-modules.spec` | COMPLETE |
| Orchestrierung (§ 19a, AC-14) | `cases/[id]?tab=orchestration` | – | unverändert interaktiv, in Tab eingebettet | `orchestration.spec` | COMPLETE |
| Einrichtung (§ 22) | `integrations/page` | Konnektor-Anbindung unklar | Assistent, Trennen-Dialog, „System anfragen“ | `ux-v2-modules.spec` | COMPLETE (DELEGATE/NAVIGATE nicht verfügbar) |
| Branding (§§ 20–21) | `use-tenant-branding`, `theme-contrast`, `admin/branding` | kein Kontrastschutz | Normalisierung, Vorschau, mandantengeschlüsselter Cache | `theme-contrast.spec`, `ux-v2-modules.spec` | PARTIAL (kein echter A/B-Browsertest) |
| Präferenzen (§ 23) | `ui-preferences*`, `home-customize-dialog`, `saved-views` | – | je Mandant+Nutzer, Layoutversion, Reset | Unit + `ux-v2-modules.spec` | COMPLETE |
| Zustände (§ 24, AC-20) | `EmptyState`, `ErrorState`, `LastUpdated`, `Notice` | Fake-Nullwerte | „Stand unbekannt“, stabile Geometrie | `ux-v2.spec` (AC-20) | COMPLETE |
| Barrierefreiheit (§ 25, AC-19) | globale Fokus-/Kontrastregeln, Labels | – | axe-Bereinigung | `ux-v2-a11y.spec` | PARTIAL (manueller Screenreader-Test fehlt) |

## 3. Reihenfolge und Commits

`b72bd92` Snapshot + Label-Registry → `84c7844` Sonde-Modus → `1dfba63` P0 → `f7e7b99` Modul-Projektionen → `2e09ee9` P1 → Härtung/Abnahme (dieser Stand).

## 4. Nicht Teil der Umsetzung (bewusst)

Siehe Abnahmebericht „Blocker und Lücken“: fehlender Ablehnungsgrund-Endpunkt, „Antwort stoppen“, mehrere Konten je Anbieter, manuelle
Screenreader- und Mobil-Tastaturprüfung, Mandanten-A/B im Browser.
