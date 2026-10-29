# Meilenstein C – Nachbesserung: Ergebnis (29.10.2026)

Auftrag des Auftraggebers nach dem Ergebnisbericht vom 26.10.2026 (`MEILENSTEIN_C_ERGEBNIS_2026-10-26.md`): drei begrenzte Punkte, **keine** neue breite Abnahme, B nicht erneut abnehmen, Testgrenzen unverändert (nur Tom und Musterwerk, keine Kalenderbuchung, keine neuen Fachintegrationen, keine Lockerung der Autonomieregeln, keine zusätzlichen Schattenplanungen), Qualitätstor vollständig beibehalten, Zeitlimits nicht pauschal erhöhen.

## 1. Ergebnis in Kürze

| Punkt | Stand | Nachweis |
|---|---|---|
| **1. Zuordnung der Kundenantwort aus dem Gesprächszusammenhang** (abnahmerelevant) | **umgesetzt und getestet** (Unit, e2e, live) | Abschnitt 2 |
| **2. C1 bis zum vereinbarten Ende** (abnahmerelevant) | **LIVE TESTED** auf dem Stand `f47bfb0`, mit drei benannten Abweichungen | Abschnitt 3 |
| **3. Bündelung und Freigabewarten widerspruchsfrei** | **beschrieben** und durch e2e-Test belegt, keine weitere Live-Serie | Abschnitt 4 |
| **Qualitätstor** | **grün** auf `f47bfb0` im Lauf unter kontrollierten Bedingungen; derselbe Stand scheiterte in einem Lauf bei laufenden Live-Diensten an Zeitüberschreitungen | Abschnitt 5 |
| **Früherer einmaliger Testfehler** (`case-split`, „Antwort mit Angaben für mehrere Teilvorgänge“) | **Ursache gefunden und nachgestellt** (nicht mehr „ungeklärt“) | Abschnitt 6 |
| **Zeitüberschreitungen im Gesamtlauf** | **Ursache nicht abschließend geklärt**; Befunde und Hinweise in Abschnitt 5 | Abschnitt 5 |

Gegliedert nach dem Auftrag („Zuordnungslücke und C1-Endnachweis als abnahmerelevant führen, nicht gemeinsam mit dem Testfehler unter P3“): Punkt 1 und 2 stehen hier als eigene, abnahmerelevante Ergebnisse; der Testfehler und die Zeitüberschreitungen stehen getrennt in den Abschnitten 5 und 6.

## 2. Zuordnung der Kundenantwort (abnahmerelevant)

**Lücke (Stand 26.10.):** Die Zuordnung lief nur über gemeinsame Inhaltswörter. „Bitte beides“ auf „Nur Lieferung oder auch Einbau?“ ließ sich so nicht zuordnen; die Nachricht blieb am Hauptvorgang, die Teilvorgänge warteten unverändert.

**Umsetzung** (`reply-routing.ts`, `reply-routing.service.ts`, `FamilyReplyService.routeReply`, `IntakeService.continueFamily`; Annahme #635 fortgeschrieben in #636):

* Je Satz der Kundenantwort wird bewertet: Überschneidung mit dem eigenen Anliegen, mit den **tatsächlich versendeten Rückfragen** und mit den **offenen Anforderungen** des Teilvorgangs. Hat ein Satz keinen Sachbezug (z. B. „Bitte beides.“), gehört er zum **einzigen** Teilvorgang, der auf eine Antwort wartet und eine Rückfrage gestellt hat (`ONLY_OPEN_QUESTION`). Gemeinsame Angaben gehen an mehrere Teilvorgänge, wenn der Bezug es trägt.
* Optional entscheidet ein Modell (`submit_reply_routing`) **nur eindeutige** Fälle (`certain`); es ist nie nötig und wird beim Mock-Modell übersprungen.
* **Echte Mehrdeutigkeit:** Die Nachricht wird nicht geraten und bleibt nicht liegen; die Kundschaft bekommt in der nächsten gebündelten Antwort **eine** gezielte Zuordnungsfrage (Ereignis `family.assignment_question`, je Nachricht genau einmal). Die Teilvorgänge setzen nicht auf Verdacht fort.
* Nur Teilvorgänge mit zugeordneten Sätzen setzen fort. Die Auslese liest nur diese Sätze samt den gestellten Fragen als Kontext; freie Zusatzangaben und Anschrift sind für zugeordnete Sätze erlaubt.
* Allgemein gelöst, ohne Sonderregel für einzelne Formulierungen.

**Tests:** `reply-routing.spec.ts` (11), `family-reply.e2e-spec.ts` (12, darunter „Bitte beides.“ → einzige offene Rückfrage; mehrdeutige Antwort → eine Rückfrage, nicht doppelt, Klärung wird zugeordnet), `case-split.e2e-spec.ts` (14, darunter „Ja, bitte.“ ohne Bezug → keine Fortsetzung auf Verdacht, eine Zuordnungsfrage für beide Anliegen).

## 3. C1-Endnachweis (abnahmerelevant)

Fester geprüfter Stand `f47bfb0` (gebaut und eingesetzt nach grünem Qualitätstor, Abschnitt 5). Modell `gpt-6-luna`, Tom → Musterwerk, echtes Gmail. Startmarke `musterwerk-start-abnahme5.txt` (29.10.2026 09:04 UTC). Nachweis: `docs/evidence/meilenstein-c-2026-10-26/abnahme-c1-endnachweis-f47bfb0.json` (vor der Bereinigung gesichert). Ein neuer, gezielter Testfall wie vom Auftraggeber verlangt; vorherige Fälle waren bereinigt.

| Schritt der Kette | Befund |
|---|---|
| Aufteilung | Hauptvorgang `4be73b72` mit drei Teilvorgängen (Rechnungskopie, Wartungstermin, Heizungsregler). |
| Erste Antwort | **Eine** gebündelte Mail mit einer Eingangsbestätigung und dem Stand je Anliegen. |
| Rückfrage | Beim Regler fehlten blockierend **Heizungs-/Kesseltyp** sowie **Reglermodell und Umfang (nur Regler oder auch Austausch)**; der Einsatzort wurde ausdrücklich **nicht** erfragt (aus vorhandenen Quellen beschaffbar). Die Rückfrage ging **einmal** in der zweiten gebündelten Mail hinaus; Rechnung und Termin kamen darin nicht vor. Dafür war **eine** Testfreigabe des Plans (Revision 3, nur an Tom) nötig. |
| Natürliche Kurzantwort | „Gas. Der alte Regler ist ein Vaillant VRC 700, und bitte gleich mit Einbau.“ — ohne Wiederholung der Anliegenüberschrift. |
| **Richtige Zuordnung** | Ereignis `family.reply_assigned` am Regler-Teilvorgang: Grundlage `ONLY_OPEN_QUESTION` und `TOPIC`, zugeordnete Sätze „Gas.“ und „Der alte Regler …“. Rechnung und Termin erhielten die Antwort nicht (sie warten auf keine Rückfrage). |
| **Aktuelle Angaben** | Fakten (aktuell, bestätigt): „Angebot für einen neuen Heizungsregler **mit Einbau**“ und „Heizungsregler; alter Regler: **Vaillant VRC 700**“. Die Antwort steht wörtlich in der Aufgabe („Antwort der Kundschaft zu diesem Anliegen (29.10.2026): Gas. …“). **Abweichung 1:** „Gas“ wurde nicht als eigener strukturierter Fakt (Heizungsart) übernommen; nur im Wortlaut der Aufgabe. |
| **Weiterer Bearbeitungsschritt** | Wartezeit erfüllt, Neuplanung, neue Aufgabe „Fachlich prüfen und Angebot für den neuen Heizungsregler mit Einbau erstellen“. |
| **Kundenrückmeldung** | Dritte gebündelte Mail: „Ihre Angaben dazu haben wir an die zuständige Person weitergegeben; sie kümmert sich darum und meldet sich bei Ihnen.“ — keine erneute Rückfrage, keine Wiederholung bereits gesendeter Inhalte. |
| **Endstatus** | Regler-Teilvorgang `MANUAL_REVIEW` mit Aufgabe und **verbleibendem Ziel** („Restziel: technische Eignung und Kosten prüfen und der Kundschaft ein Angebot … mit Einbau zukommen lassen“); Rechnung und Termin `MANUAL_REVIEW` (Übergabe, nicht erledigt); Hauptvorgang `IN_PROGRESS`, „Teilvorgang braucht Prüfung“. Drei Mails an Tom, nie mehr als eine Eingangsbestätigung. |
| Grenzen eingehalten | Empfänger der Kundenmails nur Tom; keine Kalenderbuchung; keine Einzelaktionsfreigabe; keine Schattenplanung (Zähler unverändert 61); kein HubSpot-Eintrag angelegt; eine interne Übersicht „6 neue Vorgänge brauchen Ihre Aufmerksamkeit“ ging an das Postfach des Testbetriebs (`handwerkernull`, bestehende Funktion). |

**Abweichungen und Beobachtungen auf dem geprüften Stand (nicht verschwiegen, nicht behoben):**

1. **„Gas“ nicht strukturiert übernommen** (siehe oben). Folge für den Menschen gering (Wortlaut in der Aufgabe), für spätere Auswertung der Heizungsart aber nicht nutzbar.
2. **Widersprüchliche Kundenkommunikation beim Regler:** Die erste Mail meldete das Reglerangebot als „an eine zuständige Person übergeben“; die zweite fragte dann Angaben dazu ab. Ursache: Plan Revision 2 übergab zunächst, die Neuplanung (Revision 3) fragte danach. Für die Kundschaft nicht ideal.
3. **Doppelte Aufgabe:** Die Übergabeaufgabe aus Revision 2 blieb offen, die neue Aufgabe kam hinzu (zwei Aufgaben am Teilvorgang).
4. **Einleitungssatz der zweiten Mail** begann mit „vielen Dank für Ihre Antwort“, obwohl die Kundschaft noch nicht geantwortet hatte (Textbaustein der Folgeantworten).
5. Der Plan Revision 3 wartete auf Freigabe, während der Teilvorgang bereits `MANUAL_REVIEW` anzeigte (Freigabe ohne sichtbaren Hinweis im Teilvorgang möglich).

Diese fünf Punkte sind in `OPEN_DEVELOPMENT_ITEMS.md` (FN-14) geführt. Keine davon ist ein Fehler der Zuordnung; der Auftrag („richtige Zuordnung → aktuelle Angaben → weiterer Schritt → zutreffende Kundenrückmeldung → korrekter Endstatus und Aufgabe mit verbleibendem Ziel“) ist mit Abweichung 1 bei „aktuelle Angaben“ erfüllt; ob das als bestanden gilt, entscheidet der Auftraggeber.

## 4. Bündelung und Freigabewarten (Punkt 3)

Gelesen aus `FamilyReplyService` (`settle`, `BUSY_WINDOW_MS` = 10 Minuten, `APPROVAL_GRACE_MS` = 30 Minuten, Sweep `activeParents()` im `ProcessSweepService`), `family-reply.e2e-spec.ts` und Annahme #635. Der scheinbare Widerspruch („eine Antwort“ in K3, „Auskunftsteile folgen bei Freigabe gesondert“ in #635, „blockierte Anliegen halten andere nicht auf“ in K4) löst sich so:

1. **Jeder Teilvorgang hält** seine Entwürfe zurück (`family.part_held`). Eine gebündelte Antwort geht erst, wenn kein Teilvorgang mehr arbeitet.
2. **Arbeitet** ein Teilvorgang (`RECEIVED`/`READY`/`IN_PROGRESS`), hält er die Antwort höchstens 10 Minuten seit seiner letzten Änderung zurück; **wartet** er auf eine Freigabe (`WAITING_FOR_APPROVAL`), höchstens 30 Minuten seit seiner letzten Änderung. Danach hält er sie **nicht mehr** auf: Bereits Ausführbares geht hinaus, ohne dass ein weiteres Ereignis nötig ist, denn der Sweep setzt die Antwort zusammen. Der wartende Teil steht darin ehrlich als „wird intern geprüft“.
3. **Wird die Auskunft später freigegeben,** folgt sie als eigene Ergänzung. Die Ergänzung wiederholt weder die Eingangsbestätigung noch bereits versendete Rückfragen; ein weiteres `settle` ohne neuen Inhalt ergibt `NOTHING`.
4. **Fortschreibung von #635 (1):** „Die Auskunftsteile folgen bei Freigabe gesondert“ gilt für Teile, deren Freigabe **nach** der Karenzzeit kommt; kommt sie vorher, ist sie Teil der Bündelung.

**Nachweis:** `family-reply.e2e-spec.ts`, Test „die Wartezeit auf die Freigabe eines Anliegens ist begrenzt …“ (BUSY → Alterung der Änderungszeit → Sweep sendet genau eine Antwort mit Rückfrage und „wird intern geprüft“, genau einmal „eingegangen“ → Freigabe → zweite Mail nur mit der Auskunft → `NOTHING`). Keine weitere Live-Serie.

**Grenze:** Die 30 Minuten rechnen ab der letzten Änderung des wartenden Teilvorgangs. Ob andere Dienste (Erinnerungen/Eskalationen) diese Zeit zurücksetzen, wurde nicht untersucht.

## 5. Qualitätstor und Zeitüberschreitungen

Das vollständige Tor blieb bestehen (kein Einzellauf-Ersatz). Läufe (Belege unter `docs/evidence/meilenstein-c-2026-10-26/tor/`):

| Versuch | Stand | Bedingungen | Ergebnis |
|---|---|---|---|
| 1–2 (26.–27.10., Protokolle nicht in den Nachweisen; Zahlen aus dem Verlauf) | `74499e6` | zwei liegengebliebene Jest-Prozesse aus Vorläufen (je ca. 5 GB, offene Verbindungen zur Test-DB) | 1 bzw. 3 Suiten rot, Zeitüberschreitungen |
| 3 (`gate-versuch3`) | `74499e6` | zwei liegengebliebene Prozesse | **rot**: 6 Suiten, 42 Tests (Zeitüberschreitungen, u. a. ein Argon2-Hash mit 10 s in einer 5-s-Transaktion) |
| Einzelläufe | `74499e6` | je Suite frisch, nichts parallel | alle sechs betroffenen Suiten **grün** (13, 10, 5, 9, 17, 10 Tests) — belegt **keine** Fehlerfreiheit des Gesamtlaufs |
| 4 (`gate-versuch4`) | `381efdf` | kein Altprozess, eigene Test-DB/Redis | 628 Tests grün, **1 rot**: `case-split` (fachlich, Abschnitt 6), keine Zeitüberschreitung |
| 5 (`gate-versuch5`) | `f47bfb0` | kein Altprozess, Live-Dienste liefen | **rot**: 3 Suiten, 6 Tests, alle Zeitüberschreitung (20 s); `case-split` inkl. neuem Test grün |
| 6 (`gate-versuch6`) | `f47bfb0` | wie 5, aber `orbit-worker`, `orbit-api`, `orbit-web` gestoppt | **grün**: 78 Suiten, 630 Tests, 0 Fehler, 28 Minuten (EXIT=0) |

Maßnahmen am Werkzeug (keine Zeitlimits geändert): `scripts/e2e-isolated.sh` bricht ab, wenn schon ein E2E-Jest-Prozess läuft (`e2e-guard.ps1`), und beendet sich selbst (`--forceExit`), damit keine Prozesse liegen bleiben. Das Tor ist damit auf demselben Stand **einmal rot (5) und einmal grün (6)**; beides ist so dokumentiert.

**Gemessene Hinweise (Korrelation, keine Ursachenklärung):**

* Rechner: Intel N150, 4 Kerne, 16 GB; WSL-Docker-VM mit 8 GB; freier Speicher im Lauf zeitweise 116–353 MB, Auslagerungsdatei bis 4 GB; ein Gesamtlauf wächst auf ca. 5 GB, ein Einzellauf bleibt unter 0,7 GB.
* Grundlast **ohne** laufende Orbit-Tests: 59–95 % CPU (Docker-VM ca. 65 % eines Kerns, Chrome, Windows Defender ca. 20 %, ein Python-Prozess einer anderen Claude-Sitzung für Scribenio, Windows Update, die Messung selbst ca. 16 %).
* In Versuch 5 lagen zwei der drei Fehlerfenster in Zeiträumen, in denen die Gesamt-CPU in 67 % bzw. 75 % der Messpunkte ≥ 95 % war; bestandene Suiten hatten 0–50 %. Versuch 6 (Live-Dienste gestoppt): ≥ 95 % in 11 % der Messpunkte (Versuch 5: 33 %), 28 statt 37 Minuten.
* Speicherdruck allein erklärt die Zeitüberschreitungen **nicht** (Versuch 4 lief bei 116 MB freiem Speicher ohne Zeitüberschreitung). Die liegengebliebenen Prozesse allein auch nicht (Versuch 5 ohne sie: Zeitüberschreitungen).
* **Hypothese (nicht bewiesen):** Zeitüberschreitungen treten auf, wenn die Gesamtlast des gemeinsam genutzten Rechners die vier Kerne sättigt; die eigenen Live-Dienste von Orbit tragen dazu bei. **Ursache: ungeklärt.** Ein grüner Lauf unter reduzierter Last ist kein Beweis, dass die Last die Ursache war.
* **Scribenio:** Der Anteil seiner Container ist gemessen (Postgres im Mittel 14–17 % eines Kerns, Spitze 176 %), im Vergleich zur übrigen Last aber nicht der Engpass. Es gibt **keine** Messwerte, die eine Unterbrechung von Scribenio begründen; keine Scribenio-Dienste wurden angefasst oder gestoppt.

Belege: `messwerte-*.csv` (Sampler `messung-sampler.ps1`, alle 15–30 s), `grundlast-ohne-tests-*.txt`, `zeitleiste-gate-versuch5.txt` (Suite-Laufzeiten gegen Messpunkte), `vergleich-gate10-gate11.txt`.

## 6. Früherer einmaliger Testfehler: Ursache gefunden

Der Test „eine Antwort mit Angaben für mehrere Teilvorgänge …“ scheiterte am 26.10. einmal, am 29.10. in Versuch 4 erneut (diesmal mit der eingebauten Diagnoseausgabe). Befund: Beide Teilvorgänge standen auf `MANUAL_REVIEW`, weil im Plan der Neuplanung die Meldung (`staff.notify`) fehlte und damit das Ziel „Zuständige Person informiert“ nicht nachgewiesen war. Ursache: `IntakeService.continueFamily` lud die Teilvorgänge **ohne Sortierung**; die Datenbank liefert Zeilen ohne `ORDER BY` in wechselnder Reihenfolge. Bei vertauschter Reihenfolge setzte der zweite Teilvorgang zuerst fort, bekam die Neuplanung des ersten, und der Planer strich die „fremde“ Meldung (`scopeNodes`, Regel K1).

* **Nachgestellt:** Der neue Test (`case-split.e2e-spec.ts`, „die Teilvorgänge setzen in der Reihenfolge ihrer Anlage fort …“) ändert die Zeilen so, dass eine Abfrage ohne Sortierung die umgekehrte Reihenfolge liefert. **Ohne** Sortierung: rot mit dem Fehlerbild aus dem Gesamtlauf (`MANUAL_REVIEW`/`MANUAL_REVIEW`); **mit** Sortierung: grün (`reihenfolge-test-ohne-sortierung.log`, `…-mit-sortierung.log`).
* **Behebung:** Sortierung nach Anlage und ID an beiden Stellen im Fan-out (`intake.service.ts`).
* **Grenze der Aussage:** Dass das Fehlerbild am 26.10. dieselbe Ursache hatte, folgt aus dem identischen Bild, nicht aus einer Diagnoseausgabe jenes Laufs. In der Produktion spielt die Reihenfolge fachlich keine Rolle (das Modell plant je Teilvorgang aus dessen Anliegen); die Reihenfolge ist jetzt dennoch festgelegt.

## 7. Bereinigung und Rückbau

* Sicherung vor der Bereinigung: `backups/orbit-20261029-101632.dump`; Nachweise (C1-Endnachweis, vier ältere Diagnose-Familien) vorher als JSON gesichert.
* ID-genau gelöscht: 5 Familien, 20 Vorgänge, 17 Aufgaben, 4 Anfragen (Leads); 22 Hinweise beendet; **vier** HubSpot-Testdeals aus den Läufen vom 26.10. entfernt (nachweislich neu durch die Messung angelegt, im HubSpot-Papierkorb wiederherstellbar). Nachrichten, Eingänge, Protokoll bleiben.
* Toms Postfach: 24 Nachrichten (nur ID-genau) in den Papierkorb gelegt.
* `process.split` für Musterwerk **entfernt** (`flag-fenster.txt`, Plattform-Audit).
* Die vorübergehend gestoppten Dienste `orbit-worker`, `orbit-api`, `orbit-web` laufen wieder (geprüfter Stand `f47bfb0`).

## 8. Offene Punkte nach dieser Nachbesserung

Siehe `OPEN_DEVELOPMENT_ITEMS.md`: FN-13 erledigt; **FN-14** Abweichungen 1–5 aus Abschnitt 3 (nicht behoben); **FN-15** ungeklärte Ursache der Zeitüberschreitungen im Gesamtlauf (ein sicheres Grün braucht derzeit reduzierte Last, d. h. gestoppte Live-Dienste). **Keine Freigabe für unbeaufsichtigten Betrieb, kein Pilot.**
