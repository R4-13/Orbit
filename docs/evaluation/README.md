# Evaluation der semantischen Triage (Amendment 02 §25.3)

**Katalog:** `fixtures/evaluation/triage-catalogue.json` (16 variierte Eingänge, getrennt vom Code; keine Erkennung am Betreff).
**Lauf:** `apps/api/scripts/run-triage-evaluation.ts` ruft denselben `SemanticTriageService` wie der Eingang und wendet dieselben deterministischen Schwellen an, verändert aber nichts (kein Intake-Event, kein Case, keine Mail).
**Ergebnisse:** `triage-evaluation-2026-10-04.json` (Modell, Prompt-Version, Latenz, Konfidenzen je Fall).

| Lauf | Modell / Prompt | Ergebnis |
|---|---|---|
| 1 | `gpt-6-luna` (`reasoning_effort=none`), `triage-prompt/1`, live | 13/16 |
| 2 | `gpt-6-luna`, `triage-prompt/2`, live | 16/16 |

**Was zwischen den Läufen geändert wurde – und was das für die Aussage heißt**

* E08 (Newsletter mit Rabatt-Angebot) wurde in Lauf 1 als `RELEVANT` bewertet und lief damit in eine Prüfaufgabe (kein Prozess, aber auch nicht ausgeschlossen). Der Prompt wurde um die Regel „Newsletter/Werbung sind NON_BUSINESS, auch wenn sie Preise erwähnen; Kategorie und Relevanz müssen übereinstimmen“ ergänzt (`triage-prompt/2`) → in Lauf 2 `NON_ACTIONABLE`.
* E09 (Gewinnspiel-Spam) und E21 (Phishing) landen in einer **Prüfung**, nicht im Ausschluss: das Risikoflag `PHISHING_SUSPECTED` erzwingt per Design die menschliche Sicht. Die Erwartung im Katalog wurde von „ausgeschlossen“ auf „ausgeschlossen oder Prüfung“ korrigiert (beides sind sichere Ausgänge).
* **Der Katalog wurde nach Lauf 1 am selben Material nachjustiert.** 16/16 ist deshalb **kein unabhängiger Holdout-Wert**, sondern der Nachweis, dass die bekannten Schwächen behoben sind. Eine belastbare Qualitätsaussage braucht einen größeren, nicht zum Tuning verwendeten Katalog.

Nicht abgedeckt: Anhangsinhalt (E21 des Amendments), E03–E05 (Resume/Konflikte laufen über Fakten-/Prozesstests), Mehrmandanten-Varianz, Langzeitstabilität des Modells.
