# Meilenstein Ablauf B – Ergebnis (25.10.2026)

Auftrag: ausschließlich Ablauf B (Anfrage mit fehlender Information → Antwort → spätere Korrektur) vollständig fertigstellen. Die vor der Ausführung festgelegten Erwartungen stehen in `docs/MEILENSTEIN_B_2026-10-25.md` (mit den dort in Abschnitt 5 sichtbar gemachten Festlegungen). **Technische Prüfungen und fachliche Abnahme sind hier getrennt ausgewiesen.**

## 1. Ergebnis in Kürze

| | Ergebnis |
|---|---|
| **Technische Prüfungen** | bestanden (Abschnitt 3) |
| **Fachliche Abnahme B1** (Neue Heizung) | **bestanden** – 0 Freigaben, Lead nach Rücklesen ohne „1985“, Bestätigung nach der Korrektur zugestellt |
| **Fachliche Abnahme B2** (Heizkörper Bonn) | **bestanden** – 0 Freigaben, sechs Heizkörper, Kinderzimmer und Flur, Anschrift, offene Angabe sichtbar |
| **Fachliche Abnahme B3** (Bad, Preisfrage) | **bestanden** – Preisfrage aus dem Betriebswissen beantwortet (1 Einzelfreigabe, nur an Tom), 7 m², Anschrift |
| **Ablauf B insgesamt** | **bestanden auf dem geprüften Stand `08f36e3`**, mit den Einschränkungen in Abschnitt 6 |
| **Ablauf C** | bleibt blockiert, nicht weiterentwickelt (Abschnitt 7) |

Bewertet wird der **letzte Durchlauf auf dem geprüften und eingesetzten Stand**. Davor gab es drei Durchläufe, die Mängel aufdeckten; sie sind in Abschnitt 5 aufgeführt und nicht als Bestehen gezählt.

## 2. Was umgesetzt wurde

1. **Einheitlicher Abschlussmaßstab, unabhängig vom Bearbeitungsweg** (`LeadSyncService.completionBlocker`, im Abschluss jedes Vorgangs): ein Vorgang ist nur `COMPLETED`, wenn keine angekündigte Korrektur ungeklärt ist und ein angelegter Lead nachweislich auf dem Stand der Falldaten ist. Dass ein Lead oder eine Aufgabe angelegt wurde, genügt nicht. Offene Anforderungen stehen im Lead als „Noch offen“.
2. **CRM-Aktualisierung** (Fähigkeit des Leads, unter der bestehenden Berechtigung `lead.create`): nur der vom Vorgang angelegte Lead (gespeicherte CRM-Kennung), vor jeder Änderung wird der CRM-Stand gelesen; hat dort jemand von Hand geändert, wird **nichts überschrieben** (`CONFLICT`); nach der Änderung wird **zurückgelesen** (nur dann `SYNCED`); gleicher Inhalt (Hash) wirkt nicht zweimal; Ausfall bleibt sichtbar offen (`FAILED`, Vorgang `MANUAL_REVIEW`) und wird im Sweep wiederholt; eine Aufgabe für einen Menschen ersetzt die Aktualisierung nie. Ereignisse `lead.synced / lead.sync_failed / lead.sync_conflict` und Audit-Einträge. HubSpot: `GET`/`PATCH /crm/v3/objects/deals/{id}` (offizielle Referenz), geschrieben werden nur Name und Beschreibung.
3. **Nachricht nach der Übergabe** (`SupplementService`): Auswertung der Nachricht, Falldaten, Abgleich des Leads, **zutreffende Bestätigung an die Kundschaft** (nennt wörtlich, was übernommen wurde, Zweck `STATUS_UPDATE` unter der Berechtigung für Eingangsbestätigungen; geht erst hinaus, wenn der Lead nachweislich auf dem Stand ist), je Nachricht höchstens einmal.
4. **Zusammenfassung ohne Widerspruch**: „Anliegen“ nennt die Bezeichnung des Vorgangs statt einer Kurzfassung der ersten Nachricht; Ergänzungen sind als solche bezeichnet; Ergänzungen, die nichts Neues sagen, entfallen.
5. **Korrektur von Textwerten** erhält unveränderte Bestandteile („Gasheizung von 1985“ → „Gasheizung von 1995“); Zahlwörter („vier“ → „sechs“); die Korrektur ersetzt den alten Wert auch dort, wo er in anderen Angaben mit steht.
6. **Preisfrage** (Ablauf „Anfrage aufnehmen und übergeben“ **2.1.0**): die Frage wird im Wortlaut festgehalten, aus dem Betriebswissen beantwortet (Auskunft folgt der bestehenden Freigaberegel `email.send.information`) oder – ohne gesicherte Grundlage – im Lead ausdrücklich als offen geführt. Dafür höchstens zwei statt drei Klärungsrunden (Obergrenze von sechs externen Aktionen je Plan unverändert).
7. **Erfragte Angaben werden nicht doppelt erfragt**: freie Zusatzangaben der Kundschaft werden mit wörtlichem Beleg erfasst, zugeordnete Angaben haben Vorrang, eine zweite gezielte Auslese prüft noch fehlende erfragte Angaben einzeln; eine genannte Anschrift (Straße mit Hausnummer) geht nie verloren.
8. **Schattenzähler 61 von 60 – erklärt und behoben.** Aus den Audit-Einträgen: 61 Verbrauchseinträge = 12 nachgetragene (Messung 19.10.) + 34 (21.10.) + 15 (23.10.). Der Zähler stand am 23.10. bei 55; die ersten 5 weiteren Planungen waren zulässig, der **sechste Versuch (21:39) wurde an der Grenze abgelehnt, hatte aber vorher bereits einen Verbrauchseintrag geschrieben** (Reservieren und Prüfen waren zwei Schritte, die Prüfung folgte erst danach). Es liefen also genau 60 Planungen, die 61. war ein abgelehnter Versuch. Behebung: Zählen und Reservieren sind ein atomarer Schritt unter einer Sperre je Mandant, ein abgelehnter Versuch verbraucht nichts (Commit `9313c40`, Tests unit und e2e). Kein Zurücksetzen, keine Erhöhung; während der Abnahme gab es keine weitere Schattenplanung (Ereignis `shadow.plan_refused`, Zähler weiterhin 61).

## 3. Technische Prüfungen (getrennt von der fachlichen Abnahme)

Stand `08f36e3`, eingesetzt auf `api` und `worker` (Migration `20261025120000_lead_crm_sync` zuvor angewandt, Datenbanksicherung vor Beginn).

| Prüfung | Ergebnis |
|---|---|
| Typprüfung und Lint (14 Pakete + Web, 23 Aufgaben) | grün |
| Unit-Tests api | 92 Suiten / 696 Tests grün |
| Unit-Tests shared / integration-core | 348 / 50 grün |
| Gesamtlauf e2e allein im festen Worktree (Heap 6 GB) | **77 Suiten / 616 Tests grün**, 7 Live-Suiten (echtes Modell) im Gesamtlauf nicht enthalten |
| HubSpot-Adapter live (echter Testaccount, `hubspot-live-check.ts`) | Lesen, Ändern, Zurücklesen des Deals, erneutes Schreiben desselben Stands unverändert, Phase/Pipeline unberührt, nicht vorhandener Deal = „nicht gefunden“; Testobjekte vom Skript angelegt und archiviert (`docs/evidence/meilenstein-b-2026-10-25/hubspot-live-check.txt`) |
| Neue e2e-Suite `lead-sync` (9 Tests) | Korrektur und Ergänzung nach Übergabe mit Rücklesen und Bestätigung; dieselbe Nachricht wirkt nur einmal; Handänderung im CRM → Konflikt ohne Überschreiben; CRM-Ausfall → sichtbar offen, später Heilung und nachgeholte Bestätigung; Folgekorrektur; gezielte zweite Auslese; Korrektur vor der Übergabe in der Eingangsbestätigung; Preisfrage beantwortet / offen |

Ein Zwischenlauf des Gesamttests deckte zwei Folgefehler der Änderung auf (Steckbrief `communication.draft`, Erwartung eines FX-20-Tests); beide behoben und im anschließenden Gesamtlauf grün.

## 4. Fachliche Abnahme über Tom und Musterwerk (Stand `08f36e3`)

Alle Nachrichten gingen über Gmail (Tom → Musterwerk, Antworten von Musterwerk → Tom); Empfänger der Kundenrückmeldungen ausschließlich `tomorbit777@gmail.com`; keine Kalenderbuchung; keine Lockerung der Autonomieregeln. Nachweise: `docs/evidence/meilenstein-b-2026-10-25/b1-abnahme.json`, `b2-abnahme.json`, `b3-abnahme.json` (Falldaten mit Verlauf, Lead in ORBIT und **aus HubSpot zurückgelesen**, alle Nachrichten, Aufgaben, Freigaben, Ereignisse).

### B1 – „Neue Heizung – bitte um Angebot“ (Vorgang `4c9b2d30`)
* **Anfrage:** „wir brauchen eine neue Heizung für unser Haus. Bitte schicken Sie uns ein Angebot.“
* **Rückfrage von ORBIT:** (1) welche Heizungsanlage derzeit vorhanden ist (Alter, Zustand), (2) in welchem Ort das Haus steht. Nicht nach dem Angebotswunsch oder anderem bereits Gesagten.
* **Antwort:** „Wärmepumpe. Die vorhandene Heizung ist eine Gasheizung von 1985. Das Haus steht in Köln, Musterstraße 12.“ → **Eingangsbestätigung** zugestellt, Lead angelegt, Vorgang `COMPLETED`.
* **Korrektur:** „Die vorhandene Heizung ist nicht von 1985, sondern von 1995.“
* **Endgültige Falldaten:** Bestehende Heizungsanlage „Gasheizung von 1995“ (Text nicht verkürzt; „1985“ nur im Verlauf), Heizungsalter 1995, Ort Köln, Anschrift „Musterstraße 12“, Wärmepumpe (als Ergänzung zur Leistung geführt).
* **Lead aus HubSpot zurückgelesen:** Deal 531176… `SYNCED`; enthält Bestehende Heizungsanlage: Gasheizung von 1995; Standort Köln; Anschrift Musterstraße 12; Ergänzung: Wärmepumpe; enthält **nicht** „1985“; keine widersprüchliche Zeile.
* **Zugestellte Rückmeldungen:** Rückfrage; Eingangsbestätigung nach der Antwort; Bestätigung nach der Korrektur: „Bestehende Heizungsanlage: Gasheizung von 1995 (korrigiert, bisher: Gasheizung von 1985)“.
* **Abschluss:** `COMPLETED`, Abgleich `SYNCED`. **Menschliche Eingriffe: 0** (keine Freigabe; als Aufgabe nur die Folgeaufgabe „Neuen Lead kontaktieren“).

### B2 – „Heizkörper tauschen in Bonn“ (Vorgang `9e604c99`)
* **Anfrage:** Heizkörper in der Wohnung in Bonn tauschen, Bitte um ein Angebot.
* **Rückfrage von ORBIT:** wie viele Heizkörper getauscht werden sollen.
* **Antwort:** „Es sind vier Heizkörper: Wohnzimmer, Schlafzimmer, Küche und Bad. Die Wohnung ist in der Bahnhofstraße 7 in Bonn.“ → Eingangsbestätigung, Lead, `COMPLETED`.
* **Korrektur:** „nicht vier, sondern sechs Heizkörper – das Kinderzimmer und der Flur kommen dazu.“
* **Endgültige Falldaten:** Anzahl der Heizkörper **sechs** (strukturiert; „vier“ nur im Verlauf), Räume Wohnzimmer, Schlafzimmer, Küche, Bad **und zusätzlich Kinderzimmer und Flur**, Anschrift Bahnhofstraße 7, Bonn.
* **Lead aus HubSpot zurückgelesen:** `SYNCED`; „Anzahl der Heizkörper: sechs“; „Ergänzung … zusätzlich Kinderzimmer und der Flur“; „Ergänzung … sechs Heizkörper (Wohnzimmer, Schlafzimmer, Küche und Bad)“; Bahnhofstraße 7, Bonn; **kein „vier“**.
* **Zugestellte Rückmeldungen:** Rückfrage, Eingangsbestätigung, Bestätigung der Korrektur („Anzahl der Heizkörper: sechs (korrigiert, bisher: vier)“ und der ergänzten Räume).
* **Abschluss:** `COMPLETED`, `SYNCED`, **Menschliche Eingriffe: 0**.

### B3 – „Badezimmer erneuern – was kostet das?“ (Vorgang `e136668d`)
* **Anfrage:** Preisfrage zur kompletten Erneuerung mit ebenerdiger Dusche, ohne Angaben.
* **Rückfrage von ORBIT:** Ort und Größe des Badezimmers.
* **Antwort:** „Das Bad hat 6 m². Wir wohnen im Musterweg 3 in Leverkusen.“ → **Antwort auf die Preisfrage** aus dem Betriebswissen (Entwurf geprüft: nur Aussagen aus Profil und FAQ „Wie läuft ein Angebot ab?“, kein Preis): „Wir schauen uns die Situation vor Ort an und erstellen danach ein schriftliches Angebot. Preise nennen wir nicht vorab …“ – nach **einer** Einzelfreigabe (bestehende Testfreigabe, ausdrücklich benannter Vorgang, nur an Tom). Lead angelegt, `COMPLETED`.
* **Korrektur:** „Das Bad hat nicht 6 m², sondern 7 m².“
* **Endgültige Falldaten:** Größe 7 m² („6 m²“ nur im Verlauf), Ort Leverkusen, Anschrift Musterweg 3, Preisfrage als Angabe geführt.
* **Lead aus HubSpot zurückgelesen:** `SYNCED`; „Größe des Badezimmers: 7 m²“; „Ort der Badsanierung: Leverkusen“; „Anschrift: Musterweg 3“; „Preisfrage der Kundschaft: … – per E-Mail beantwortet.“; **kein „6 m²“**.
* **Zugestellte Rückmeldungen:** Rückfrage; Antwort auf die Preisfrage; Bestätigung der Korrektur („Größe des Badezimmers: 7 m² (korrigiert, bisher: 6 m²)“).
* **Abschluss:** `COMPLETED`, `SYNCED`. **Menschliche Eingriffe: 1** (Freigabe der Auskunft; erwartet, vor der Ausführung festgelegt).

**Gesamt:** 0 Kalenderbuchungen; Kundenrückmeldungen nur an Tom (32 Mails im gesamten Meilenstein inklusive Diagnoselauf, dazu 4 interne Hinweise an das Postfach des Betriebs); Schattenzähler unverändert 61; keine Preise genannt.

## 5. Mängel aus den vorangegangenen Durchläufen (behoben, nicht als Bestehen gezählt)

| Durchlauf | Stand | Befund | Behebung |
|---|---|---|---|
| 1 (Diagnose) | `733e762` | „Wärmepumpe“ fehlte im Lead (Ergänzung blieb Kandidat); Räume Kinderzimmer/Flur fehlten; veraltetes „vier“ in einer Ergänzung; Ort wurde in B3 doppelt erfragt (Zuordnung zu freiem Schlüssel statt zur erfragten Angabe) | Ergänzungen mit Beleg gelten und erscheinen im Lead; Folgekorrektur; Zuordnung zu erlaubten Angaben vor freien Schlüsseln |
| 2 | `04e86f3` | doppelte Rückfrage nach bereits genannter Heizungsart (B1); „1985“ blieb in einer Ergänzung des Leads stehen | gezielte zweite Auslese; Folgekorrektur über das geänderte Wortstück |
| 3 | `cf43535` | Anschrift „Musterstraße 12“ ging in B1 verloren; Korrektur vor der Übergabe (B2) wurde in der Eingangsbestätigung nicht genannt; Preisauskunft in B3 „nicht beantwortbar“ (Frage ohne Kontext); gleichlautende Ergänzungen doppelt | Eingangsbestätigung nennt Korrekturen; Auskunft mit Anfragekontext und Preisregel im Prompt; Ergänzungen einmal; Wortlaut-Erkennung der Anschrift |

## 6. Einschränkungen und Status je Komponente

* **IMPLEMENTED / TESTED LOCALLY:** Konfliktfall (Handänderung im CRM), Ausfall des CRM und spätere Heilung, wiederholte Verarbeitung derselben Nachricht (kein zweiter Versand, kein zweiter Lead) – nur in e2e-Tests mit der persistenten Test-Ablage, **nicht live** wiederholt (Live-Abnahme: der Normalfall mit echtem HubSpot und echtem Postfach).
* **LIVE TESTED:** Lesen/Ändern/Zurücklesen gegen HubSpot (Adapter-Prüfung und Abnahme B1–B3), Zustellung der Rückmeldungen an Tom, Einzelfreigabe der Auskunft.
* **Modellabhängig:** welche Angaben das Modell aus einer Antwort erfasst, bleibt nicht deterministisch. Abgesichert sind Anschrift (Wortlaut-Erkennung), erfragte Angaben (zweite Auslese) und der Abschlussmaßstab (offene Angaben stehen als „noch offen“ im Lead); die Beschriftung einzelner Zeilen kann je Lauf abweichen (z. B. Wärmepumpe als „Ergänzung zu Gewünschte Leistung“ statt als eigene Heizungsart).
* **Preisauskunft** nur, wenn das Betriebswissen sie hergibt (sonst „noch offen“ im Lead, Eingangsbestätigung) und nur nach Einzelfreigabe, solange `email.send.information` freigabepflichtig bleibt.
* **Sichtbarkeit für Menschen:** der Abgleichstand steht im Vorgang (Status, Hinweise, Ereignisse) und im Lead-Datensatz; eine eigene Anzeige in der Web-Oberfläche fehlt noch (offen, `OPEN_DEVELOPMENT_ITEMS.md`).
* **Datenhygiene:** Die Abnahme legte 10 Vorgänge an (Diagnose- und Abnahmedurchläufe); alle sind nach Sicherung ID-genau bereinigt (10 Vorgänge, 10 Leads, 10 Aufgaben, 2 Freigaben), die 10 HubSpot-Testdeals archiviert (Papierkorb, wiederherstellbar), 64 Testnachrichten in Toms Papierkorb. Eingänge und Nachrichten bleiben als Nachweis. Sicherungen: `../orbit-backups/orbit-vor-meilenstein-b-2026-10-25.dump`, `orbit-nach-meilenstein-b-abnahme-2026-10-25.dump` (Stand unmittelbar vor der Bereinigung).

## 7. Ablauf C bleibt blockiert (nicht weiterentwickelt)

Unverändert aus dem Funktionsnachweis (`docs/FUNKTIONSNACHWEIS_2026-10-23.md`, `OPEN_DEVELOPMENT_ITEMS.md` §9): **F-C1** Rückfragen der Teilvorgänge betreffen nicht nur das eigene Anliegen, **F-C2** etwa jeder dritte Teilvorgang fällt aus der Planung (Verdrahtung der Neuplanung), **F-C3** mehrere Eingangsbestätigungen/keine gemeinsame ausgehende Antwort. Fehlender Baustein für C: eine zusammengefasste ausgehende Antwort je Nachricht und eine stabile Neuplanung der Teilvorgänge – eine Produktentscheidung (FN-03/FN-04), die nicht Teil dieses Meilensteins ist.

## 8. Offene Entscheidung / nächster Schritt

Keine Blockade für B. Entscheidungsbedürftig bleibt nur, ob B in einen begleiteten Pilot gehen soll (Vorschlag: ja, mit Freigabepflicht für Auskünfte unverändert und täglicher Sichtung der Vorgänge mit Status `MANUAL_REVIEW`, die jetzt auch Abgleichsfehler und Konflikte zeigen).
