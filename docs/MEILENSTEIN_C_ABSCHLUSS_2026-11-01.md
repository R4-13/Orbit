# Meilenstein C – Abschluss (01.11.2026)

**Entscheidung des Auftraggebers (01.11.2026):** Meilenstein C ist auf dem Stand `765355d` **im vereinbarten Entwicklungsumfang abgeschlossen**. Die dokumentierte Kombination aus Regressionstests, Mutationsnachweisen, vollständigem Qualitätstor und einem C1-Live-Lauf genügt. Ein weiterer Live-Lauf ist dafür nicht erforderlich. FN-14 gilt damit als abgeschlossen.

Dieser Abschluss **autorisiert keinen Pilot mit echten Kunden** und **keine Erweiterung der bisherigen Autonomieregeln**. Er ist ein Abschluss des Entwicklungsumfangs von Meilenstein C, keine Freigabe für den Betrieb.

Maßgebliche Berichte (historisch, mit allen Fehlläufen und Einschränkungen erhalten):

* `MEILENSTEIN_C_ERGEBNIS_2026-10-26.md` – Meilenstein C auf `ae423fb`
* `MEILENSTEIN_C_NACHBESSERUNG_2026-10-29.md` – Zuordnung der Kundenantwort, C1-Endnachweis auf `f47bfb0`
* `MEILENSTEIN_C_FN14_2026-10-29.md` – Nachbesserung 2 (FN-14), Qualitätstor, C1-Live-Lauf auf `765355d`
* `ASSUMPTIONS.md` #635, #636, #637, #638

## 1. Was geprüft ist – und womit (Nachweisgrenzen)

| Gegenstand | Nachweis | Bezeichnung |
|---|---|---|
| Planwechsel-Reparaturen von FN-14 (alter Plan hält bei wartender Folgerevision, Aufgaben je Arbeit übernehmen/schließen, Freigabebedarf in Hinweisen und Ansicht, erneutes Lesen der Antwort durch übernommene Schritte) | e2e-Tests (`fn14-consistency`, `family-reply`, `case-split`), Mutationsnachweise (vier Verhaltensweisen abgeschaltet → vier Tests rot), vollständiges Qualitätstor (Versuch 11: 79 Suiten, 640 Tests) | **TESTED LOCALLY** (technisch geprüft) |
| Bündelung, Einleitung aus Ereignissen, Wechsel „übergeben → Rückfrage“, Fristanker und Obergrenze 60 Minuten | e2e-Tests, Unit-Tests, Tor | **TESTED LOCALLY** |
| C1 (drei Anliegen in einer Nachricht) mit **echtem Modell, echtem Gmail und echtem CRM** bis zum Endzustand | ein Live-Lauf auf `765355d` (Tom → Musterwerk), gesichert in `abnahme-c1-fn14-765355d.json`, danach ID-genau bereinigt | **LIVE TESTED** (für den dabei durchlaufenen Ablauf) |
| **Freier Planwechsel** (Plan wartet auf Freigabe, während der bisherige läuft; Aufgabenübernahme; Freigabehinweis) | im letzten Live-Lauf **nicht ausgelöst**: das Modell ordnete das Reglerangebot dem hinterlegten Standardablauf zu | **nicht live bestätigt** – darf nicht als live bestätigt bezeichnet werden |

## 2. Abschlussumfang (was „abgeschlossen“ bedeutet)

* **Regler (Angebot für einen neuen Heizungsregler):** Die **Anfrageaufnahme mit bestätigter CRM-Übergabe** ist abgeschlossen (Rückfragen zu den fehlenden Angaben, Antworten in den Fakten, Lead im CRM abgeglichen `SYNCED`). Die **Angebotserstellung bleibt Aufgabe eines Menschen** (offene Aufgabe „Neuen Lead kontaktieren“).
* **Rechnungskopie und Wartungstermin:** bleiben mit ihren **offenen Geschäftszielen** in manueller Bearbeitung (`MANUAL_REVIEW`, je eine offene Aufgabe). ORBIT versendet keine Rechnungskopie und ändert keinen Termin (keine Fähigkeit dafür; Kalender ausgeschlossen).
* **Eine Übergabe ist keine allgemeine Erfüllung des ursprünglichen Kundenwunsches.** Der Hauptvorgang bleibt offen, solange Teilvorgänge bei einer Person liegen; die Kundschaft erhält ehrlich den Stand „übergeben“, nie „erledigt“ für Anliegen, die eine fehlende Fähigkeit brauchen.
* Der kombinierte Fakt (`ai.controller_context` mit „Gas. Der alte Regler ist …“) genügt für diesen nachgewiesenen Übergabeablauf; **eine feinere Faktenstruktur ist keine nachträgliche Abnahmebedingung** (FN-16, getrennt offen).

## 3. Getrennt offen (nicht Teil dieses Abschlusses)

* **FN-15** – Zeitüberschreitungen im vollständigen e2e-Gesamtlauf bei hoher Rechnerlast. **Ursache unbekannt** (Korrelation mit der Basislast: derselbe Stand war bei 65–90 % Basislast mehrfach rot, bei ruhigem Rechner grün; kein Beweis). Betriebsregel: das Tor erst bei ruhigem Rechner starten. `--forceExit` ist Absicherung, kein Nachweis sauber geschlossener Ressourcen.
* **FN-16** – Verbesserungswünsche: erfragte kombinierte Angaben in einzelne Fakten zerlegen; Hinweise des Hauptvorgangs für übergebene Anliegen differenzieren.
* Weiterhin unverändert: kein Pilot mit echten Kunden, keine Freigabe für unbeaufsichtigten Betrieb, Autonomieregeln unverändert, Schatten-Kontingent 61 (Obergrenze 60 wird nie angehoben oder zurückgesetzt), Zahlungsausführung gesperrt.

Was für einen begleiteten Pilot, für unbeaufsichtigten Betrieb und als spätere Verbesserung noch fehlt, steht als Planungsübersicht in `BACKLOG_PILOT_UEBERSICHT_2026-11-01.md` (Vorschlag, noch keine Umsetzung).
