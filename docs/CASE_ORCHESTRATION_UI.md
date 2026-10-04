# Interaktive Case-Orchestrierung (UI und API)

Die Ansicht zeigt, **was bei einem Vorgang passiert ist, was gerade passiert und was geplant ist**, und lässt berechtigte
Personen eingreifen. Der Browser besitzt **keinen eigenen Statusautomaten**: Zustände, Kanten, Beschriftungen und Aktionen
kommen als Projektion aus persistierten Daten.

## Wo

Vorgang öffnen (`/cases/:id`) → Tab **Orchestrierung** (Standard für Vorgänge mit Prozess). Weitere Tabs: *Übersicht & Dokumente*
(E-Mails, Dokumente, Aufgaben, Agent-Läufe) und *Historie* (lückenlose Ereignisliste). Posteingang und Dashboard verlinken über die
Spalte **Orchestrierung** („Orchestrierung ansehen“) direkt dorthin (ersetzt „Zugewiesener Agent“). Der Prozessstatus ersetzt dort
den vereinfachten Status. Bei Vorgängen auf einem Prozess gibt es **keine manuelle Statusänderung** mehr.

## Ebenen und Darstellung

* **Gesamt** (Erledigtes und Geplantes), **Tatsächlich** (nur Ausgeführtes), **Prozessdefinition** (Standardablauf des Blueprints).
* **Graph** (React Flow, schichtweise links→rechts, Zoom/Verschieben, „Zum aktuellen Schritt“, „Alles anzeigen“) oder **Liste**
  (lineare Alternative; unter 768 px Breite der Standard). Beide sind dieselbe Projektion.
* **Planrevision** wählbar; ältere Revisionen sind schreibgeschützt, der Planvergleich (neu/geändert/entfallen/unverändert) wird gezeigt.
* Kanten: durchgezogen = genommen, gestrichelt = möglich, gepunktet = nicht genommen.

## Zustände (Farbe ist nie das einzige Merkmal)

| Zustand | Symbol | Wortlaut |
|---|---|---|
| SUCCEEDED | ✓ | Erledigt |
| RUNNING | ◔ | In Bearbeitung |
| WAITING | ⏳ | Wartet |
| AWAITING_APPROVAL | ✋ | Freigabe erforderlich |
| PLANNED / READY | ○ / ◎ | Geplant / Bereit |
| BLOCKED / FAILED | ⛔ / ✕ | Blockiert / Fehlgeschlagen |
| OUTCOME_UNKNOWN | ? | Ergebnis wird geprüft |
| SKIPPED / SUPERSEDED / CANCELLED | – / ↺ / ⊘ | Nicht erforderlich / Ersetzt / Abgebrochen |

Jeder ausgeführte Schritt trägt **Live** oder **Simuliert** (tatsächliche Ausführung, nicht Konfiguration).

## Knotendetails

Klick/Enter auf einen Schritt: Zustand mit Erklärung, Fähigkeit, **Eingaben mit Herkunft**, **Fakten mit Beleg und Status**
(bestätigt / unbestätigt / widersprüchlich), Ergebnis (technisch einklappbar), Fehler, Warte-Frist, bei Aktionen **Nachweis**
(Receipts mit Beleg-ID und Modus) – und die **Vorschau** dessen, was bestätigt wird: Empfänger, Betreff, Text, Anhang, Positionen und Beträge mit Preisquelle.

## Aktionen (Commands)

Schaltflächen entstehen **ausschließlich aus `availableActions`** der Projektion (berechtigungs- und revisionsabhängig):
Freigeben/Ablehnen einer Aktion · Plan bestätigen/ablehnen · Entwurf bearbeiten · Angabe ergänzen · Schritt wiederholen ·
ungewissen Versand abgleichen · manuellen Schritt abschließen · anhalten/fortsetzen · neu planen · abbrechen.
Jede Aktion ruft `POST /cases/:id/commands` mit `commandId` (Idempotenz) und `expectedCaseRevision`; bei veralteter Ansicht
antwortet der Server `409`, die Ansicht wird aktualisiert und die Aktion nicht angewendet. Tenant und Nutzer kommen nie aus dem Body.

## Live-Aktualisierung

`GET /cases/:id/events/stream?after=<sequence>` (SSE). Die Sequenz ist je Case lückenlos; nach einer Unterbrechung setzt der Client mit der
letzten Sequenz fort, der Server wiedergibt alles Verpasste. Während der Unterbrechung steht „Verbindung unterbrochen – nicht live“.
Ein Stream endet nach 5 Minuten, der Client authentifiziert sich neu und macht nahtlos weiter.

## API

| Endpunkt | Zweck |
|---|---|
| `GET /cases/:id/orchestration?mode=&planRevision=` | Graph-Projektion |
| `GET /cases/:id/orchestration/nodes/:nodeId` | Knotendetails mit Vorschau |
| `GET /cases/:id/events?after=&limit=` | Ereignisliste |
| `GET /cases/:id/events/stream` | SSE mit Cursor |
| `POST /cases/:id/commands` | validierter, idempotenter Command |
| `GET/POST /process-blueprints…` | Prozessdefinitionen (Prozess-Studio) |
| `GET /intake-decisions?view=EXCLUDED`, `/visibility` | Ansicht „Kein Geschäftsprozess ausgelöst“ |

## Barrierefreiheit und Responsivität

Tastaturbedienung für Liste, Schaltflächen und Dialoge (Fokus auf erste Schaltfläche, `Esc` schließt), `aria-label`/`aria-current`/`aria-pressed`,
`role="status"` für den Verbindungsstatus, `role="dialog"` mit `aria-modal`. Der Graph bietet die Liste als gleichwertige Alternative.
Nachweis siehe `IMPLEMENTATION_STATUS.md` (Browser-Prüfung bei 1440×900, 1280×800, 390×844).
