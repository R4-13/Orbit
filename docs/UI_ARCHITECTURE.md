# UI-Architektur (UI/UX v2)

Stand: Umsetzung der `ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md`. Diese Datei beschreibt, **wie** die Oberfläche gebaut ist, damit
sich neue Module ohne Rückfall in Einzellösungen einfügen. Abnahmestatus: `ORBIT_UI_UX_V2_ACCEPTANCE_REPORT.md`.

## 1. Schichten

| Schicht | Ort | Aufgabe |
|---|---|---|
| Projektionsverträge | `packages/shared/src/ui-projections.ts`, `ui-labels.ts` | Typen und reine Funktionen, die API **und** Web gemeinsam nutzen (EntityRef, AttentionItem, DashboardSnapshot, Inbox-/Approval-/Activity-/Case-/Task-/Lead-Projektionen, Sortierung/Deduplizierung, interne Links, Labels). |
| Serverseitige Projektion | `apps/api/src/{dashboard,inbox,approvals,activity,cases,tasks,leads,search}` | Ein autorisierter Abfragedienst je Fachbereich. Home, Listen und Sonde lesen dieselbe Quelle (DATA-01). |
| Layoutvertrag | `apps/web/src/lib/shell-layout.ts` | Reine, getestete Funktionen für Shell-Geometrie. Keine Komponente rechnet Breiten selbst. |
| Zustand | `lib/ui-preferences*.ts(x)`, `lib/hooks/use-persistent-state.ts`, `lib/saved-views.ts`, `lib/sonde-*.tsx` | Präferenzen, Listenzustand, gespeicherte Ansichten, Sonde-Arbeitsbereich. |
| Shell | `components/shell/*` | Header, Navigation, Suche, Sonde-Panel, Skip-Link, Scroll-Wiederherstellung. |
| Bausteine | `components/common/*` | `PageHeader`, `StatusBadge`, `EntityLink` + Vorschau, `FilterTabs`, `EmptyState`, `Notice`, `Modal`, gespeicherte Ansichten. |
| Seiten | `app/(app)/**` | Dünn: laden eine Projektion, setzen Bausteine zusammen. |

## 2. Shell-Geometrie (`shell-layout.ts`)

- Header 56 px. Navigation 208 px (Rail 72 px). Sonde 360–480 px (Standard 384). Außenabstand 16 px, ab breitem Hauptbereich 24 px.
- Die Sonde **dockt nur**, wenn der verbleibende Hauptbereich netto ≥ 800 px bleibt, sonst Overlay. Unter 1024 px wird die Navigation zur Schublade.
- Home arbeitet als *One-Screen*, wenn der Arbeitsbereich ≥ 720×560 px ist; die Zahl sichtbarer Vorschauzeilen folgt der Höhe (2/3/4/5).
- Das Ziehen der Sonde-Breite wird auf 360–480 px und auf die 800-px-Regel geklemmt; Tastatur (Pfeiltasten, 16 px Schritt) ist gleichwertig.

## 3. Navigation

Eine geschlossene Gruppenstruktur (Home, Posteingang, Freigaben, Vorgänge, Aufgaben, Aktivitäten, Finance, Vertrieb, Systeme & Verbindungen,
Administration). Direkte Unterrouten öffnen nur die aktive Gruppe; Home schließt alle. Zähler stammen aus derselben Projektion wie die Zielliste.

## 4. Daten- und Link-Regeln

- `EntityRef { type, id, label, href }` ist die einzige Form für Objektverweise. `href` wird **serverseitig** gebildet (`internalHref`, `caseTabHref`);
  unbekannte oder nicht erlaubte Ziele liefern keinen Link statt eines erfundenen.
- Interne Ziele müssen `isInternalHref` bestehen (kein `//`, keine Schemas).
- Jede Zahl auf Home trägt „Stand“ und Geltungsbereich. Unbekannte Werte erscheinen als „Stand unbekannt“, nie als `0`.
- Rohschlüssel (Kategorien, Risikoflags, Policy-Aktionen) werden über die zentrale Label-Registry (`ui-labels.ts`) angezeigt; Unbekanntes wird
  „Noch nicht zugeordnet“ und nicht roh ausgegeben (`humanizeKnownKeys` bereinigt Freitexte).
- Aufmerksamkeitsliste: `compareAttention` (Dringlichkeit → Fälligkeit → Alter) und `deduplicateAttention` (ein Objekt erscheint einmal).

## 5. Übersicht → Detail → Zurück

- Listenzustand (Filter, Sortierung, Seite, Auswahl) liegt in `usePersistentState` (sessionStorage, nach Route/Mandant/Nutzer geschlüsselt).
- Scrollposition wird beim Klick auf einen Link erfasst und nur bei `popstate` wiederhergestellt (ein DOM-Clamp darf sie nicht überschreiben).
- Vorschau (`EntityPreviewDrawer`) ist von Navigation getrennt: Auge = Vorschau, Titel = Navigation. Fokus geht beim Schließen zurück.
- Vorgangsdetail: Tabs per `?tab=` (Überblick, Orchestrierung, Kommunikation, Dokumente, Verlauf) – teilbar und zurückspulbar.

## 6. Sonde

- Arbeitsbereich-Provider hält Entwurf (localStorage, je Mandant/Nutzer) und **bindet den Kontext beim Absenden**; ein Seitenwechsel während einer laufenden Antwort ändert die Anfrage nicht.
- Modus `ASK | PREPARE | ACT` begrenzt Werkzeuge **serverseitig** (`toolNamesForMode`); Standard ist `ASK`.
- Composer ist fest am unteren Panelrand; nur der Nachrichtenverlauf scrollt.
- Verfügbarkeit (`readiness`) kommt vom Server; ohne Provider erklärt die Sonde das, statt still zu scheitern.

## 7. Freigaben

`ApprovalPresenterService` liefert Queue und Detail mit konkreter Aktion, Empfänger/Payload, Risiko, `stale`-Kennzeichen und den zulässigen
Entscheidungs-Endpunkten. Eine veraltete Freigabe (Payloadversion geändert / bereits entschieden) wird serverseitig abgewiesen und im UI erklärt.

## 8. Barrierefreiheit

- Globaler `:focus-visible`, Skip-Link, Landmarken, `aria-sort` auf `<th>`, Statusanzeigen immer mit Symbol **und** Text, `prefers-reduced-motion`.
- Mindestkontrast: Fließtext `slate-700/900`, Sekundärtext `slate-600` (≥ 4,5:1 auf `#f5f7fb`).
- Automatisiert: `e2e/ux-v2-a11y.spec.ts` (axe-core WCAG 2.0/2.1 A+AA über 23 Routen, Detailseiten, Overlays, Mobile).

## 9. Erweitern – Checkliste für ein neues Modul

1. Projektionstyp in `@orbit/shared` ergänzen, serverseitigen Dienst mit Mandanten-/Rechteprüfung schreiben.
2. Seite mit `PageHeader` (≤ 3 Kennzahlen), `FilterTabs`, Tabelle/Karten, `EmptyState`/`ErrorState` aufbauen.
3. Objektverweise ausschließlich über `EntityRef` + `EntityLink`.
4. Listenzustand über `usePersistentState`.
5. Labels in `ui-labels.ts`, keine Rohschlüssel in der UI.
6. Test in `ux-v2-modules.spec.ts` und Route in `ux-v2-a11y.spec.ts` ergänzen.
