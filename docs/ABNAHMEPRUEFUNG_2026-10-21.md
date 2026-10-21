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
