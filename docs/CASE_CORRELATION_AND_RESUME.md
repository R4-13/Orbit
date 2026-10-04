# Case-Korrelation, Warten und Fortsetzen

## Zuordnung einer Antwort (`CaseCorrelationService`)

Reihenfolge der **starken** Referenzen:

1. bereits gespeicherte Zuordnung dieser Nachricht (idempotent),
2. `In-Reply-To` / `References` auf eine gespeicherte **ausgehende ORBIT-Nachricht** mit Case,
3. Provider-Thread zusammen mit einem **offenen** Case und einem bekannten **Teilnehmer**,
4. (externe Geschäftsreferenzen – dokumentiert, nicht gebaut),
5. semantischer Vorschlag der KI – nur als Prüfhinweis, nie als automatisches Zusammenführen.

Betreff oder Absender allein führen **nie** zusammen. Eine Antwort von jemandem, der kein Teilnehmer des Cases ist, wird nicht
zugeordnet (sonst bekäme eine fremde Partei Einblick); sie läuft als neuer Eingang. Mehrere mögliche Cases → Prüfaufgabe, kein Zusammenführen.
Die Entscheidung je Nachricht steht in `CaseCorrelation` (Regel, Kandidaten, Status).

## Warten und Fortsetzen

* Ein `WAIT_EVENT`-Knoten legt eine **`WaitSubscription`** an (Ereignistyp, Frist) – in PostgreSQL, übersteht Neustarts.
* Eine korrelierte Antwort wird als **eingehendes Case-Event** mit `dedupeKey = inbound:<emailMessageId>` gespeichert (doppelte Zustellung erzeugt kein zweites Ereignis).
* Der Orchestrator verbraucht das Ereignis **genau einmal** (`processedAt` wird atomar gesetzt), erfüllt die Subscription und setzt den Knoten auf `SUCCEEDED`.
  Hat der Knoten Folgekanten, läuft derselbe Plan weiter; endet die Revision am Warteknoten, folgt eine **neue Planrevision** (bereits ausgeführte Schritte werden übernommen, nie wiederholt).
* Die Triage wird bei einer korrelierten Antwort **nicht** wiederholt; Auto-Antworten (Abwesenheit, Zustellbericht) und eigene ausgehende Nachrichten sind vorher ausgeschlossen.
* Fristablauf: der wartende Knoten schlägt sichtbar fehl (`WAIT_TIMEOUT`), der Case geht in `MANUAL_REVIEW`.

## Dauerhaftigkeit

`ProcessSweepService` (Worker, periodisch) findet Cases mit Arbeit ohne Bearbeiter: unverarbeitete Eingangsereignisse (nach Neustart),
überfällige Fristen, verwaiste `IN_PROGRESS`-Cases mit abgelaufener Lease, wiederholbare Schritte. `advance` ist lease-geschützt
(ein Worker je Case) und idempotent; nach Lease-Verlust wird eine bereits gestartete externe Wirkung nie blind erneut ausgeführt (`DISPATCHING`/`OUTCOME_UNKNOWN`).

## Randfälle (E-Szenarien)

Eigene Mail als Eingang (E19) · Auto-Reply (E18) · zwei offene Cases desselben Absenders (E15) · geänderter Betreff ohne Referenz (E16) ·
Antwort eines Fremden mit passender `In-Reply-To` · doppelte Zustellung · Neustart zwischen Speichern und Verarbeiten · Antwort nach Fristablauf –
abgedeckt durch `case-facts-and-correlation`, `process-orchestration` und `reference-process` (E2E).
