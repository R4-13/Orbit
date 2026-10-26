# Meilenstein Ablauf C – Mehrere Anliegen in einer Nachricht (Stand 2026-10-26)

Auftrag des Auftraggebers (26.10.2026): C entwickeln und auf einem festen, geprüften Stand mit echtem Modell, Tom und Musterwerk nachweisen. B (Stand `08f36e3`) ist im dokumentierten Umfang anerkannt und wird **nicht** erneut durch eine Abnahmeserie geschickt. Keine neuen Fähigkeiten für Rechnungsversand, Kalenderänderungen oder Angebotserstellung; keine Kalenderbuchungen, keine unbeteiligten Empfänger, keine Lockerung der Autonomieregeln, keine weiteren Schattenplanungen (Budget ausgeschöpft, Zähler 61). Dieses Dokument legt **vor der Umsetzung** die Ergebniskriterien fest; sie werden nicht abgeschwächt (Berichtigungen nur sichtbar in Git, mit Begründung). Ergebnis: `docs/MEILENSTEIN_C_ERGEBNIS_2026-10-26.md`.

## 1. Die fünf Ergebniskriterien

**K1 – Richtige Zuordnung.** Jedes Anliegen der Nachricht ist genau ein Teilvorgang; Anliegenliste, Restziele, Aufgaben und Rückfragen eines Teilvorgangs betreffen **nur sein** Anliegen. Gemeinsame Angaben (z. B. eine Anschrift, die für mehrere gilt) dürfen genutzt werden, stehen aber nur bei dem Anliegen, dem sie zugeordnet sind. *Prüfung:* kein Teilvorgang enthält Anliegenliste, Rückfrage oder Aufgabe zum Gegenstand eines Geschwisters (inhaltlich je Szenario unten).

**K2 – Zuverlässige Neuplanung.** Kein Teilvorgang endet in den Läufen wegen eines Planungsfehlers („Planung nicht möglich“, Sackgasse, unbekannter Knoten); ein überholter Planungsversuch legt keine Aufgabe an (FN-09). Die Behebung ist allgemein (Regel für alle Pläne), nicht auf Formular oder Testsatz zugeschnitten. *Prüfung:* Regressionstests der Regeln + in den Läufen kein Teilvorgang mit Planungsfehler.

**K3 – Eine verständliche gebündelte Antwort.** Auf eine Nachricht mit mehreren Anliegen erhält die Kundschaft **eine** ausgehende Antwort je Runde (nicht je Teilvorgang), gegliedert nach Anliegen, mit Rückfragen, Auskünften und dem Stand jedes Anliegens; **keine mehrfachen Eingangsbestätigungen**. Antwortet die Kundschaft gemeinsam, ordnet ORBIT die Angaben den richtigen Anliegen zu und antwortet wieder gebündelt. Die Freigabe-Regeln bleiben je Inhalt bestehen (eine Auskunft bleibt freigabepflichtig).

**K4 – Unabhängigkeit.** Ein blockiertes Teilanliegen (wartet auf Antwort oder Freigabe, Planungsfehler, Übergabe an eine Person) hält ausführbare andere nicht auf: deren Rückfragen, Auskünfte und Ergebnisse gehen in der gebündelten Antwort hinaus.

**K5 – Ehrliche Zielerreichung und Status.** Mit vorhandenen Fähigkeiten erreichbare Ziele werden ausgeführt (Auskunft aus dem Betriebswissen, Hinweis an die zuständige Person, Aufgabe). Fehlende Fähigkeiten (Rechnungskopie senden, Termin ändern, Angebot erstellen) werden ausdrücklich benannt: das Anliegen ist **an eine Person übergeben** (Aufgabe mit Restziel), nicht „erledigt“; die Rückmeldung sagt das so. Der Status jedes Teilvorgangs stimmt damit überein; ein Teilvorgang gilt nur dann als abgeschlossen, wenn sein Ziel erreicht ist oder genau die Übergabe beauftragt war.

## 2. Erwartete Ergebnisse je Szenario (vor der Ausführung festgelegt)

Mandant Musterwerk, Absender Tom, `process.split` nur im Testfenster; Rückmeldungen nur an Tom; keine Kalenderbuchung.

**C1 – drei Anliegen** („erstens eine Kopie meiner letzten Rechnung für die Steuer, zweitens den Wartungstermin vom 28.10. auf den 4.11. verschieben, drittens ein Angebot für einen neuen Heizungsregler“)
* drei Teilvorgänge (Rechnungskopie, Terminverschiebung, Reglerangebot);
* **eine** erste Antwort mit drei Abschnitten, in der keine Rückfrage zu einem anderen Gegenstand als dem des Abschnitts steht (Regler-Fragen nur im Reglerabschnitt); keine Preise, keine Zusage von Terminänderung oder Rechnungsversand;
* gemeinsame Antwort der Kundschaft („Zur Rechnung: … Zum Termin: … Zum Regler: …“) wird den drei Anliegen zugeordnet; danach **eine** zweite gebündelte Antwort mit dem Stand je Anliegen;
* Endstand: Rechnungskopie und Terminverschiebung = Übergabe an eine Person (Aufgabe, Restziel im Wortlaut des Anliegens), Reglerangebot = Übergabe (Angebotserstellung fehlt); Teilvorgänge nicht als „erledigt“ gemeldet, jedes mit eigener Aufgabe; kein Teilvorgang mit Planungsfehler.

**C2 – Schlüsselbund und Frechen** („… sagen Sie ihm Bescheid, dass er ihn abholen kann, und bestätigen Sie mir kurz, dass das angekommen ist. Außerdem: Kommen Sie auch nach Frechen?“)
* zwei Teilvorgänge; **eine** Antwort, die (a) den Eingang der Nachricht bestätigt, (b) die Frage nach Frechen aus dem Betriebswissen beantwortet (eine Einzelfreigabe), (c) zum Schlüsselbund wahrheitsgemäß sagt, dass das Anliegen an eine Person übergeben ist (in Musterwerk gibt es keine Zuständigkeit „Monteur“; es wird nicht behauptet, der Monteur sei informiert);
* Endstand: Frechen = Auskunft erteilt; Schlüsselbund = Übergabe mit offenem Restziel (Aufgabe).

**C3 – Rechnung doppelt und Termin** („Die Rechnung Nr. 4711 habe ich zweimal bekommen, bitte klären Sie das. Und haben Sie bis Freitag noch einen Termin für eine Heizungswartung frei?“)
* zwei Teilvorgänge; **eine** Antwort an Tom (bisher: keine), die für beide Anliegen sagt, dass sie aufgenommen und an eine Person übergeben sind (Rechnung 4711 klären; Termin bis Freitag prüfen), ohne Terminzusage, ohne Buchung;
* Endstand: beide Übergabe mit Aufgabe und Restziel.

## 3. Nachweisverfahren

Fester, geprüfter Stand (Typprüfung, Lint, Unit, Gesamtlauf der e2e-Tests allein im festen Worktree); echtes Modell (`gpt-6-luna`, Denkaufwand `none` wie bisher), Tom → Musterwerk über Gmail; je Szenario ein Durchlauf plus die gemeinsame Antwort; die bestehenden Testfreigaben (Einzelfreigabe für ausdrücklich benannte Testvorgänge, Planfreigaben für frei geplante Teilvorgänge, nur an Tom) bleiben die einzigen menschlichen Eingriffe und werden einzeln ausgewiesen. Technische Tests und Geschäftsergebnisse getrennt. Nachweise (Falldaten, Pläne, Nachrichten, Aufgaben, Freigaben) werden vor der ID-genauen Bereinigung gesichert. Bewertet wird der letzte Durchlauf auf dem geprüften Stand; frühere Durchläufe zählen als Mängelnachweis. C gilt als bestanden, wenn K1–K5 in C1–C3 erfüllt sind.
