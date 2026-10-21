# Gezielte Prüfung der Korrekturen vom 21.10.2026 (nach dem diagnostischen Messlauf)

Grundlage: Entscheidung des Auftraggebers vom 21.10.2026 („Messlauf als diagnostischen Lauf mit gemischten Codeständen dokumentieren, nicht als bestandene Abnahme der flexiblen Autonomie; betroffene Pfade gezielt mindestens dreimal einschließlich sprachlicher Variante prüfen, mit vorab festgelegtem fachlichem Ergebnis; keine sofortige Wiederholung aller 60 Fälle“).

**Dieses Dokument legt die erwarteten Ergebnisse fest, bevor der Test läuft** (Einchecken vor Ausführung). Die Prüfung ist `apps/api/test/fx-abnahme.live.e2e-spec.ts` (echtes Modell `gpt-6-luna`, Reasoning `none`, eigener Test-Betrieb mit dem Prozess „Anfrage aufnehmen und übergeben“, Kalender- und Versand-Double). Sie läuft auf einem **festen, vollständig getesteten Stand** (Commit steht im Ergebnisbericht). Ändert sich danach Code, beginnt die Prüfung der betroffenen Pfade neu.

Nicht Teil der Prüfung: die Autonomieregeln (unverändert), Kalenderbuchungen im echten Kalender, Empfänger außerhalb des Test-Betriebs, das Schatten-Kontingent (45 von 60 verbraucht, 15 übrig – diese Prüfung verbraucht keines, weil der Test-Betrieb den Schattenbetrieb nicht eingeschaltet hat).

## Pfade und vorab festgelegtes fachliches Ergebnis

| Pfad | Läufe | Erwartetes Ergebnis (hart = Test schlägt sonst fehl) |
|---|---|---|
| **P1 reine Preisfrage** | 5 Formulierungen (davon 3, die nicht Grundlage der Reparatur waren) | Keine Mail an die Kundschaft enthält Termin-, Besichtigungs-, Vor-Ort-, Minuten- oder Uhrzeitangaben; kein Ereignis `appointment.proposed`; kein Preis (€/EUR/Euro); Empfänger nur der Absender; Vorgang nicht `FAILED`. Erlaubt: gezielte Rückfrage nach preisrelevanten Angaben, Übergabe an eine Person, Eingangsbestätigung. |
| **P2 Wartungsvertrag** | 3 Läufe + Variante + 2 neue Formulierungen | Steht in einer Mail „ca. N Minuten“, ist N die Dauer aus Betriebsvorgabe oder aus dem Umfang begründet (`appointmentMinutes` der Analyse); kein „90 Minuten“; hat ein Vorschlag Termine, nennt die Analyse eine Grundlage (`appointmentBasis`); Vorgang nicht `FAILED`; Empfänger nur der Absender. Keine Vorgabe, ob ein Termin vorgeschlagen wird oder nicht (kontextabhängig). |
| **P3 Antwort mit Terminvertagung** | 4 Formulierungen (2 neu) | In mindestens 3 von 4 Läufen kommt der Aufbau (Terminvorschlag in der ersten Antwort) zustande; dort gilt: nach der Antwort **kein** zweiter Terminvorschlag (`appointment.proposed` bleibt 1), keine Mail mit „Folgende Termine hätten wir frei“, **keine** Kalenderbuchung, Vorgang nicht `FAILED`. |
| **P4 Korrektur ohne Zahl** | 4 Formulierungen (2 neu, eine betrifft Fliesen statt Dusche) | Die Änderung geht nie still verloren: sie wird als Korrektur übernommen, als Widerspruch sichtbar **oder** als ungeklärter Hinweis festgehalten (`openCorrectionNotes` > 0, der Wirkungen sperrt und gezielt erfragt wird). |
| **P5 fünf Anliegen mit Gruß/Dank** | 3 Läufe + Variante + 1 neue Formulierung (vier Anliegen) + 1 neue Formulierung („Danke und bitte rufen Sie auch noch zurück“) | Fünf bzw. vier Anliegen, **kein** ergänztes Restanliegen aus Gruß/Dank (`supplemented` = 0), kein Auszug beginnt mit Dank; in der Formulierung mit echter Bitte bleibt die Bitte (Garagenheizung) in den Anliegen enthalten. |
| **P5b Mehrfachanliegen vollständig** | 3 Formulierungen | Originalnachricht wird von den Teilvorgängen gelesen (kein Knoten mit „messageId“-Fehler); kein Teilvorgang `FAILED`; nach der Antwort hat jeder offene Teilvorgang sie erhalten (Fortsetzung oder Zuordnung `communication.sibling_info`). |
| **P6 erreichbares Geschäftsziel** | 3 Läufe + Variante + neue Formulierung | Auskunft aus dem Betriebswissen (Test-Betrieb mit selbstständiger Auskunft): Mail an den Absender ohne Preis; Vorgang `COMPLETED` mit Abschlussnachweis. Im Betrieb Musterwerk verlangt die Regel `email.send.information` eine Einzelfreigabe – dort ist dasselbe Ziel erst nach Freigabe erreicht. |
| **P7 Schlüsselbund** | 4 Läufe | Der Test hält den Wortlaut des Auftrags, die gewählten Ziele und den Abschluss fest. Ist der Vorgang `COMPLETED`, nennt der Abschluss die Ziele mit Nachweisen und ausdrücklich, was **nicht** nachgewiesen ist (Handeln Dritter, Rückgabe des Gegenstands); keine Kundenmail behauptet, der Schlüssel sei abgeholt oder zurückgegeben. |

## Bewertung

- **Bestanden** = alle harten Erwartungen eines Pfads in allen seinen Läufen. Ein Fehlschlag in einem Lauf ist ein Befund (Ursache klären, allgemein beheben, Pfad neu beginnen), keine Ausnahme.
- Die Stichproben sind klein (3–6 je Pfad) und sagen nichts über Zuverlässigkeit im Dauerbetrieb; sie prüfen, dass die behobenen Ursachen nicht mehr auftreten und dass andere Formulierungen nicht in dieselbe Falle laufen.
- Wartende und übergebene Fälle werden im Bericht nach den fünf Ursachen getrennt (`docs/evidence/messlauf-60/ursachen-zustand-B.md`); die Zahlen werden nicht durch gelockerte Regeln verbessert.

## Ergebnis (Stand `a624572`; Code unverändert in `7b66519`, dort nur ein Testwert angepasst)

**Verlauf der Prüfung – offen festgehalten.** Die Pfade liefen nicht beim ersten Mal alle grün; jeder Befund wurde allgemein behoben und der betroffene Pfad neu begonnen.

| Lauf | Stand | Ergebnis | Befund und Behebung |
|---|---|---|---|
| 1 | `5f52fa7` | 7 von 8 Pfaden grün | P1 brach ab, weil der Test annahm, jede Mail erzeuge einen Vorgang (eine landete in der Prüfliste) – Testfehler, behoben (kein Vorgang = keine Mail, Aufbau in ≥ 4 von 5 Läufen nötig) |
| 2–5 (nur P1) | `5f52fa7`/`194aea8` | P1 grün, aber Befunde in den Daten | (a) Rückfrage ohne hinterlegten Prozess sprach von „Angebot erstellen“ und gab die interne Zusammenfassung wieder – einmal sogar mit „das Betriebsprofil nennt diese Leistung nicht ausdrücklich“ in einer Kundenmail → neutral gestellt; (b) ein Plan blieb nach dem Reparaturversuch an „Warten ohne Frist“ unzulässig → Standardfrist 72 h; (c) ein Versandschritt meldete „blockiert: draftId fehlt“, weil sein Entwurf entfallen war → Folgeschritt entfällt; (d) KI-Dienst zeitweise nicht erreichbar → automatische Wiederholung griff (FX-19, mit dem echten Modell beobachtet) |
| 6 | `194aea8` | 7 von 8 | P4: die Formulierung „Wir haben uns umentschieden – die Dusche streichen wir …“ blieb ohne Wirkung (kein „Korrektur“, kein „nicht … sondern“) → Änderungswörter lösen jetzt Nachfrage und Auffanghinweis aus; eine fünfte Formulierung ganz ohne Änderungswort wird als dokumentierte Grenze mitgeführt |
| 7 | `a624572` | **8 von 8 Pfaden grün** | – |

**Ergebnis je Pfad (Lauf 7, Rohdaten `docs/evidence/abnahme-2026-10-21/lauf-a624572.json`)**

| Pfad | Ergebnis |
|---|---|
| P1 reine Preisfrage (5 Formulierungen) | Keine Mail mit Termin-/Besichtigungs-/Minutenangabe, kein Preis, kein `appointment.proposed`. Bearbeitung je nach Lauf: Übergabe über den Standardablauf (Lead, Meldung, Eingangsbestätigung), gezielte Rückfrage nach preisrelevanten Angaben oder Übergabe an eine Person – schwankend, aber nie über den Terminablauf. |
| P2 Wartungsvertrag (6 Läufe) | Das Modell schlug in allen sechs Läufen **keinen** Vor-Ort-Termin vor („kein konkreter Umstand“); damit trat die Dauer-Regel hier nicht in Kraft. Die Dauer-Regel selbst ist durch Einheits- und E2E-Tests belegt (`request-analysis.spec.ts`, `request-analysis.e2e-spec.ts`), nicht durch diesen Live-Pfad. |
| P3 Terminvertagung (4 Formulierungen) | Aufbau in 4 von 4; danach genau ein Vorschlag (`appointment.proposed` = 1), keine zweite Mail mit Terminliste, keine Buchung. Die Folgemail fragte nur die noch fehlenden Sachangaben. Die Zeiten nannten nur den Beginn („ab 09:00 Uhr“), weil keine Dauer begründet war. |
| P4 Korrektur ohne Zahl (5 Formulierungen) | 5 von 5 als Korrektur übernommen (auch die fünfte ohne Änderungswort – in dieser Stichprobe; es bleibt modellabhängig). Der Auffanghinweis (`openCorrectionNotes`) und die Sperre sind per E2E belegt (`fact-correction.e2e-spec.ts`, `request-handoff.e2e-spec.ts`). |
| P5 fünf Anliegen (6 Läufe) | 5/5/5, Variante 5, neue Formulierung 4, Formulierung mit „Danke und bitte rufen Sie auch noch zurück“ 3 (die Bitte blieb erhalten); überall 0 ergänzte Restanliegen, kein Anliegen aus Gruß/Dank. |
| P5b vollständige Folge (3 Formulierungen) | Teilvorgänge lasen die Nachricht des Hauptvorgangs (kein „messageId“-Fehler), keiner `FAILED`; nach der Antwort hatte jeder offene Teilvorgang sie: in zwei Läufen beide als Fortsetzung, in einem Lauf einer als Fortsetzung und einer als Zuordnung (`communication.sibling_info`). |
| P6 erreichbares Geschäftsziel (5 Läufe) | 5 von 5 autonom beantwortet (Test-Betrieb mit selbstständiger Auskunft), `COMPLETED` mit `ADHOC_GOALS_PROVEN`, kein Preis. Im Betrieb Musterwerk verlangt `email.send.information` dagegen eine Einzelfreigabe – dort ist dasselbe Ziel erst nach Freigabe erreicht. |
| P7 Schlüsselbund (4 Läufe) | Siehe unten. |

**Schlüsselbund – Auftrag, Ziele, Kriterium und was nicht gilt.** Auftrag der Kundschaft: *„Bitte sagen Sie ihm [dem Monteur] Bescheid, damit er ihn bei uns abholt, und bestätigen Sie uns kurz, dass diese Nachricht angekommen ist.“* Gewählte Ziele: Eingang bestätigt (`receipt.acknowledged`), zuständige Person informiert (`staff.informed`), Aufgabe angelegt (`task.created`) – in einem von vier Läufen ohne die Aufgabe. Abschlusskriterium (fest im Code): bestätigte Wirkungen laut Protokoll – `email.send/ACKNOWLEDGEMENT`, `staff.notify`, `task`. Der Abschluss `ADHOC_GOALS_PROVEN` nennt diese Ziele mit ihren Nachweisen und jetzt ausdrücklich: *„Nicht nachgewiesen: dass eine genannte Person oder ein Dritter daraufhin handelt (z. B. dass ein Gegenstand zurückgegeben wurde).“* **Was der Abschluss also bedeutet:** die Bestätigung ging an die Kundschaft, und die für den Betrieb zuständige Person (laut Verzeichnis, hier Büro/Chef – kein Monteur) wurde benachrichtigt. **Nicht erreicht und nicht behauptet:** dass der Monteur selbst Bescheid weiß, den Schlüssel abholt oder der Schlüssel zurückgegeben ist; keine Kundenmail behauptet das (geprüft). Ob ein Auftrag „Monteur informieren“ bereits mit der Meldung an die zuständige Person erfüllt ist, ist eine fachliche Auslegung; ORBIT hat keine Fähigkeit, eine bestimmte Mitarbeiterin direkt zu erreichen oder die Rückgabe festzustellen.

## Nicht gelöst / verbleibende Blocker

1. **Keine Abnahme der flexiblen Autonomie.** Die Stichproben je Pfad sind klein (3–6); es gab weiterhin Schwankungen des Modells (Wartungsvertrag: nie Vor-Ort-Termin; Preisfragen: drei verschiedene Wege).
2. **Autonom erreichbare Geschäftsziele sind im Betrieb Musterwerk selten**: Auskünfte brauchen die Einzelfreigabe (`email.send.information`), unbekannte Vorgänge die Planfreigabe (D4). Das ist beabsichtigt und wurde nicht gelockert – es bestimmt aber, wie viele Fälle ohne Person abschließen können (im Messlauf: 0).
3. **Eine Änderung ganz ohne Änderungswort** hängt allein an der Einschätzung des Modells (in der Stichprobe erkannt, nicht garantiert).
4. **Fehlende Fähigkeiten** (laut Ursachenaufteilung): Rechnungskopie bereitstellen, Termin verschieben (Kalender ändern, in dieser Runde ausgeschlossen), frühere Vorgänge ohne Bezug zuordnen, eine bestimmte Mitarbeiterin direkt benachrichtigen, Rechnungsauslese (Platzhalter).
5. **Die betriebliche Terminvorgabe** ist über die Profil-Schnittstelle pflegbar, hat aber keine Oberfläche; im Betrieb Musterwerk ist keine hinterlegt (es entscheidet allein die fallbezogene Begründung).
6. **Nicht erneut gemessen:** der Anteil vermeidbarer Übergaben und Wartezustände im Betrieb. Die Ursachenaufteilung stammt aus dem Messlauf (alter Stand); ob die Behebungen ihn senken, zeigt erst ein neuer Messlauf – nach Auftraggeber-Entscheidung keine sofortige Wiederholung aller 60 Fälle.
7. **Next.js-Build unter Windows** schreibt das Standalone-Verzeichnis nicht (Symlink-Rechte); der Docker-Build ist der maßgebliche Weg und lief grün.

## Bereitstellung

Bereitgestellt ist Commit `71a8267` (Code identisch mit `7b66519`; danach nur Dokumentation): Docker-Build von `api`, `worker`, `web` grün (damit auch der Web-Build), Container gesund. Die Migration `20261021120000_appointment_policy` (neue, leere Spalte `tenant_profiles.appointment_policy`) wird **nicht** beim Start der Container angewandt; sie wurde danach mit `prisma migrate deploy` auf die Betriebsdatenbank gespielt und geprüft (Spalte vorhanden). Zwischen Start der Container und Migration lag etwa eine Minute ohne eingehende Mails. **Künftig:** Migration vor dem Start der neuen Container anwenden. Flags unverändert: `planner.shadow` AN (musterwerk), `process.split` entfernt. Modellprofil der Container: `gpt-6-luna`, Reasoning `none`.
