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

---

# Systematische Bewertung mit versiegeltem Prüfsatz (BPF-05, Oktober 2026)

Die obige Messung vom 04.10. war ein Stichprobenlauf am selben Material, an dem der Prompt nachgebessert wurde. Seit BPF-05 gibt es ein wiederholbares Verfahren.

## Zwei Sätze mit klarer Regel

| Satz | Datei | Zweck | Darf zum Verbessern der Anweisung dienen? |
|---|---|---|---|
| dev | `fixtures/evaluation/triage-catalogue.json` (16 Fälle) | Entwickeln und Nachjustieren | ja |
| holdout-v1 | `fixtures/evaluation/triage-holdout-v1.json` (40 Fälle H01–H40) | unabhängige Messung | **nein** |

Der Prüfsatz ist durch eine Prüfsumme (`triage-holdout-v1.sha256`) versiegelt; ein Unit-Test und der Lauf melden jede Änderung. Wird eine Anweisung anhand des Prüfsatzes verbessert, ist er verbraucht und es muss ein neuer Satz (holdout-v2) angelegt werden. Beide Sätze sind überschneidungsfrei (Test). Der Prüfsatz deckt unter anderem ab: eindeutige und grenzwertige Notfälle, „DRINGEND“-Fehlalarme, Werbung/Spam/Phishing, Fortsetzungen, mehrere Anliegen, Einschleusungsversuche, andere Sprachen (en/tr/pl), Bewerbungen, Rechnungen, Lieferantenangebote.

## Kennzahlen und Gütekriterien

Erwartungen sind bewusst nach Wirkung formuliert (z. B. „Notfall“, „hoch oder kritisch“, „Geschäft oder Prüfung“, nie „ausgeschlossen“). Kennzahlen: Trefferquote, Genauigkeit je Merkmal (Relevanz, Kategorie, Dringlichkeit, Bezug), **Notfälle erkannt**, **Fehlalarme**, **zu Unrecht ausgeschlossene Kundennachrichten**, **Konsistenz** über Wiederholungen (gleiche Kategorie, Relevanz und Dringlichkeit), **Konsistenz des Wegs** (nur Prozessgruppe, Relevanz, Notfall ja/nein – zur Information) und Antwortzeit p50/p95. Gütekriterien in `fixtures/evaluation/thresholds.json`: Trefferquote ≥ 80 %, Notfälle ≥ 90 %, Fehlalarme ≤ 10 %, zu Unrecht ausgeschlossen ≤ 5 %, Konsistenz ≥ 85 %, keine Läufe ohne Ergebnis. `--baseline` meldet jede Verschlechterung um mehr als 5 Prozentpunkte.

## Lauf

```bash
set -a && source .env && source .env.llm.local && set +a
pnpm --filter @orbit/api exec ts-node scripts/run-ai-evaluation.ts --set holdout --repeats 3 --out bericht.json [--baseline frueher.json] [--no-fail]
```

Der Lauf legt einen Wegwerf-Betrieb mit Beispielprofil an, ruft den echten `SemanticTriageService` auf und löscht den Betrieb danach. Exitcode 2 bei verfehltem Gütekriterium oder Verschlechterung.

## Ergebnisse (holdout-v1, 40 Fälle × 3 Wiederholungen, `gpt-6-luna`, `triage-prompt/4`, live)

| Kennzahl | Lauf 1: Standard-Temperatur | Lauf 2: Temperatur 0 | Kriterium |
|---|---|---|---|
| Trefferquote | 93,3 % | **97,5 %** | ≥ 80 % ✔ |
| Notfälle erkannt | 100 % | 100 % | ≥ 90 % ✔ |
| Fehlalarme | 0 % | 0 % | ≤ 10 % ✔ |
| Zu Unrecht ausgeschlossen | 3,2 % | 2,2 % | ≤ 5 % ✔ |
| Konsistenz (streng) | 62,5 % | **70,0 %** | ≥ 85 % ✘ |
| Konsistenz des Wegs (informativ) | 85,0 % | 92,5 % | – |
| Antwortzeit p50 / p95 | 7,6 s / 9,8 s | 8,0 s / 10,8 s | – |
| Läufe ohne Ergebnis | 0 | 0 | 0 ✔ |

Berichte: `triage-holdout-v1-2026-10-16-lauf1-ohne-temperatur.json`, `…-lauf2-temperatur0.json`.

## Einordnung (ehrlich)

* **Sicherheitsrelevante Kriterien sind erfüllt**: kein übersehener Notfall, kein Fehlalarm, die Ausschlussquote liegt unter der Grenze. Die Trefferquote ist hoch.
* **Das strenge Konsistenzkriterium wird verfehlt** (70 % statt 85 %). Der größte Teil sind Wechsel zwischen NORMAL/LOW/HIGH oder benachbarten Kategorien, die den Weg nicht ändern (Konsistenz des Wegs 92,5 %). Entscheidungsrelevant bleiben zwei Fälle: H19 (Lieferantenangebot gegen Newsletter: 2 von 3 Läufen schließen aus) und H15 (Bewerbung: Geschäft gegen Prüfung). H08 und weitere Randfälle sind in den Berichten ablesbar.
* **Temperatur 0 war die einzige Änderung zwischen Lauf 1 und 2** und gilt generell (keine fallbezogene Anpassung). Trotzdem wurde der Prüfsatz damit zweimal gesehen; für künftige Änderungen an der Anweisung wird ein neuer Satz (holdout-v2) benötigt. Das Kriterium wurde nicht gesenkt, um es zu erfüllen.
* **Grenzen:** 40 Fälle sind klein (die Quoten haben große Unsicherheit); ein Modell, ein Beispielprofil, nur die Triage – der Agent insgesamt (Planung, Auskunft) wird noch nicht mit Punktzahlen bewertet.
