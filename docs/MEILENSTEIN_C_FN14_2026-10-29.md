# Meilenstein C – Nachbesserung 2 (FN-14): Ergebnis (29.10.2026)

Auftrag des Auftraggebers nach Anerkennung des Qualitätstors auf `f47bfb0` und des C1-Endzustands: die fünf Konsistenzmängel aus FN-14 **zusammenhängend** beheben, zwei begrenzte Architekturprüfungen, danach gezielte Regressionstests, das vollständige Qualitätstor und **genau einen** C1-Live-Lauf auf dem geprüften Stand. B sowie C2/C3 werden nicht erneut live abgenommen; keine neuen Fachintegrationen, keine Kalenderbuchung, keine Lockerung der Autonomieregeln, keine zusätzlichen Schattenplanungen; FN-15 bleibt ein getrenntes Problem der Testausführung.

> Stand: Code `765355d` (Tor grün, eingesetzt), C1-Live-Lauf einmal durchgeführt und bereinigt. Zusammenfassung in Abschnitt 1a; Einschränkungen des Live-Laufs in Abschnitt 6.

## 1a. Ergebnis in Kürze

| Punkt | Ergebnis |
|---|---|
| FN-14 behoben (Code, Tests) | **Ja**, zusammenhängend (Abschnitt 2); Regressionstests färben sich ohne die Änderung rot (Mutationsnachweis, Abschnitt 4) |
| Architekturprüfung 1 (vertauschte Neuplanungen) | **Test-Double**, nicht produktive Zuordnung (Abschnitt 3.1) |
| Architekturprüfung 2 (setzen Erinnerungen die Frist zurück?) | **Ja** (`updatedAt`); behoben: Frist ab Eintritt in den Stand + Obergrenze 60 Minuten (Abschnitt 3.2) |
| Vollständiges Qualitätstor | **Grün auf `765355d`** im 11. Versuch (79 Suiten, 640 Tests, 27 Minuten); die Versuche davor rot oder abgebrochen (Abschnitt 5) |
| C1-Live-Lauf (genau einer) | bis zum Endzustand durchgeführt und bereinigt, **mit Einschränkung**: der Regler lief diesmal über den Standardablauf, die Planwechsel-Reparaturen wurden live nicht ausgelöst (Abschnitt 6) |
| FN-15 | bleibt offen; neue Beobachtung zur Startbedingung (Abschnitt 5) |

## 1. Ursache: was im C1-Endnachweis wirklich passierte

Aus dem gesicherten Ereignisprotokoll des Regler-Teilvorgangs (`abnahme-c1-endnachweis-f47bfb0.json`, Ereignisse 20–82) ergibt sich **eine** zusammenhängende Ursachenkette, nicht fünf einzelne Fehler:

1. **Der alte Plan lief weiter, während sein Ersatz auf Freigabe wartete.** Plan Rev. 2 (Meldung an die Person, Übergabe als manueller Schritt) rief an seiner Weiterplanen-Stelle die Neuplanung auf. Rev. 3 (Rückfrage an die Kundschaft) enthält eine Wirkung nach außen und wartete deshalb auf die Planbestätigung (`WAITING_FOR_APPROVAL`). Rev. 2 blieb aber der aktive Plan, der Fortschrittsloop führte den manuellen Schritt aus: Aufgabe „Angebotsanforderungen prüfen …“ angelegt, Vorgang `MANUAL_REVIEW`. → Abweichung 5 (Plan wartet auf Freigabe, Vorgang zeigt `MANUAL_REVIEW`) und Abweichung 2 (erste Mail meldete das Anliegen als „übergeben“, die Rückfrage kam erst in der zweiten).
2. **Aufgaben gehörten keiner Arbeit, sondern nur einem Moment.** Mit der Aktivierung von Rev. 3 und später Rev. 4 (dieselbe Arbeit, genauer formuliert) wurde die offene Aufgabe aus Rev. 2 weder übernommen noch geschlossen; der neue manuelle Schritt legte eine zweite an. → Abweichung 3.
3. **Die Auslese der Antwort lief nie für die Antwort.** Der Planer hatte `extract_reply` bereits in Rev. 2 (vor der Antwort der Kundschaft) gesetzt; der Planspeicher übernimmt unveränderte, erledigte Schritte in die nächste Revision. In Rev. 4 stand `extract_reply` daher als „erledigt“ (kept), gelesen wurde die *ursprüngliche* Nachricht, nicht „Gas. Der alte Regler …“. Die Angaben „mit Einbau“ und „Vaillant VRC 700“ stammen aus der Korrekturprüfung beim Eingang, nicht aus der Auslese. → Abweichung 1.
4. **Die Einleitung der gebündelten Antwort war eine Gewohnheit, kein Ereignis.** `familyReplyBody` setzte „vielen Dank für Ihre Antwort“ immer ein, sobald es nicht die erste Mail war – auch bei einer Rückmeldung ohne neuen Eingang. → Abweichung 4.

## 2. Maßnahmen (zusammenhängend, allgemein, ohne Sonderregeln)

| Mangel | Maßnahme | Stelle | Nachweis |
|---|---|---|---|
| Alter Plan übergibt, während Ersatz auf Freigabe wartet (Abw. 2, 5) | Wartet eine **neuere** Planrevision auf Bestätigung, führt der bisherige Plan nur noch verstehende/vorbereitende Schritte aus (wie vor der ersten Planbestätigung); keine Übergabe, keine Aufgabe. Der Vorgang zeigt `WAITING_FOR_APPROVAL` mit Hinweis. Wird der neue Plan abgelehnt, läuft der bisherige weiter (wie bisher). | `OrchestratorService.advanceInContext` | `fn14-consistency`: „wartet eine neuere Planrevision …“ |
| Doppelte/überholte Aufgaben (Abw. 3) | Eine Aufgabe gehört zu einer **Arbeit** (Planstelle), nicht zu einer Revision: `ManualTaskService` — gleiche Arbeit (gleiche Kennung oder gleicher Titel) → offene Aufgabe wird **übernommen** (Titel/Beschreibung aktualisiert, Vermerk der Kundschaft bleibt); entfallene Arbeit → offene Aufgabe `CANCELLED` mit Ereignis; andere Aufgaben bleiben. Verlauf: `task.opened_by_plan`, `task.updated_by_plan`, `task.superseded`. | `manual-task.service.ts`, `OrchestratorService.startManual/activatePlan` | `fn14-consistency`: Übernahme, Schließen, andere bleibt |
| Freigabebedarf nicht sichtbar (Abw. 5) | Jeder Statuswechsel leitet einen offenen Freigabebedarf aus dem tatsächlichen Stand ab (`Freigabe offen: …` zuerst unter den Hinweisen); Ansicht liefert `pendingApprovals`; der Hauptvorgang nennt „Teilvorgang … wartet auf Ihre Freigabe“. | `CaseLifecycleService`, `CaseOrchestrationService`, `rollUpChildren` | `fn14-consistency`, `case-split.spec` |
| „Vielen Dank für Ihre Antwort“ ohne Antwort (Abw. 4) | Einleitung aus Ereignissen: `RECEIPT` (erste Antwort), `REPLY` (nur wenn eine noch unbeantwortete Nachricht der Kundschaft vorliegt), sonst neutral `UPDATE` („hier eine Rückmeldung zu Ihren Anliegen“). | `family-reply-body.ts`, `FamilyReplyService` | `family-reply-body.spec`, `family-reply.e2e` |
| Übergabe, dann doch Rückfrage (Abw. 2) | Nicht verboten, sondern benannt: war das Anliegen als „übergeben/erledigt“ gemeldet und fragt der Teilvorgang nun doch, steht davor „Nach unserer ersten Rückmeldung … doch noch Rückfragen:“. Wartet ein Plan auf Freigabe, gilt das Anliegen als „in Prüfung“, nicht als übergeben. | `FamilyReplyService.stateOf`, Abschnitt `supersedes` | `family-reply.e2e` |
| „Gas“ nicht in den Fakten (Abw. 1) | Ein Schritt, der die jüngste Nachricht liest (`inbound.latestMessageId/-ThreadId`) und wiederholungssicher ist (Auslese, Prüfung, Entwurf), wird in einer Folgerevision **nicht** als erledigt übernommen, wenn seitdem eine neuere Nachricht einging. Die Antwort wird so über die erfragte Angabe (`ai.heating_system_type` o. ä.) gelesen – keine Regel für ein Wort. Wirkungen nach außen werden nie so wiederholt. | `PlanStoreService.createRevision` | `fn14-consistency`: Schritt läuft erneut / Versand nicht; Auslese „Gas.“ → Angabe |

## 3. Zwei begrenzte Architekturprüfungen

**3.1 Vertauschte Neuplanungen: Test-Double oder produktive Zuordnung?** Aus dem Code: Die produktive Planung ist an die Vorgangsidentität gebunden — `PlannerService.plan(tenantId, caseId, …)` bildet den Auftrag aus den Daten genau dieses Vorgangs (Anliegen, Fakten, Nachrichten) und `PlanStoreService.createRevision(tenantId, caseId, …)` speichert das Ergebnis unter dieser `caseId`; der Planer streicht Knoten, die zu einem anderen Anliegen gehören (`scopeNodes`). Die Warteschlange des Test-Doubles (`MockLLMProvider.seedResponse`) dagegen liefert ihre Antworten **in der Reihenfolge der Aufrufe**; vertauschte Zeilenreihenfolge → vertauschte Aufrufreihenfolge → die Neuplanung des ersten Anliegens kam beim zweiten an, wo die Absicherung sie (richtig) als fremd beschnitt. **Die Ursache lag damit im Test-Double, nicht in der Zuordnung.** Belege: neuer Test „Neuplanungen gehören dem Vorgang …“ (`case-split.e2e-spec.ts`) mit einem Modell-Double, das nach dem Anliegen im Auftrag antwortet; Mutationsnachweis `docs/evidence/meilenstein-c-2026-10-26/fn14/mutationsnachweis-reihenfolge.txt`: **ohne** die Sortierung bleibt dieser Test grün, der alte Warteschlangen-Test wird rot. Die Sortierung bleibt als feste, reproduzierbare Reihenfolge; sie muss keine falsche Zuordnung verhindern. Die Aussage im Bericht vom 29.10. (Abschnitt 6, „Fan-out ohne Sortierung“ als Ursache) wird entsprechend präzisiert.

**3.2 Setzen Erinnerungen/andere Änderungen die Bündelungsfrist zurück? — Ja.** `FamilyReplyService.settle` rechnete die 10-/30-Minuten-Fristen ab `Case.updatedAt`. Jede Zeile des Vorgangs wird bei jedem Ereignis (`CaseEventsService.append` erhöht `eventSequence`), jeder Wiederholung der Bearbeitungsfreigabe (Lease), jeder Faktenänderung (`revision`) und jedem Hinweiswechsel beschrieben; damit begann die Frist jedes Mal neu. Behebung: Die Frist läuft ab dem Zeitpunkt, an dem der Teilvorgang seinen **jetzigen Stand erreicht hat** (letztes echtes Statusereignis `from ≠ to`), und es gibt eine **absolute Obergrenze von 60 Minuten**, festgemacht am ältesten noch nicht gesendeten Inhalt (Entwurf oder Zuordnungsfrage; Zeitpunkt der Bereitstellung, `family.part_held` bzw. `family.assignment_question`). Danach hält kein Teilvorgang die Antwort mehr auf, gleich wie oft sich sein Stand ändert. Test: `family-reply.e2e` („Obergrenze … Erinnerungen setzen die Frist nicht zurück“).

## 4. Regressionstests (vor dem Tor)

* `fn14-consistency.e2e-spec.ts` (neu, 6 Tests): Aufgabe übernommen statt verdoppelt (Vermerk der Kundschaft bleibt, Verlauf `task.opened_by_plan` → `task.updated_by_plan`); entfallene Arbeit geschlossen (`task.superseded`), andere Aufgabe bleibt; bisheriger Plan übergibt nichts, solange der Ersatz auf Freigabe wartet (danach gilt der neue Plan); Freigabebedarf in Hinweisen und `pendingApprovals`, danach verschwunden; Schritt, der die jüngste Nachricht liest, läuft neu (Wirkungen nicht); Auslese „Gas.“ → Angabe zur erfragten Heizungsart.
* `family-reply.e2e-spec.ts` (+3): Obergrenze/Fristanker, Einleitung nur nach Antwort, Wechsel „übergeben → Rückfrage“ benannt, „in Prüfung“ bei wartendem Plan. `case-split.e2e-spec.ts` (+1): identitätsgebundenes Modell-Double. Unit: `family-reply-body.spec`, `case-split.spec` (shared).
* **Mutationsnachweis:** vier Verhaltensweisen (Fortschritt halten, Aufgabenübernahme, Freigabehinweis, Neulesen) vorübergehend abgeschaltet → vier Tests rot; Sortierung abgeschaltet → alter Warteschlangen-Test rot, identitätsgebundener Test grün (`fn14/mutationsnachweis-reihenfolge.txt`). Quellen danach wiederhergestellt.
* Vor dem Tor außerdem 17 verwandte e2e-Suiten (167 Tests), `pnpm lint`, `pnpm typecheck`, 721 API-Unit-Tests: grün (Einzelläufe, **kein** Ersatz für das Tor).

## 5. Qualitätstor (Belege unter `docs/evidence/meilenstein-c-2026-10-26/tor/`)

Bedingungen wie dokumentiert: fester Stand im Prüf-Arbeitsbaum, eigene Test-Datenbank und eigener Redis, **kein** paralleler Testlauf, `orbit-worker`/`-api`/`-web` gestoppt, Scribenio unberührt; Zeitlimits unverändert.

| Versuch | Stand | Ergebnis |
|---|---|---|
| 7 (`gate-versuch7-fn14-rot`) | `93c47f0` | **rot**: 20 Suiten, 106 Tests; 1 echter Befund (Erwartung in `case-split` zum Hauptvorgang, behoben in `765355d`), sonst Zeitüberschreitungen, Transaktionsablauf (Argon2 in 5-s-Transaktion) und zeitweise **„Datenbank nicht erreichbar“**; 66 statt 28 Minuten. Basislast danach 90 % CPU (Docker-VM 78 %, Chrome ca. 127 %, Scribenio-Python, Spotify …) |
| 8, 9 | `765355d` | von mir **abgebrochen** (nach 3 bzw. 1 roten Suiten, nur Zeitüberschreitungen); keine Aussage zur Fehlerfreiheit |
| 10 (`…rot-nur-zeitueberschreitungen`) | `765355d` | **rot**: 77 Suiten grün, 2 rot (`process-orchestration`, `process-hardening`), ausschließlich Zeitüberschreitungen/Transaktionsablauf; 35 Minuten |
| **11** (`gate-versuch11-765355d-gruen`) | `765355d` | **grün**: 79 Suiten, 640 Tests, 0 Fehler (58 übersprungen: Live-/Modelltests), 27 Minuten, EXIT=0 |

**Neue, dokumentierte Startbedingung:** Versuch 11 wurde erst gestartet, als die Gesamt-CPU im 90-s-Mittel unter 50 % lag (gemessen 26 %); die Versuche 7–10 liefen bei einer Basislast von 65–90 %. Das ist **Korrelation, kein Beweis** der Ursache: derselbe Stand war bei hoher Last mehrfach rot (außer einem behobenen Testbefund nur Infrastrukturfehler) und bei ruhigem Rechner grün; die im Versuch 10 roten Suiten waren in Einzelläufen grün. FN-15 bleibt offen und getrennt geführt; weitere Lastversuche zur Ursachenklärung wurden nicht gemacht. `--forceExit` ist eine **Absicherung** (der Lauf endet mit „Force exiting Jest“), kein Nachweis sauber geschlossener Ressourcen. **Scribenio:** laufende Dienste des anderen Projekts (Postgres mit 42–52 % eines Kerns in Spitzen, API, Worker, eine aktive Entwicklungssitzung) waren Teil der Last, aber nicht der größte Einzelposten; es gibt weiterhin **keine** Messwerte, die eine Unterbrechung begründen — keine Scribenio-Dienste wurden angefasst.

## 6. C1-Live-Lauf (genau einer) auf dem geprüften Stand `765355d`

Modell `gpt-6-luna`, Tom → Musterwerk, echtes Gmail, `process.split` nur im Testfenster (danach entfernt), keine Kalenderbuchung, keine Einzelaktionsfreigabe, keine Plan-Testfreigabe nötig, Schattenzähler unverändert 61. Nachweis (vor der Bereinigung gesichert): `abnahme-c1-fn14-765355d.json`.

| Kriterium des Auftrags | Befund |
|---|---|
| Aufteilung, eine gemeinsame Antwort | Hauptvorgang + drei Teilvorgänge; **erste Mail** mit einer Eingangsbestätigung: Rechnung und Termin „übergeben“, beim Regler **direkt die Rückfragen** (Heizungsanlage/Regler, Ort, Ersatz oder Neueinbau) — kein widersprüchliches „übergeben“ mit späterer Rückfrage |
| Antwort 1 („Gas. Der alte Regler ist ein Vaillant VRC 700, und bitte gleich mit Einbau.“) | Zuordnung zum Regler; Fakten: `ai.controller_context` = „Gas. Der alte Regler ist …“ (Antwort auf die kombinierte Frage nach Anlage **und** Regler), `ai.scope`, Ergänzungen „mit Einbau“ und „Vaillant VRC 700“. **Zweite Mail**: „Vielen Dank für Ihre Antwort“ (jetzt zutreffend) und **nur die noch offene** Frage (Ort), keine Wiederholung |
| Antwort 2 („Die Anlage steht in Köln.“) | Fakt `ai.location` = „Köln“; **dritte Mail**: „… Ihre Angaben dazu haben wir an die zuständige Person weitergegeben“ |
| Aufgaben | je Teilvorgang genau **eine** offene Aufgabe (Regler: „Neuen Lead kontaktieren: Tom Orbit“ mit den Angaben); keine überholte Doppelung |
| Endstatus | Regler `COMPLETED` (Übergabe über den hinterlegten Ablauf: Lead im CRM abgeglichen `SYNCED`, offene Aufgabe für die Person); Rechnung und Termin `MANUAL_REVIEW` mit Aufgabe; Hauptvorgang `IN_PROGRESS` mit Hinweisen „Teilvorgang … braucht Prüfung“. Drei Mails an Tom, eine Eingangsbestätigung |
| Freigabebedarf sichtbar | **im Live-Lauf nicht ausgelöst** (keine Plan- oder Aktionsfreigabe nötig); nur durch e2e-Tests belegt |

**Einschränkungen (nicht verschwiegen):**

1. **Anderer Weg als am 29.10.:** Die Eignungsprüfung ordnete das Reglerangebot diesmal dem hinterlegten Standardablauf zu (Modellvarianz, `fits=true`), nicht dem frei geplanten Pfad mit Planwechsel. Die Reparaturen für Planwechsel (haltender Plan, Aufgabenübernahme, Freigabehinweis) und das Neulesen der Antwort über einen übernommenen Schritt liefen deshalb **nicht** im Live-Lauf; sie sind durch die e2e-Tests und den Mutationsnachweis belegt, nicht live. Der Auftrag erlaubt genau einen Live-Lauf; ein zweiter wurde nicht gemacht. Ob das für die fachliche Abnahme genügt, entscheidet der Auftraggeber.
2. **„Gas“** steht als Teil der wörtlichen Antwort im Fakt `ai.controller_context`, **nicht** als eigener Fakt „Heizungsart = Gas“ (das Modell ordnete die Antwort auf die kombinierte Frage dem kombinierten Schlüssel zu). In Falldaten, Lead und Aufgabe ist sie enthalten; eine getrennte Auswertung der Heizungsart wäre eine Verbesserung (FN-16).
3. Die Hinweiszeile des Hauptvorgangs nennt weiterhin „Teilvorgang … braucht Prüfung“ für die übergebenen Anliegen (Rechnung, Termin); der Regler-Teilvorgang zeigt `COMPLETED` mit offener Aufgabe (so ist der hinterlegte Ablauf seit Meilenstein B abgenommen).

Bereinigung ID-genau nach Sicherung (`backups/orbit-20261029-211157.dump`): 4 Vorgänge, 3 Aufgaben, 1 Anfrage (Lead), HubSpot-Deal 533807077623 (nachweislich durch den Lauf angelegt, im HubSpot-Papierkorb), 6 Mails in Toms Papierkorb (nur die benannten Nachrichten), `process.split` entfernt; Eingänge, Nachrichten und Protokoll bleiben als Nachweis.

## 7. Offene Punkte nach dieser Nachbesserung

* **FN-14: umgesetzt und getestet; im Live-Lauf teilweise belegt** (Abschnitt 6, Einschränkung 1).
* **FN-15** (Zeitüberschreitungen bei hoher Rechnerlast) offen; „ruhiger Rechner“ als Startbedingung des Tors ergänzt.
* **FN-16** (Verbesserungswunsch, getrennt geführt): erfragte kombinierte Angaben in einzelne Fakten zerlegen (z. B. Heizungsart); Hinweise des Hauptvorgangs für übergebene Anliegen differenzieren.
* **Keine Freigabe für unbeaufsichtigten Betrieb, kein Pilot.**
