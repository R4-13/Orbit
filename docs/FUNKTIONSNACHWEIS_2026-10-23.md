# Begrenzter Funktionsnachweis (Stand 2026-10-23)

Zweck: sichtbar machen, **welche Arbeit ORBIT für die Nutzerin tatsächlich erledigt**, an drei Geschäftsabläufen, auf festem, vollständig getestetem Codestand, über das echte
Postfach und den erlaubten Versand (Tom → Musterwerk). Dieses Dokument legt **vor der Ausführung** fest, was als erreicht gilt. Ergebnisse und Entscheidung je Ablauf stehen im
Abschnitt „Ergebnis“ am Ende (wird nach der Ausführung ergänzt; die Definitionen oben werden danach nicht mehr verändert, die Änderungshistorie steht in Git).

Vorgänger-Ergebnis bleibt dokumentiert: Der Messlauf vom 2026-10-20/21 war ein **diagnostischer Lauf mit gemischten Codeständen**, keine bestandene Abnahme der flexiblen
Autonomie (siehe `docs/ABNAHMEPRUEFUNG_2026-10-21.md`).

## 1. Rahmen

| Punkt | Festlegung |
|---|---|
| Codestand | ein fester Commit (wird im Ergebnis genannt); davor volle Gate-Prüfung (Typprüfung, Lint, Unit, e2e, Build), Migration angewendet, Dienste neu gestartet |
| Echter Weg | Tom (`tomorbit777@gmail.com`) → Postfach des Mandanten **Musterwerk** (Gmail-Abruf) → ORBIT → Antwort über Gmail an Tom. Keine anderen Empfänger |
| Freigaben | bestehende Testfreigaben: Einzelfreigaben je Aktion (`email.send.information` ist in Musterwerk `REQUIRE_APPROVAL`), Planfreigabe (D4) nur für die Testfälle dieser Serie; keine globale Erweiterung der Vollmachten, keine Kalenderbuchung, keine Zahlungsausführung |
| Getrennte Berichterstattung | (a) **Autonom** = Mandant mit anderer Konfiguration (isolierte Testdatenbank, Antwortversand ohne Freigabepflicht, echtes Sprachmodell); (b) **Freigegeben** = Musterwerk mit gezählten menschlichen Freigaben. Beides wird nie vermischt |
| Schattenbudget | unverändert (45/60), kein Zurücksetzen, keine Erweiterung |
| Umfang | je Ablauf mindestens drei verschiedene Formulierungen; keine pauschale 60-Fälle-Serie |
| Sicherung | Nachweise (Vorgangs-IDs, Mail-IDs, Protokoll, Antworttexte) unter `docs/evidence/funktionsnachweis-2026-10-23/` **vor** der Bereinigung; Bereinigung nur ID-genau |
| Gültige Wege | verschiedene gültige Bearbeitungswege sind zulässig; **identische Schrittfolgen sind kein Abnahmekriterium**. Maßstab ist das Ergebnis für die Kundschaft |
| Grundsatz zum Ziel | Das Kundenziel wird nicht durch ein leichteres ersetzt. Ein Hinweis im Abschluss, was nicht erreicht wurde, ersetzt keine fehlende Zielerreichung: ist das Kundenziel nicht erreicht, ist der Vorgang **kein** Erfolg, sondern eine **Übergabe mit offenem Restziel** (Person, Frist, was bleibt) |

## 2. Ablauf A – Auskunft aus belegtem Betriebswissen bis zur zugestellten Antwort

**Kundenziel:** Die Kundschaft bekommt eine **richtige, belegte** Antwort auf ihre Frage – ohne Erfindungen, ohne Preise, mit klarer Aussage, was der Betrieb nicht anbietet.

**Verfügbare Fähigkeiten:** Betriebsprofil (Leistungen, Ausschlüsse, Einsatzgebiet, Zeiten, FAQ) als Wissensquelle (`knowledge.answer`), Antwortmail `email.send.information`.

**Erforderliche Freigaben:** Musterwerk: eine Einzelfreigabe der Antwortmail je Vorgang (gezählt). Autonomer Mandant: keine.

**Abschlussbeweis (alle müssen gelten):**
1. Ausgangsmail von ORBIT existiert im Protokoll mit Gmail-Kennung **und** ist in Toms Postfach angekommen (Abgleich über Message-ID).
2. Jede Tatsachenaussage der Antwort ist im Betriebsprofil belegt (Prüfung am Text, nicht am Schritt); keine Preis- oder Terminzusage ohne Grundlage; Ausschlüsse werden als solche genannt.
3. Vorgang `COMPLETED` mit dem Ziel „Auskunft erteilt“ und dem Nachweis (Wirkung `email.send/INFORMATION` bestätigt).

**Formulierungen (Tom schreibt):**
- A1 „Machen Sie auch Badsanierungen mit ebenerdiger Dusche, und kommen Sie dafür nach Leverkusen?“ (Leistung + Einsatzgebiet)
- A2 „Sind Sie am Freitag bis 17 Uhr erreichbar? Und machen Sie auch Elektroarbeiten?“ (Öffnungszeit knapp überschritten + Ausschluss → richtige Absage statt Ja)
- A3 „Wie läuft das bei Ihnen mit einem Angebot – können Sie mir vorab schon einen Preis nennen?“ (FAQ: Besichtigung vor Ort, keine Vorabpreise)

## 3. Ablauf B – Anfrage mit fehlender Information und anschließender Korrektur

**Kundenziel:** Die Anfrage wird **mit den richtigen Daten** aufgenommen (fehlende Angaben werden erfragt, eine spätere Korrektur der Kundschaft ersetzt den alten Wert) und führt zum **fachlich richtigen nächsten Ergebnis**: eine vollständige, korrekte Anfrage beim Betrieb (Lead mit den korrigierten Werten) und eine zutreffende Rückmeldung an die Kundschaft (Eingang, nächster Schritt, kein Preis ohne Grundlage).

**Verfügbare Fähigkeiten:** Rückfragen (`email.send.clarification`, Vorgang wartet auf Antwort – zulässiger Zwischenzustand), Faktenübernahme und -korrektur (`CaseFactsService`, `FactCorrectionService`), Lead (`crm.lead.create`), Terminvorschläge nach Betriebsregel (keine Buchung), Übergabe an eine Person.

**Erforderliche Freigaben:** Musterwerk: Rückfrage laut Mandantenrichtlinie (autonom), Antwort-/Folgemail laut Richtlinie (Einzelfreigabe), ggf. Planfreigabe (D4) für den Testfall. Autonomer Mandant: keine.

**Abschlussbeweis (alle müssen gelten):**
1. Die erste Antwort von ORBIT fragt **gezielt die fehlenden** Angaben (nicht bereits genannte) und wiederholt nichts.
2. Nach Toms Antwort und anschließender **Korrektur** („nicht 120 m², sondern 140 m²“) enthalten Falldaten und Lead den **korrigierten** Wert; der alte Wert erscheint in keiner Folgemail als gültig; eine offene Korrektur bleibt nie unentdeckt (Sperre `CORRECTION_UNRESOLVED`).
3. Fachlich richtiges Ergebnis: Lead beim Betrieb angelegt (HubSpot, Musterwerk – danach archiviert) **und** Rückmeldung an Tom zugestellt, die den nächsten Schritt korrekt nennt (Besichtigung vor Ort statt Preis). Wartet der Vorgang noch, gilt das nur als Zwischenzustand; für den vollständigen Nachweis werden die vorgesehenen Antworten tatsächlich gesendet.

**Formulierungen:**
- B1 „Neue Heizung – Angebot“ (knapp, ohne Angaben) → Antwort: Gasheizung, Baujahr 1985, 120 m² → Korrektur: „Entschuldigung, es sind 140 m², nicht 120.“
- B2 „Wir überlegen eine Wärmepumpe für unser Einfamilienhaus in Frechen.“ → Antwort: Baujahr 1998, ca. 150 m² → Korrektur: „Das Baujahr ist 1989, ich habe mich vertippt.“
- B3 „Badezimmer erneuern – was kostet das?“ (Bad, Wunsch ebenerdige Dusche, ohne Fläche) → Antwort: 6 m² → Korrektur: „Doch etwas größer, 7 m².“

## 4. Ablauf C – Nachricht mit mehreren Anliegen und eine gemeinsame Antwort

**Kundenziel:** **Jedes** Anliegen der Nachricht wird erkannt, bearbeitet oder bewusst übergeben; die Kundschaft erhält **eine gemeinsame, verständliche Antwort**, die zu jedem Anliegen sagt, was geschieht. Nichts wird still verworfen.

**Verfügbare Fähigkeiten:** Anliegenerkennung mit Textbeleg (`concerns`, nur im Testfenster mit `process.split`), Teilvorgänge, Auskunft, Rückfrage, Lead, Aufgabe/Übergabe, gemeinsame Antwort.

**Erforderliche Freigaben:** Musterwerk: `process.split` nur im Testfenster; Einzelfreigabe der gemeinsamen Antwort; Planfreigaben (D4) der Teilvorgänge unbekannter Art. Autonomer Mandant: keine.

**Abschlussbeweis (alle müssen gelten):**
1. Anliegenliste vollständig: jedes Anliegen der Mail ist ein Teilvorgang oder ausdrücklich zusammengefasst; jedes hat einen **Textbeleg** aus der Mail (kein erfundenes Anliegen; keine Auslassung von Verneinung/Bedingung, siehe Abschnitt 6).
2. Je Teilvorgang ein nachvollziehbares **Ergebnis**: erreicht (mit Nachweis) **oder** Übergabe mit Person und Restarbeit.
3. Die gemeinsame Antwort ist zugestellt, nennt jedes Anliegen und behauptet nichts Nichterreichtes.

**Klarstellung vor der Ausführung (Auslegung „gemeinsame Antwort“).** Gemeint ist der Ablauf des Auftrags: eine Nachricht mit mehreren Anliegen, ORBIT stellt Rückfragen, und **die Kundschaft antwortet einmal gemeinsam** für mehrere Teilvorgänge. Der Nachweis verlangt deshalb, dass diese eine Antwort **jeden offenen Teilvorgang erreicht** (als Fortsetzung des wartenden Teilvorgangs oder als Zuordnung zu einem nicht wartenden – nichts geht verloren) und jeder Teilvorgang danach ein nachvollziehbares Ergebnis hat. **ORBIT fasst seine eigenen Antworten nicht zu einer Mail zusammen**: jeder Teilvorgang antwortet selbst (die Eingangsbestätigung wird nur einmal gesendet). Das ist eine Eigenschaft des Produkts und wird im Ergebnis so berichtet; eine zusammengefasste ausgehende Antwort wäre eine neue Produktfunktion und ist in dieser Runde ausgeschlossen. Der Abschlussbeweis Punkt 3 oben gilt entsprechend: jede zugestellte Mail nennt nur Erreichtes und behauptet nichts Nichterreichtes; die Anliegen sind insgesamt lückenlos beantwortet oder übergeben.

**Formulierungen:**
- C1 „erstens eine Kopie meiner letzten Rechnung für die Steuer, zweitens den Wartungstermin vom 28.10. auf den 4.11. verschieben, drittens ein Angebot für einen neuen Heizungsregler“ (Rechnungskopie, Terminänderung ohne Kalenderzugriff → Übergabe, Angebot)
- C2 „Unser Monteur hat gestern seinen Schlüsselbund bei uns liegen lassen – bitte sagen Sie ihm Bescheid, dass er ihn abholen kann, und bestätigen Sie mir kurz, dass das angekommen ist. Außerdem: Kommen Sie auch nach Frechen?“ (Schlüsselbund + Auskunft; siehe Abschnitt 5)
- C3 „Zwei Dinge: Die Rechnung Nr. 4711 habe ich zweimal bekommen, bitte klären Sie das. Und haben Sie bis Freitag noch einen Termin für eine Heizungswartung frei?“ (Rechnungsklärung, Terminanfrage ohne Buchung)

## 5. Besonderheit Schlüsselbund (Zielregel)

Auftrag der Kundschaft: **„den Monteur informieren“**. Die Nachricht an das Büro erfüllt das Ziel **nur**, wenn eine **dokumentierte betriebliche Zuständigkeitsregel** das Büro als Mittler
für Monteure bestimmt (neue Zuständigkeit `DISPATCH` – „Einsatzplanung / Weitergabe an Monteure“ – im Mitarbeiterverzeichnis). Ohne eine solche Regel gilt:

- Ziel `staff.informed` ist **nicht** erreicht; der Vorgang ist eine **Übergabe mit offenem Restziel** (verantwortliche Person aus dem Verzeichnis, Restarbeit „Monteur informieren“, Frist).
- Die Kundenbestätigung („Ihre Nachricht ist bei uns angekommen“) bleibt zulässig und wahr; sie behauptet nicht, der Monteur wisse Bescheid.

Musterwerk hat im Verzeichnis keine Zuständigkeit `DISPATCH` und keinen Monteur (Frank Test = Inhaber, Test Person = Büro, gleiches Postfach) → erwartetes Ergebnis für C2 dort:
**Übergabe mit offenem Restziel**, kein Erfolg. Mit einem Testeintrag `DISPATCH` im **autonomen Testmandanten** wird zusätzlich gezeigt, dass die Regel greift (dort ist die Meldung an das Büro dann das erreichte Ziel).

## 6. Grenzen, die in dieser Runde geschlossen werden

1. **Gmail-Rückstand über 200 Nachrichten:** Abruf mit Seitenfortschritt; der Fortschrittsmarker bleibt stehen, bis der Rückstand abgearbeitet ist; wiederholter Abruf erzeugt keine doppelten Wirkungen. Nachweis per Test mit nachgebautem Gmail (kein Massenversand).
2. **Unscharfe Belegprüfung der Anliegen (zwei Wörter / 92 % Zeichenähnlichkeit)** sind nur Hilfen. Zusätzlich: Sinnerhalt – ausgelassene **Verneinungen/Bedingungen** werden nicht akzeptiert; bei unsicherem Beleg wird der **vollständige Originaltext** verwendet. Gegenbeispiele sind Tests.
3. **Zielabdeckung:** Jede Kundenanforderung (`requestedOutcomes`) braucht ein Ziel oder eine Übergabe mit Restziel; ein Vorgang gilt nicht als abgeschlossen, solange ein Ziel offen ist.

## 7. Entscheidungsregeln für das Ergebnis

Je Ablauf genau eine Entscheidung: **„geeignet für begrenzten Pilotbetrieb“** oder **„blockiert durch Befund X“**. Schlägt ein Ablauf erneut fehl: erst die gemeinsame Ursache bestimmen
(Prozesssteuerung / Modellverständnis / fehlende Fähigkeit / fehlende Berechtigung); bei wiederholtem Scheitern aus derselben Ursache eine belegte technische Entscheidung statt weiterer
Formulierungsregeln; liegt es am Modellverständnis, ein **begrenzter** Vergleich mit dem bereits verfügbaren leistungsfähigeren Modellprofil bzw. aktivierter Begründung – kein globaler
Wechsel ohne Ergebnisvergleich.

---

# Ergebnis (nach der Ausführung)

Die Definitionen oben wurden vor der Ausführung eingecheckt (Commit `0854b56`; danach nur die Klarstellung zur „gemeinsamen Antwort“, ebenfalls vor dem ersten Lauf). Dieser Abschnitt berichtet, was tatsächlich geschah. Nachweise liegen unter
`docs/evidence/funktionsnachweis-2026-10-23/` (zehn Läufe des autonomen Mandanten, Vergleich mit `gpt-6-sol`, Musterwerk-Vorlauf, Zwischenstand und Endlauf als JSON mit Nachrichtentexten, Plänen, Wirkungen, Aufgaben und Freigaben; `musterwerk-freigaben.txt`, `flag-fenster.txt`).

## 1. Stand und Vorgehen

* **Rote Läufe waren der Zweck.** Der autonome Mandant wurde neunmal vor dem Endlauf (Lauf 10: 10/10) und der Betrieb Musterwerk zweimal vor dem Endlauf durchlaufen; jeder rote Lauf wurde auf seine Ursache zurückgeführt und behoben (Abschnitt 5), danach lief **die ganze Serie neu**, nicht nur der betroffene Teil. Der Vorlauf in Musterwerk (15 Vorgänge) und der Zwischenstand (4 Vorgänge) sind gesichert und ID-genau bereinigt; sie zählen nicht zum Ergebnis.
* **Endlauf in Musterwerk:** Code `5014b50` (bereitgestellt am 23.10. um 21:19 UTC). Danach wurden nur noch ein Textfehler in der Aufgabe „Planung nicht möglich“ (ein regulärer Ausdruck ersetzte den Buchstaben „s“; im Endlauf sichtbar, behoben) und dessen Test geändert.
* **Qualitätstor je Stand:** Typprüfung (14/14), Lint (14/14), Unit (shared 345, api 680) und der **Gesamtlauf der e2e-Tests allein im festen Worktree** (Gate 8 auf `5014b50`: 76 Suiten, 606 Tests grün). Zwei Gesamtläufe schlugen aus Umgebungsgründen fehl (Verbindungspool-Zeitüberschreitung im Mandantenexport; Speicherüberlauf des Test-Prozesses nach 72 Suiten, seither mit `--max-old-space-size=6144`); beide wurden wiederholt, nicht übergangen. Der Gesamtlauf auf dem allerletzten Stand steht unten im Abschnitt 8.
* **Zwei Konfigurationen, getrennt berichtet:** *Autonom* = Testmandant mit anderer Konfiguration (Auskünfte ohne Einzelfreigabe, Modell `gpt-6-luna`, Versand als Double, Kalender gesperrt, Verzeichnis wie Musterwerk). *Freigegeben* = Musterwerk über das echte Postfach (Tom an Musterwerk), Auskünfte nur mit Einzelfreigabe, Pläne unbekannter Abläufe nur mit Planfreigabe.

## 2. Ergebnis je Fall – Musterwerk, echtes Postfach (Endlauf)

| Fall | Kundenziel erreicht? | Was ORBIT selbst tat | Menschliche Eingriffe | Ausgang |
|---|---|---|---|---|
| **A1** Badsanierung/Leverkusen | **Ja** – belegte Antwort zugestellt (in Toms Postfach nachgewiesen) | Auskunft aus dem Profil, Entwurf | 1 Einzelfreigabe (Antwort) | COMPLETED, `ADHOC_GOALS_PROVEN` |
| **A2** Freitag/Elektro | **Ja** – „am Freitag 07:00–16:00 erreichbar, Elektroarbeiten bieten wir nicht an“ | wie A1 | 1 Einzelfreigabe | COMPLETED |
| **A3** Angebotsablauf/Vorabpreis | **Ja** – „vor Ort ansehen, schriftliches Angebot, Preise nicht vorab“ | wie A1 | 1 Einzelfreigabe | COMPLETED |
| **B1** Heizung knapp, Antwort, Korrektur | **Teilweise.** Gezielte Rückfrage (Heizungsart, Ort, vorhandene Heizung); Antwort aufgenommen; Lead mit den Antworten angelegt; Korrektur 1985 → 1995 als Angabe übernommen | Rückfrage (selbstständig), Auslese, Lead (HubSpot), Eingangsbestätigung, Korrektur | 0 | COMPLETED; der Lead trägt noch 1985, daher **Aufgabe „Korrektur nach Übergabe“** (alt und neu) |
| **B2** Heizkörper Bonn | **Teilweise.** Besichtigungstermine vorgeschlagen (nichts gebucht); Antwort führt zum Lead; die Korrektur vier → sechs erreicht die Person als Aufgabe (kein strukturierter Wert, weil die Anzahl nie erfragt wurde) | Terminvorschlag, Lead | 0 | COMPLETED plus Aufgabe „Neue Nachricht nach Abschluss“ |
| **B3** Bad „was kostet das?“ | **Nein, nur übergeben.** Eingang bestätigt, Lead sofort angelegt; weder Preisfrage beantwortet noch nach der Fläche gefragt; die Angaben (6 m², Leverkusen) und die Korrektur (7 m²) erreichen die Person als zwei Aufgaben mit Wortlaut | Eingangsbestätigung, Lead | 0 | COMPLETED plus 2 Aufgaben |
| **C1** drei Anliegen | **Nein, alle drei übergeben** (Rechnungskopie, Terminverschiebung, Reglerangebot kann ORBIT nicht selbst erledigen), je Teilvorgang mit Aufgabe und Restziel; die **gemeinsame Antwort der Kundschaft erreichte alle drei** (zwei als Fortsetzung, einer als Zuordnung) | 3 Teilvorgänge, 2 Rückfragen (beide fragten nach dem *Regler*, nicht nach dem eigenen Anliegen), Fallback-Aufgabe für den Teilvorgang, dessen Planung scheiterte | 2 Planfreigaben | 3 × MANUAL_REVIEW mit Aufgabe |
| **C2** Schlüsselbund und Frechen | **Frechen: ja** (Antwort mit Einsatzgebiet). **Schlüsselbund: nein, bewusst nicht als erreicht gewertet:** „Monteur informieren“ ist eine **Übergabe mit offenem Restziel** (Aufgabe „Monteur über Abholmöglichkeit informieren – Restziel …, die Weitergabe an Monteure ist nicht als Zuständigkeit hinterlegt“, Hinweis bei Zuständigkeit GENERAL = Inhaber/Büro); Eingangsbestätigung zugestellt | Bestätigung, Auskunft, Hinweis, Aufgabe | 3 Planfreigaben + 1 Einzelfreigabe | Schlüsselbund-Teilvorgang MANUAL_REVIEW |
| **C3** Rechnung doppelt und Termin | **Nein, beide übergeben** (Aufgaben „Rechnung 4711 prüfen und klären“, „Verfügbarkeit prüfen und Kundschaft informieren“); nichts gebucht | Aufgaben, Hinweise | 0 | 2 × MANUAL_REVIEW; **keine Mail an die Kundschaft** |

**Menschliche Freigaben im Endlauf Musterwerk:** 9 (4 Einzelfreigaben „Antwort senden“: A1, A2, A3, C2-Frechen; 5 Planfreigaben: C1 ×2, C2 ×3). Alle für ausdrücklich benannte Testvorgänge, nur an Tom; keine Kalenderbuchung, keine fremden Empfänger, keine globale Erweiterung der Vollmachten. Das Schattenbudget blieb unverändert: der Zähler stand zu Beginn bei 55 und am Ende bei 61, die Obergrenze 60 wurde nicht angehoben und griff (die letzten Fälle wurden nicht mehr schattengeplant).

**Autonomer Mandant (Lauf 10, getrennt gezählt):** A1–A3 ohne jede Freigabe zugestellt und abgeschlossen; B1–B3 mit Rückfrage und Korrektur wie oben (B2 wartet auf Antwort); C1–C3 wie in Musterwerk Übergaben mit Aufgaben; **C2b (mit Zuständigkeit `DISPATCH` im Verzeichnis)**: die Meldung geht an die dafür zuständige Person (Hinweis `DISPATCH`), der Vorgang ist `COMPLETED` – der einzige Fall, in dem „Monteur informieren“ als erreicht gilt. 6 Planfreigaben (alle in Ablauf C).

## 3. Schlüsselbund: Zielregel

Ohne dokumentierte Weitergabe (Musterwerk: keine Zuständigkeit `DISPATCH`, kein Monteur im Verzeichnis) ist „Monteur informieren“ eine **Übergabe mit offenem Restziel**: die Anliegenliste des Plans trägt `handover`, das Ziel `human.review` steht dabei, der Abschluss legt die Aufgabe mit dem Restziel im Wortlaut der Kundschaft an, der Vorgang bleibt in der Prüfung, die Kundschaft erhält nur die wahre Eingangsbestätigung. Gesichert in Validator (`OUTCOME_*`), Planer (Personenziel wird Übergabe), Abschluss (Aufgabe) und Tests. Ein Hinweis im Abschluss ersetzt nirgends mehr ein fehlendes Ziel.

## 4. Die zwei Grenzen

1. **Gmail-Rückstand über 200:** Abruf mit Fortschrittsmarke (`{v:1, mark}`), seitenweise bis zur Marke; die Marke bleibt stehen, solange Unbekanntes übrig ist; die Aufnahme holt „gesehen, aber nie aufgenommen“ nach; ein nicht aufnehmbarer Eingang stoppt die übrigen nicht; hängengebliebene Eingänge werden aus dem Gespeicherten weiterverarbeitet (nur ohne Entscheidung und Vorgang). Nachweis: 530er-Rückstand in 25er-Takten vollständig, jede Nachricht genau einmal; Unterbrechung nach dem Abruf und mitten in der Aufnahme; wiederholtes Abfragen ohne Wirkung; gelöschte Marke; e2e gegen die echte Datenbank (Wiederverwendung gespeicherter Nachrichten, kein zweiter Eingang oder Vorgang). Kein Massenversand.
2. **Sinnerhalt statt Ähnlichkeit:** Wortgleichheit und 92 % Zeichenähnlichkeit sind nur noch Hilfen. Neu (`meaning-guard.ts`): eine eingefügte Verneinung oder Bedingung macht den Auszug unbelegt; eine ausgelassene lässt den Originalsatz gelten, vermerkt `meaningRisk` und nimmt das Ziel des Teilvorgangs aus dem Originaltext; Bedingungssätze im Nachbarsatz werden dem Anliegen zugeschlagen; sehr kurze Fragmente belegen keinen langen Satz; weich umbrochene Zeilen sind keine Satzgrenzen; bei Unsicherheit bekommt der Teilvorgang die vollständige Nachricht. Die Zahlenkorrektur „nicht A, sondern B“ ersetzt bei Vorbehalt („falls“, „vermutlich“, „oder“, „höchstens“) nichts; „nicht nur A, sondern B“ ist keine Ersetzung; eine Korrektur unter Vorbehalt bleibt als Widerspruch sichtbar. Gegenbeispiele sind Tests (`concerns-meaning`, `meaning-guard`, `fact-correction`).

## 5. Ursachen und technische Entscheidungen (statt weiterer Formulierungsregeln)

| Befund (Lauf) | Ursache-Klasse | Entscheidung |
|---|---|---|
| Neuplanung scheiterte wiederholt an `REPLAN_DROPS_CONFIRMED_EFFECT`, `BINDING_UNKNOWN_NODE`, `BINDING_NOT_UPSTREAM` (Läufe 2–8, bei **beiden** Modellprofilen) | **Prozesssteuerung** (Verdrahtung der Neuplanung), nicht Verständnis | ORBIT übernimmt bestätigte Schritte selbst (`carryForwardConfirmed`), bindet Verweise auf unbekannte Schritte an den einzigen Erzeuger und ergänzt vergessene Kanten (`repairBindings`); eine weitere interne Meldung ist keine Wiederholung |
| Planer ordnete das Personenziel `human.review` als Anliegenziel zu; Übergabe ohne Aufgabe | Modellverständnis, deterministisch auffangbar | Normalisierung im Planer; die Aufgabe legt der Abschluss an |
| Sinnlose Rückfrage „Angebotswunsch?“ (Läufe 1, 5, Musterwerk-Vorlauf und -Zwischenstand) | Datenmodell: zwei Fassungen derselben Aussage gelten als Widerspruch | dieselbe Nachricht nicht gegen sich selbst lesen; zweite Lesart einer Textangabe ohne Änderungshinweis ist Ergänzung |
| Korrektur oder Nachricht nach der Übergabe verschwand lautlos | fehlende Fähigkeit (kein Weg zur Person) | Aufgabe „Korrektur nach Übergabe“ bzw. „Neue Nachricht nach Abschluss“ |
| Rückfrage gesendet, dahinter eine Aufgabe statt Warten (B2) | Prozesssteuerung | Validator `CLARIFICATION_NOT_AWAITED` |
| Zahl im Textwert („Gasheizung von 1985“) nicht korrigierbar | Fähigkeit | Zahl im Text ersetzen; Ankerwörter mit Zusammensetzungen |
| Ziel ohne erzeugenden Schritt (`quote.delivered` ohne Angebotsschritt) | Prozesssteuerung | Validator `OUTCOME_GOAL_UNREACHABLE`, das Anliegen wird Übergabe |
| Zeilenumbruch teilte ein Anliegen („…4.11.⏎verschieben“): unbelegt plus Phantom-Teilvorgang | Fähigkeit | weiche Umbrüche verbinden |
| Planung scheitert endgültig: Vorgang ohne erkennbares Anliegen | fehlende Fähigkeit | Aufgabe mit dem Anliegen im Wortlaut |

**Begrenzter Modellvergleich** (Lauf 5 mit `gpt-6-luna` gegen die gleiche Serie mit `gpt-6-sol`, ein bereits verfügbares leistungsfähigeres Profil): `sol` bestand B1, B3 und C1 formal, scheiterte aber an denselben Planmustern (`BINDING_UNKNOWN_NODE` in zwei C1-Teilvorgängen, Ortskonflikt in B2). Die Ursache ist **nicht** das Modellprofil. **Aktiviertes Denken** (`reasoning_effort` ab `low`) lehnt der Anbieter für Function-Tools in Chat Completions bei `gpt-6-luna` und `gpt-6-sol` ab (HTTP 400; `gpt-6.1-sol` akzeptiert kein `none`); ein Vergleich verlangt die Responses-Schnittstelle, also eine neue Produktfunktion, und ist in dieser Runde ausgeschlossen. Ein globaler Wechsel erfolgte nicht.

## 6. Entscheidung je Ablauf

* **A – Auskunft aus belegtem Betriebswissen: geeignet für einen begrenzten Pilotbetrieb.** 3/3 in Musterwerk korrekt und zugestellt (mit der konfigurierten Einzelfreigabe); in den autonomen Läufen inhaltlich korrekt, mit Abweichungen bei A3 in früheren Ständen (mehrfach: Weg in den Angebotsprozess samt Lead oder unbegründete Prüfung durch eine Person), in den letzten drei autonomen Läufen und in Musterwerk nicht mehr aufgetreten. *Auflage:* Die Wahl zwischen Auskunft und Angebotsprozess beruht auf der KI-Einschätzung der Eignung; Fragen zum Angebotsablauf können in seltenen Fällen im Angebotsprozess landen.
* **B – Anfrage mit fehlender Information und Korrektur: nicht geeignet, blockiert durch Befund F-B.** *F-B1:* Nach der Übergabe erreichen Angaben und Korrekturen den **Lead nicht** (es gibt keine Fähigkeit, ein CRM-Objekt zu aktualisieren); sie erreichen nur als Aufgabe eine Person, ein unbeaufsichtigter Betrieb erzeugte veraltete Leads. *F-B2:* Bei Preisfragen ohne Angaben (B3) wird der Lead sofort angelegt und nur der Eingang bestätigt, weder die Frage beantwortet noch nach der Fläche gefragt; Angaben, die nicht erfragt wurden, werden nicht als Angabe festgehalten (B2). Vertretbar nur mit täglicher Pflicht-Sichtung der Folgeaufgaben.
* **C – mehrere Anliegen, gemeinsame Antwort: nicht geeignet, blockiert durch Befund F-C.** *F-C1:* Teilvorgänge stellen Rückfragen zum Anliegen eines Geschwisters (C1) und senden mehrere Mails. *F-C2:* Die Planung eines Teilvorgangs scheitert in etwa jedem dritten Fall (Auffang: Aufgabe mit Anliegen). *F-C3:* Keine zusammengefasste ausgehende Antwort und in C1/C3 keine Eingangsbestätigung: die Kundschaft hört nichts oder Widersprüchliches. Nachvollziehbar und lückenlos ist dagegen die **Übergabe** (jeder Teilvorgang hat Aufgabe, Zuständigkeit und Restziel), und die gemeinsame Antwort der Kundschaft erreicht jeden Teilvorgang.

Nicht erreicht und hier nicht geschönt: ORBIT hat im Endlauf keines der Anliegen Rechnungskopie, Terminverschiebung, Reglerangebot, doppelte Rechnung oder Wartungstermin selbst erledigt; es fehlen die Fähigkeiten (Dokumentversand, Kalenderänderung und -buchung ausgeschlossen, Angebotserstellung im freien Ablauf). Das Ziel wurde dabei nirgends durch ein leichteres ersetzt; es steht jeweils als offenes Restziel einer Person da.

## 7. Entfallene und verbliebene Übergaben

* **Entfallen:** „Büro informiert“ als Erfolg für „Monteur informieren“; Neuplanungen, die an Formfehlern scheiterten und den Vorgang ohne erkennbares Anliegen übergaben; stumm verworfene Nachrichten und Korrekturen nach dem Abschluss; sinnlose Rückfragen („Angebotswunsch?“); eine Anliegenzerlegung, die an Zeilenumbrüchen zerbrach (Phantom-Teilvorgang).
* **Verblieben (benannt):** F-B1, F-B2, F-C1 bis F-C3 (Abschnitt 6); die Zusammenfassungszeile im Lead („Anliegen: … nicht genannt“) kann der Liste der Angaben darunter widersprechen; eine Korrektur über das Modell kann den Textwert verkürzt ersetzen („Gasheizung von 1985“ wird „Heizung von 1995“); die Anliegenliste eines Teilvorgangs enthält teils die Anliegen der Geschwister; ein überholter zweiter Planungsversuch kann an einem Teilvorgang eine überflüssige Aufgabe „Planung nicht möglich“ erzeugen.
