# Meilenstein C – Ergebnis (26.10.2026)

Auftrag: Nachrichten mit mehreren Anliegen — alle Anliegen erhalten und getrennt bearbeiten, Neuplanung der Teilvorgänge zuverlässig machen (einschließlich FN-09), zusammengehörige Rückfragen und Ergebnisse zu **einer** verständlichen Antwort bündeln; keine neuen Fähigkeiten für Rechnungsversand, Kalenderänderung oder Angebotserstellung. Die vor der Umsetzung festgelegten Kriterien und Erwartungen stehen in `docs/MEILENSTEIN_C_2026-10-26.md` (K1–K5, C1–C3); sie wurden nicht geändert. **Technische Prüfungen und fachliche Abnahme sind getrennt ausgewiesen.**

## 1. Ergebnis in Kürze

| | Ergebnis |
|---|---|
| **Technische Prüfungen** | bestanden auf Stand `ae423fb` (Abschnitt 3) |
| **K1 Zuordnung** | bestanden (C1, C2, C3) – Rückfragen, Aufgaben und Auskünfte nur zum eigenen Anliegen |
| **K2 Neuplanung** | bestanden – in den Läufen auf dem geprüften Stand kein Teilvorgang mit Planungsfehler, FN-09 durch Regressionstest abgesichert |
| **K3 gebündelte Antwort** | bestanden – je Runde genau eine ausgehende Antwort je Familie, eine Eingangsbestätigung, gemeinsame Kundenantwort den Anliegen zugeordnet |
| **K4 Unabhängigkeit** | bestanden – blockierte/übergebene Anliegen hielten die Auskunft zu Frechen und die Rückfragen zum Regler nicht auf |
| **K5 ehrliche Zielerreichung** | bestanden mit Abweichung zu C1 (Abschnitt 4) – kein Teilvorgang wurde als „erledigt“ gemeldet, dessen Ziel eine fehlende Fähigkeit braucht |
| **Meilenstein C insgesamt** | **bestanden auf dem geprüften Stand `ae423fb` im dokumentierten Umfang**, mit den Einschränkungen in Abschnitt 6. Keine Freigabe für unbeaufsichtigten Betrieb, kein Pilot. |

Bewertet wird der **letzte Durchlauf auf dem geprüften und eingesetzten Stand** (Nachweise `abnahme-c1/c2/c3-*.json`). Davor gab es drei Durchläufe und mehrere Diagnoseläufe, die Mängel aufdeckten (Abschnitt 5); sie zählen nicht als Bestehen und sind unter `docs/evidence/meilenstein-c-2026-10-26/diagnose/` gesichert.

## 2. Was umgesetzt wurde

1. **Zuordnung zum Anliegen (K1).** (a) Ein Satz mit Aufzählung („erstens …, zweitens … und drittens …“) wird für den Beleg der Anliegen in seine Teile getrennt; vorher trug jeder Teilvorgang den ganzen Satz und fragte nach den Gegenständen der anderen. (b) Mit `concern-scope.ts` prüft ein deterministischer Maßstab (Überschneidung der Inhaltswörter mit dem eigenen und den fremden Anliegen), ob eine Rückfrage, Aufgabe oder Meldung zum eigenen Anliegen gehört: Fremdes entfällt, Vermischtes wird auf das eigene Anliegen gesetzt (Planer, Anforderungsanalyse). (c) Die Auskunft aus dem Betriebswissen beantwortet in einem Teilvorgang nur dessen Auszug und den gemeinsamen Kontext, nicht die ganze Nachricht. (d) Umgebrochene Sätze und Abkürzungen („Nr.“) sind keine Satzgrenzen.
2. **Zuverlässige Neuplanung (K2, FN-04, FN-09).** Sackgassen und fehlende Abschlüsse eines Planvorschlags werden allgemein geschlossen (`closeDeadEnds`: bevorzugt auf den Neuplanungspunkt, sonst Abschluss); ein überholter Planungsversuch legt keine Aufgabe „Planung nicht möglich“ an (FN-09); ein neuer Vorschlag, der auf Freigabe wartet, löst ältere unfreigegebene Vorschläge ab; **Schritte eines nicht gewählten Zweigs geben die Steuerung nicht weiter** (vorher lief ein Nachfolger eines übersprungenen Schritts trotzdem und legte eine überflüssige Aufgabe an). Alles allgemeine Regeln, nichts formular- oder testsatzspezifisch.
3. **Eine gebündelte Antwort (K3, `FamilyReplyService`).** Die Teilvorgänge halten ihre Entwürfe (Rückfragen, Auskünfte, Eingangsbestätigung) zurück; wenn die Familie ruhig ist, geht **eine** Antwort am Hauptvorgang hinaus, gegliedert nach Anliegen, mit einer einzigen Eingangsbestätigung (nur zur ersten Nachricht) und dem Stand jedes Anliegens (übergeben / wird geprüft / erledigt / „Ihre Angaben haben wir weitergegeben“). Die Freigaberegeln gelten je Inhalt weiter (eine Auskunft bleibt freigabepflichtig und geht nach der Freigabe aus). Das Aktionsregister führt die gebündelte Antwort als eigene Absicht.
4. **Gemeinsame Kundenantwort.** Eine Antwort der Kundschaft auf die gebündelte Mail erreicht alle Teilvorgänge; ihre Sätze werden (über Zeilenumbrüche hinweg) dem Anliegen zugeordnet, zu dem sie gehören, und an dessen offene Aufgabe angehängt. Erst werden alle Teilvorgänge zugeordnet, dann fortgesetzt – sonst kann die Folgeantwort Anliegen auslassen.
5. **Keine neuen Fähigkeiten.** Rechnungsversand, Kalenderänderung und Angebotserstellung wurden nicht gebaut; die Antworten sagen ausdrücklich, dass das Anliegen nicht automatisch erledigt werden kann und an eine Person übergeben ist.

## 3. Technische Prüfungen (getrennt von der fachlichen Abnahme)

Stand `ae423fb` (Code), danach nur Nachweise und Dokumentation (`869e68b`).

| Prüfung | Ergebnis |
|---|---|
| Typprüfung, Lint, Unit-Tests aller Pakete (`turbo run typecheck lint test`) | 32 von 32 Aufgaben erfolgreich |
| Gesamtlauf der e2e-Tests, **allein** im festen Worktree `../orbit-e2e` (eigene Datenbank/Redis) | 78 Suiten bestanden, 7 Suiten übersprungen (Live-Modell), **624 Tests bestanden** |
| Neue/erweiterte Tests dieses Meilensteins | Aufzählungs- und Umbruch-Trennung der Sätze (Shared), Zuordnungsmaßstab, Planreparatur (`closeDeadEnds`), Laufzeitregel „Zweig nicht gewählt“, Familienantwort (8 e2e: Bündelung, Freigabe, Ablehnung, Folgeantwort je Anliegen, Zuordnung, FN-09, Ablösung unfreigegebener Pläne), Aufteilung (12 e2e) |

Technische Beobachtungen: (1) Der erste Gesamtlauf brach nach 71 Suiten mit Speichermangel ab (alle Suiten in einem Prozess); das Skript setzt jetzt 6 GB (`E2E_HEAP_MB`). (2) Der Test „Antwort mit Angaben für mehrere Teilvorgänge“ scheiterte **einmal** im ersten Gesamtlauf und danach in 12 weiteren Läufen nie; die Ursache wurde nicht gefunden (Diagnoseausgabe im Test bei Fehlschlag ergänzt). Als mögliches zeitabhängiges Restrisiko vermerkt. (3) Unit-Tests der API brauchen `npm test` (mit `--experimental-vm-modules`), nicht `npx jest`.

## 4. Fachliche Abnahme auf dem geprüften Stand (Modell `gpt-6-luna`, Tom → Musterwerk, echtes Gmail)

Ablauf je Szenario: eine Nachricht von Tom; die menschlichen Eingriffe sind die bestehenden Testfreigaben (nur an Tom) und einzeln aufgeführt.

**C1 – drei Anliegen** (Nachweis `abnahme-c1-drei-anliegen.json`)

* Drei Teilvorgänge: Rechnungskopie, Terminverschiebung, Reglerangebot. ✔
* **Eine** erste Antwort mit drei Abschnitten; Rückfragen nur im Reglerabschnitt (Ort der Anlage, Lieferung oder auch Einbau); Rechnung und Termin „nicht automatisch erledigbar, an eine Person übergeben“; keine Preise, keine Zusage. ✔
* Gemeinsame Antwort („Zur Rechnung … Zum Termin … Zum Heizungsregler …“): jeder Satz an die Aufgabe seines Anliegens angehängt; **eine** zweite Antwort: „Ihre Angaben dazu haben wir an die zuständige Person weitergegeben“ für Rechnung und Termin, beim Regler nur die noch offene Rückfrage (Einbau), die schon beantwortete (Ort) entfällt. ✔
* Endstand: Rechnung und Termin = Übergabe mit je einer Aufgabe (`MANUAL_REVIEW`), nicht erledigt. **Abweichung von der Erwartung:** das Reglerangebot steht auf `WAITING_FOR_INFORMATION` (eine Rückfrage offen), nicht auf Übergabe; die Erstellung des Angebots bleibt eine fehlende Fähigkeit und würde nach der Antwort an eine Person gehen (in früheren Läufen gezeigt, auf dem Endstand nicht abgewartet). Der Status stimmt mit dem tatsächlichen Stand überein.
* Menschliche Eingriffe: **keine**. Ausgehende Nachrichten: 2 (an Tom).

**C2 – Schlüsselbund und Frechen** (Nachweis `abnahme-c2-schluesselbund-frechen.json`)

* Die Zerlegung ergab hier **drei** Teilvorgänge (Schlüsselbund, Eingangsbestätigung als eigenes Anliegen, Frechen) statt der erwarteten zwei; das Modell hat die Bitte um Bestätigung als eigenes Anliegen gewertet. Das ist von der Anforderung gedeckt (die Bestätigung wurde verlangt) und führt zu keiner Doppelung. ✔
* **Eine** Antwort an Tom: Eingang bestätigt (einmal), Frechen aus dem Betriebswissen („Ja, wir sind auch in Frechen tätig.“), Schlüsselbund wahrheitsgemäß „an eine zuständige Person übergeben“ (kein „Monteur informiert“). ✔
* Endstand: Frechen = `COMPLETED` (Auskunft erteilt), Eingangsbestätigung = `COMPLETED`, Schlüsselbund = Übergabe mit Aufgabe. ✔
* Menschliche Eingriffe: 1 Planfreigabe (Teilvorgang „Eingangsbestätigung“), 1 Einzelfreigabe der Auskunft zu Frechen (`email.send.information`, nur an Tom). Ausgehende Nachrichten: 1.

**C3 – Rechnung doppelt und Termin** (Nachweis `abnahme-c3-rechnung-termin.json`)

* Zwei Teilvorgänge; **eine** Antwort (bisher: keine) mit Eingangsbestätigung und je Anliegen „an eine Person übergeben“ (Rechnung 4711 klären; Termin prüfen), ohne Terminzusage, ohne Buchung. ✔
* Endstand: beide Übergabe mit je einer Aufgabe, nicht erledigt. ✔
* Menschliche Eingriffe: **keine**. Ausgehende Nachrichten: 1.

**Querschnitt:** kein Teilvorgang mit Planungsfehler oder blockiertem Schritt, keine Aufgabe „Planung nicht möglich“, kein ersatzweise wartender zweiter Plan. Pro Familie nie mehr als eine Eingangsbestätigung. Empfänger ausschließlich Tom; keine Kalenderbuchung (kein Buchungsschritt in den Nachweisen); Schattenzähler unverändert 61, keine Schattenplanung; Autonomieregeln unverändert (die Eingänge liefen mit den bestehenden Regeln des Betriebs).

## 5. Mängel, die die Läufe vor dem geprüften Stand aufdeckten (nicht als Bestehen gezählt)

| Lauf | Befund | Behebung |
|---|---|---|
| Diagnose | Ein Satz mit „erstens/zweitens/drittens“ ging an jeden Teilvorgang vollständig; Rechnung und Termin stellten Fragen zum Heizungsregler | Aufzählung wird beim Beleg getrennt |
| Diagnose | Antwort der Kundschaft: Zeilenumbrüche der Mail zerlegten Sätze, die Zuordnung zu Anliegen war lückenhaft | gemeinsame Satzzerlegung mit Umbruchregel |
| Lauf 1 | Folgeantwort nannte ein Anliegen nicht, weil der fortgesetzte Teilvorgang die Antwort auslöste, bevor alle zugeordnet waren | erst alle zuordnen, dann fortsetzen |
| Lauf 1 | Zwei Pläne warteten gleichzeitig auf Freigabe (Neuplanung während der Wartezeit) | neuer Vorschlag löst ältere ab |
| Lauf 2 | Nachfolger eines übersprungenen Schrittes lief trotzdem: überflüssige Aufgabe „Prüfung und Beantwortung der Frage zu Frechen“, Teilvorgang blieb auf Prüfung | Laufzeitregel: nicht gewählter Zweig reicht die Steuerung nicht weiter |
| Lauf 2 | Die Frechen-Auskunft enthielt Aussagen zu Fundsachen und „Eingang kann nicht bestätigt werden“ (ganze Nachricht als Frage) | Auskunft eines Teilvorgangs nur zu dessen Auszug |

## 6. Einschränkungen und offene Punkte

* **Modellabhängigkeit.** Die Zerlegung und die Pläne schwanken zwischen den Läufen (zwei oder drei Teilvorgänge, Rückfrage oder sofortige Übergabe, mit oder ohne Plan-Freigabe). Die Abnahme belegt die Eigenschaften (Zuordnung, Bündelung, Status), nicht ein festes Ergebnis; je Szenario gibt es genau einen gewerteten Durchlauf.
* **Fehlende Fähigkeiten bleiben offen:** Rechnungskopie senden, Termin ändern, Angebot erstellen — alle drei gehen als Aufgabe an eine Person. Eine Übergabe gilt nirgends als erledigt.
* Der Endstand des Reglerangebots (nach der Antwort der Kundschaft) wurde auf dem geprüften Stand nicht abgewartet (Abschnitt 4).
* In einem früheren Lauf schlug das Reglerangebot freie Vor-Ort-Termine vor (bestehende Fähigkeit, keine Buchung, keine Zusage). Das ist erlaubt, sollte aber vor einem Pilot bewusst entschieden werden.
* Die Zuordnung der Kundenantwort ist ein Wortlautmaßstab (Inhaltswörter). Antworten ohne Sachwörter („ja, das passt“) werden keinem Anliegen zugeordnet; die Nachricht bleibt dann am Hauptvorgang lesbar.
* Das Zustandsflag `process.split` war für Musterwerk nur im Testfenster an (07:16–13:10 UTC, `flag-fenster.txt`) und ist **entfernt**.
* Bereinigung: 19 Familien (69 Vorgänge, 42 Aufgaben, 4 Freigaben) ID-genau gelöscht; Nachrichten, Eingänge und Protokoll bleiben als Nachweis; Toms Postfach: 56 Nachrichten in den Papierkorb (`nachrichten-ids.txt`); das Postfach von Musterwerk (`handwerkernull`) wurde nicht angefasst; kein HubSpot-Eintrag betroffen. Sicherung vor der Bereinigung: `backups/orbit-20261026-140637.dump`.
* Tom hat heute 58 von 100 Sendungen verbraucht; die Zustimmung (Google „Testing“) läuft nach 7 Tagen ab.
