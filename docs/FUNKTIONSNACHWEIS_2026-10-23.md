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
