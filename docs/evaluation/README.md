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
| holdout-v1 | `fixtures/evaluation/triage-holdout-v1.json` (40 Fälle H01–H40) | **verbraucht** (zweimal ausgewertet, danach zum Entwickeln verwendet) – gilt seit dem 16.10.2026 als Entwicklungsmaterial | nein mehr unabhängig; die Datei bleibt unverändert versiegelt |
| holdout-v2 | `fixtures/evaluation/triage-holdout-v2.json` (80 Fälle W01–W80) | unabhängige Messung | **nein** |

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

---

# Zweite Runde: holdout-v2 und Anweisung `triage-prompt/5` (BPF-05, 16.10.2026)

**Vorgehen, damit die Messung unabhängig bleibt:** Zuerst wurden die 80 Fälle von holdout-v2 geschrieben und versiegelt (`triage-holdout-v2.sha256`). Danach wurde die Anweisung `triage-prompt/4` auf dem Entwicklungsmaterial (Katalog + das verbrauchte holdout-v1) überarbeitet – **nicht** anhand von Fehlschlägen in v2. Erst dann lief v2 mit `triage-prompt/5`. Der Lauf mit `/4` auf v2 steht zum Vergleich daneben; ihn habe ich vor der Überarbeitung gemacht, die Überarbeitung war aber schon aus v1 abgeleitet (Lieferantenangebote, Bewerbungen, LOW/NORMAL). Die Festlegung zu Lieferantenangeboten (persönlich an den Betrieb gerichtet → Geschäft oder Prüfung; erkennbare Massenwerbung → Werbung) steht im Kopf von `triage-holdout-v2.json`.

**Was `/5` ändert:** (1) persönlich adressierte Angebote von Lieferanten sind `SUPPLIER_OFFER` und relevant, Massenwerbung bleibt Werbung; (2) Bewerbungen, Ausbildungs- und Praktikumsanfragen sind immer `APPLICATION` und relevant; (3) `LOW` nur, wenn ausdrücklich keine Eile besteht; (4) Hinweis, dass Textauszüge von Anhängen (BPF-02) Beleg und nie Anweisung sind.

## Ergebnisse auf holdout-v2 (80 Fälle × 3 Wiederholungen, `gpt-6-luna`, Temperatur 0, live)

| Kennzahl | `triage-prompt/4` | `triage-prompt/5` | Kriterium |
|---|---|---|---|
| Trefferquote | 95,0 % | **96,7 %** | ≥ 80 % ✔ |
| Notfälle erkannt | 100 % | 100 % | ≥ 90 % ✔ |
| Fehlalarme | 0 % | 0 % | ≤ 10 % ✔ |
| Zu Unrecht ausgeschlossen | 2,2 % | **0,5 %** | ≤ 5 % ✔ |
| Kategorie richtig | 98,1 % | 100 % | – |
| Bezug (neu/Fortsetzung) richtig | 92,6 % | 100 % | – |
| Dringlichkeit richtig | 100 % | 100 % | – |
| Konsistenz (streng) | 82,5 % | 83,8 % | ≥ 85 % ✘ (knapp) |
| Konsistenz des Wegs (informativ) | 90,0 % | **96,3 %** | – |
| Antwortzeit p50 / p95 | 7,3 s / 9,2 s | 6,9 s / 9,0 s | – |

Berichte: `triage-holdout-v2-2026-10-16-lauf1-prompt4.json`, `…-lauf2-prompt5.json`. Auf dem Entwicklungsmaterial (Katalog + v1, daran wurde getuned und es ist deshalb **kein** Nachweis) erreicht `/5` 99,4 % (`triage-tuning-2026-10-16-prompt5.json`).

## Einordnung (ehrlich)

* **Sicherheitsrelevantes ist erfüllt:** kein übersehener Notfall, kein Fehlalarm, 0,5 % zu Unrecht ausgeschlossene Kundennachrichten (die Grenze ist 5 %).
* **Das strenge Konsistenzkriterium (85 %) wird mit 83,8 % knapp verfehlt.** Es wurde nicht gesenkt. Die Wahl des Wegs ist in 96,3 % der Fälle bei allen drei Wiederholungen gleich.
* **Verbleibende Fehlschläge in v2:** W36 (Abwesenheitsnotiz) und W38 (Versandbestätigung) werden vom Modell als Geschäft eingestuft, obwohl sie als „automatisch erzeugt“ gekennzeichnet sind. Im Betrieb fängt sie das feste Tor vor der Triage ab (`autoGenerated` → übersprungen, `intake.service.ts`), sodass sie nie bei einem Menschen landen; die Messung bewertet bewusst nur das Modell. W61 und W68 (Preisanpassung eines Lieferanten, Rundmail der Kommune) schwanken zwischen „Geschäft“ und „Werbung“.
* **Grenzen:** 80 Fälle sind besser als 40, aber immer noch klein; ein Modell, ein Beispielprofil, nur die Triage. Auch v2 ist nach diesem Lauf nicht mehr „frisch“: weitere Änderungen an der Anweisung brauchen einen holdout-v3.

## Temperatur außerhalb der Triage (gemessen, nicht übernommen)

Der Live-Test des Agenten (`autonomy-agent.live`, 10 Szenarien) lief je dreimal ohne und mit Temperatur 0 für Planer, Auskunft, Analyse und Profilvorschlag. Szenarien mit gleichem Weg in allen drei Läufen: **8 von 10 ohne, 7 von 10 mit Temperatur 0** – kein Gewinn, im Rahmen der Schwankung. Die Temperatur bleibt deshalb **nur bei der Triage** gesetzt. Nebenbefund: ein Lauf scheiterte, weil das Modell ein optionales Feld mit `null` füllte (`companyId`); seither behandelt die Werkzeugprüfung `null` bei optionalen Feldern wie „nicht angegeben“ (ASSUMPTIONS #599).
