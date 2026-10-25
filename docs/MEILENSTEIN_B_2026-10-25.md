# Meilenstein Ablauf B (Stand 2026-10-25)

Auftrag des Auftraggebers (25.10.2026): **ausschließlich Ablauf B** vollständig fertigstellen – Anfrage mit fehlender Information, Antwort, spätere Korrektur, Abgleich von Falldaten und Lead, zutreffende Rückmeldung, passender Abschlussstatus. Keine weitere breite Testserie, keine Erweiterung von C, keine gemeinsame ausgehende Antwort, keine Kalenderbuchung, keine unbeteiligten Empfänger, keine Lockerung der Autonomieregeln.
Dieses Dokument legt **vor der Ausführung** fest, was je Variante als Ergebnis erwartet wird. Die Kriterien werden während der Prüfung nicht abgeschwächt (Änderungen nur sichtbar in Git, mit Begründung). Das Ergebnis steht in `docs/MEILENSTEIN_B_ERGEBNIS_2026-10-25.md`.

## 1. Abschlussmaßstab (gilt unabhängig vom Bearbeitungsweg)

Ein Vorgang gilt **nicht** allein deshalb als fachlich abgeschlossen, weil ein Lead oder eine Aufgabe erzeugt wurde. Er ist nur dann `COMPLETED`, wenn gleichzeitig
1. keine ungeklärte Korrektur offen ist,
2. ein angelegter Lead mit den aktuellen Falldaten übereinstimmt (Synchronstand `SYNCED`, durch Rücklesen aus dem CRM belegt),
3. offene Anforderungen (nicht erfragte oder nicht beantwortete Angaben) im Lead sichtbar als „noch offen“ stehen.
Andernfalls bleibt er sichtbar offen (`MANUAL_REVIEW` mit Grund). Eine erfolgreiche Aufnahme mit Übergabe ist ein gültiges Ergebnis, wenn genau das beauftragt war. Eine Aufgabe für einen Menschen gilt **nie** als erfolgreiche CRM-Aktualisierung.

## 2. CRM-Aktualisierung (Fähigkeit `crm.lead.update`)

* Nur der **eindeutig zugeordnete** Lead des Vorgangs (gespeicherte CRM-Kennung, vom Vorgang angelegt); kein Anlegen eines zweiten, kein Ändern fremder Objekte. Vor jeder Änderung wird der aktuelle CRM-Stand gelesen: weicht er vom zuletzt von ORBIT geschriebenen Stand ab (jemand hat im CRM bearbeitet), wird **nicht überschrieben** – Zustand `CONFLICT`, sichtbar.
* HubSpot (offizielle API): lesen `GET /crm/v3/objects/deals/{id}`, ändern `PATCH /crm/v3/objects/deals/{id}`, Rücklesen derselben Art; Eigenschaften `description` und `dealname`.
* Protokoll: Ereignis am Vorgang (`lead.synced` / `lead.sync_failed` / `lead.sync_conflict`) mit Kennung, Hash und Rücklese-Ergebnis; Audit-Eintrag.
* Idempotenz: Zusammenfassung wird gehasht; gleiche Nachricht oder gleicher Stand → keine zweite Wirkung.
* Ausfall: Zustand `FAILED` bleibt sichtbar offen (Vorgang nicht `COMPLETED`, Hinweis), Wiederholung im Sweep.

## 3. Erwartete Ergebnisse je Variante

Gemeinsam für alle drei: zugestellte Rückmeldungen gehen nur an Tom; keine Preise; keine Terminzusage ohne Quelle; **0 menschliche Freigaben** erwartet (Rückfragen und Bestätigungen laufen in Musterwerk selbstständig); Abschlussstatus `COMPLETED` mit Synchronstand `SYNCED`; als Aufgabe bleibt nur die Folgeaufgabe des Leads („Neuen Lead kontaktieren“).

### B1 – „Neue Heizung – bitte um Angebot“
* **Anfrage:** „…wir brauchen eine neue Heizung für unser Haus. Bitte schicken Sie uns ein Angebot.“
* **Rückfrage von ORBIT:** fragt gezielt nur nach Wunsch-Heizungsart, Ort/Anschrift, vorhandener Heizung; **nicht** nach „Angebotswunsch“ oder sonst bereits Gesagtem.
* **Antwort der Kundschaft:** „Wärmepumpe. Die vorhandene Heizung ist eine Gasheizung von 1985. Das Haus steht in Köln, Musterstraße 12.“
* **Korrektur:** „…die vorhandene Heizung ist nicht von 1985, sondern von 1995.“
* **Endgültige Falldaten (aktuelle Fassung):** Heizungsart = Wärmepumpe; vorhandene Heizung enthält „Gasheizung“ und „1995“ (der Textwert wird nicht verkürzt), nirgends „1985“ als aktueller Wert; Ort „Köln“, Anschrift „Musterstraße 12“.
* **Lead (aus HubSpot zurückgelesen):** enthält Wärmepumpe, Gasheizung von 1995, Köln, Musterstraße 12; enthält **nicht** „1985“; enthält keine Zeile, die den Angaben widerspricht (kein „… nicht genannt“, wenn genannt).
* **Zugestellte Rückmeldungen:** nach der Antwort eine Eingangsbestätigung mit dem nächsten Schritt (Besichtigung vor Ort, danach schriftliches Angebot; kein Preis); nach der Korrektur eine Bestätigung, die den übernommenen Wert nennt („gaben an …, übernommen: Gasheizung von 1995“).

### B2 – „Heizkörper tauschen in Bonn“
* **Anfrage:** „…in unserer Wohnung in Bonn die Heizkörper tauschen lassen. Bitte um ein Angebot.“
* **Rückfrage/Folgeschritt:** ORBIT erfragt die Anzahl oder schlägt die Besichtigung vor (beides zulässig); es werden keine Termine gebucht.
* **Antwort:** „Es sind vier Heizkörper: Wohnzimmer, Schlafzimmer, Küche und Bad. Die Wohnung ist in der Bahnhofstraße 7 in Bonn.“
* **Korrektur:** „…nicht vier, sondern sechs Heizkörper – das Kinderzimmer und der Flur kommen dazu.“
* **Endgültige Falldaten:** Anzahl der Heizkörper **sechs** (aktuell; „vier“ nicht mehr aktuell) als strukturierte Angabe; Räume enthalten Kinderzimmer und Flur (zusätzlich zu Wohnzimmer, Schlafzimmer, Küche, Bad) oder die Korrektur steht ausdrücklich als offener Punkt im Lead; Anschrift „Bahnhofstraße 7, Bonn“.
* **Lead (zurückgelesen):** enthält sechs/6 Heizkörper und Bahnhofstraße 7; enthält nicht „vier“ als aktuellen Wert.
* **Rückmeldungen:** Eingangsbestätigung bzw. Terminvorschlag nach der Anfrage; nach der Korrektur Bestätigung mit dem neuen Wert.

### B3 – „Badezimmer erneuern – was kostet das?“
* **Anfrage:** Preisfrage zu einer Komplett-Erneuerung mit ebenerdiger Dusche, ohne Angaben.
* **Antwort von ORBIT:** **beantwortet die Preisfrage** aus dem Betriebswissen (Preise nennen wir nicht vorab; Besichtigung vor Ort, danach schriftliches Angebot) – eine bloße Eingangsbestätigung genügt nicht – und nennt, welche Angaben für den Termin helfen (Fläche, Anschrift).
* **Antwort der Kundschaft:** „Das Bad hat 6 m². Wir wohnen im Musterweg 3 in Leverkusen.“
* **Korrektur:** „…nicht 6 m², sondern 7 m².“
* **Endgültige Falldaten:** Fläche „7 m²“ (aktuell, „6 m²“ nicht mehr aktuell), Anschrift „Musterweg 3, Leverkusen“.
* **Lead (zurückgelesen):** enthält 7 m² und Musterweg 3 / Leverkusen; enthält nicht „6 m²“ als aktuellen Wert.
* **Rückmeldungen:** Antwort auf die Preisfrage (s. o); nach den Angaben/Korrektur Bestätigung mit den übernommenen Werten.

## 4. Technische Vorarbeiten (vor der Ausführung geklärt)

1. **Schattenzähler 61 bei Obergrenze 60:** wird anhand der Audit-Einträge erklärt und die Ursache behoben; bis dahin keine weiteren Schattenplanungen; keine Rücksetzung, keine Erhöhung.
2. **Zusammenfassung des Leads** darf den strukturierten Angaben nicht widersprechen; **Korrekturen von Textwerten** erhalten unveränderte Bestandteile.
3. Technische Prüfungen (Typen, Lint, Unit, Gesamtlauf der e2e-Tests allein auf dem festen Stand) **getrennt** von der fachlichen Abnahme (B1–B3 über Tom und Musterwerk) ausweisen. B gilt nur dann als bestanden, wenn alle drei Varianten die oben festgelegten Geschäftsergebnisse erreichen.
