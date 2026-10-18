# Konzeptvorschlag: flexible, autonome Bearbeitung und schlanke Administration

Stand: 2026-10-18. **Vorschlag, noch nicht beschlossen.** Er baut auf den Entscheidungen vom 18.10. auf (`ASSUMPTIONS.md` #619) und auf der Analyse
[`CODE_ANALYSIS_2026-10-18.md`](CODE_ANALYSIS_2026-10-18.md).

## 1. Zielbild – das gemeinsame Verständnis

ORBIT arbeitet wie eine Mitarbeiterin mit Vollmacht, die entlastet und – wo es der Betrieb will – Aufgaben ganz übernimmt:

* Die KI **erkennt, worum es geht, und entscheidet selbst, was als Nächstes passiert** – fragen, Termin vorschlagen, jemanden einschalten, übergeben, warten, die Planung ändern, wenn
  sich etwas ändert (neue Antwort, anderer Wunsch, zweites Anliegen, Eingriff eines Menschen).
* Die **Engine sorgt dafür, dass es sicher geschieht:** nur erlaubte Fähigkeiten, Nachweis jeder Wirkung, Wiederholung bei Ausfall, Übergabe an einen Menschen bei Unsicherheit.
* **Flexibel im Urteil, verlässlich in der Ausführung.** Beides ist nötig; ein starrer Ablauf erfüllt das erste nicht, eine Freiheit ohne Prüfung das zweite nicht.

### Freiheitsgrade der KI

| Stufe | Was | Wer legt fest |
|---|---|---|
| **Frei** (immer) | Einordnen, zusammenfassen, Kunden nachschlagen, Reihenfolge wählen, neu planen, Fragen ableiten, Texte entwerfen, Notizen/Aufgaben anlegen, Termine vorschlagen | Plattform (fest) |
| **Nach Autonomiegrad** | Mails an die Kundschaft senden (Bestätigung, Rückfrage, Auskunft), Termin buchen, Kontakt/Anfrage im CRM anlegen, Mitarbeitende informieren, Folgenachrichten | **der eine Schalter** des Betriebs (Vorsichtig · Ausgewogen · Hochautomatisiert) |
| **Immer ein Mensch** | Zahlungen ausführen, geänderte Bankverbindung eines Lieferanten, Preise ohne belegte Quelle, Löschen, Änderungen an Einstellungen, Rechtliches/Beschwerden mit Folgen | Plattform (fest) |
| **Abgabe bei Unsicherheit** | geringe Sicherheit, Widerspruch in den Angaben, Notfall, außerhalb der Rolle, mehrfach gescheiterte Wiederholung | Plattform (fest), Schwellen je Stufe |

**Leitplanken bleiben fest** und sind keine Einstellung: keine Preise und Zusagen ohne Beleg; Nachweis jeder Wirkung; Obergrenzen (Rückfragen, Schritte, Kosten, Ausfallzeit);
Prüfung aller Kundentexte auf Links, Adressen, Zahlungsaufforderungen und unbelegte Zusagen; Mandantentrennung.

## 2. Überprüfung der Administration (gemessen am 18.10.2026)

**Befund:** 15 Seiten, rund **52 Eingabefelder und 51 Auswahlen/Schalter** allein in der Ausgangsansicht (beim Aufklappen mehr), davon **31 einzelne Regel-Schalter**.
Vieles ist für einen Betrieb weder verständlich noch nötig; manches gehört dem Betreiber.

**Grundsatz:** *Ein Betrieb stellt nur ein, was die KI nicht wissen kann* – Fakten über den Betrieb, wie viel Vollmacht, seine Zugänge. Alles andere leitet die KI ab, legt die Plattform fest oder
ist Sache des Betreibers.

| Seite heute | Messung | Empfehlung |
|---|---|---|
| Einrichtungsassistent | Führung | **bleibt** – Einstieg und Übersicht |
| Unternehmensprofil | 24 Felder, 17 Auswahlen | **verkleinern:** ein Freitext „Beschreiben Sie Ihren Betrieb“ (KI zieht Branche, Leistungen, Ausschlüsse, Fragen/Antworten heraus – die Funktion „Profil vorschlagen“ gibt es), dazu nur Öffnungszeiten, Notdienst, Einsatzgebiet. **Entfällt:** Ton (immer professionell), Sprachen (KI antwortet in der Sprache der Anfrage), „Eigene Grenzen“ (4 Obergrenzen – Plattform), Eskalationszeiten (Standard; nur unter „Erweitert“) |
| Mitarbeiter | Verzeichnis, CSV | **bleibt** (die KI kann nicht wissen, wen sie wofür erreicht) |
| Regeln & Freigaben | **31 Schalter** | **ein Schalter** (Autonomiegrad) als Hauptsache. Darunter „Erweitert“ mit **etwa 6 verständlichen Gruppen** statt 31 technischer Namen (siehe unten) |
| Systeme & Verbindungen | Gmail, Kalender, HubSpot … | **bleibt** (Zugänge kann nur der Betrieb herstellen) |
| Benutzer & Rollen | Liste | **bleibt**; Rollen auf Administrator · Mitarbeiter · Nur Lesen vereinfachen (zu prüfen) |
| Erscheinungsbild | 19 Felder | in **Unternehmen** als Abschnitt; Logo und eine Farbe genügen im Normalfall, Rest „Erweitert“ |
| Unternehmen & Einstellungen, Datenaufbewahrung, Zugriffsschlüssel | Stammdaten, DSGVO, Schlüssel | **zusammenlegen** zu **Unternehmen** (Reiter) – selten benutzt |
| Wo greifen Menschen ein? | Bericht | **kein Einstellungspunkt:** als Bericht unter Auswertungen/Startseite |
| KI & Modelle | Schlüssel eintragen (BYOK) | **nur Betreiber** (Menüpunkt für Betriebe aus; Code ruht) |
| Prozesse, Agenten, Abläufe | technische Definitionen | **nur Betreiber/Experten** (aus dem Mandantenmenü; für den Betrieb nicht nötig, wenn die KI selbst plant) |

**Ergebnis:** von **15 auf etwa 6 Seiten** (Start/Einrichtung · Unternehmen · Mitarbeiter · Verbindungen · Autonomie · Benutzer), rund **100 auf etwa 35 Einstellungen**, der Rest unter „Erweitert“
oder beim Betreiber.

### Die 31 Regeln – was davon ist eine Entscheidung des Betriebs?

Von den 31 Schaltern sind etwa **19 reine Technik** (zum Beispiel `process.plan`, `requirements.resolve`, `pricing.resolve`, `quote.render`, `calendar.read`, `context.lookup`,
`email.classify`, `email.triage`, `email.draft`, `copilot.read`, `booking_proposal.create`): Sie nur zu *sehen* hilft niemandem, sie sind immer erlaubt oder gehören zu einer Gruppe.
Wirkliche Entscheidungen mit Wirkung nach außen sind rund 12, die sich zu **sechs Gruppen** fassen lassen:

1. **Kundenkommunikation** (Bestätigung, Rückfrage, Auskunft, Angebotsversand, Folgenachricht)
2. **Termine** (vorschlagen = frei, **buchen** = Entscheidung)
3. **CRM und Kontakte** (anlegen, Aktivität)
4. **Mitarbeitende informieren**
5. **Rechnungen und Buchhaltung** (Übertragung)
6. **Lieferanten** (anlegen, Bankdaten ändern; Bankdaten ändern bleibt **immer** Mensch; **Zahlung ausführen** ist gesperrt)

Der Autonomiegrad setzt alle sechs sinnvoll vor; wer will, passt eine Gruppe an.

## 3. Wie die Umsetzung zu flexibler, autonomer Bearbeitung aussehen soll

### Befund zur Technik (Kern der Starrheit)

* Eingehende Mails werden nach einer **geschlossenen Kategorienliste** einem festen Ablauf zugeordnet; heute gibt es nur **einen** (Angebotsanfrage). Alles andere geht in den älteren Weg
  (Agenten/Workflows) oder zum freien Planer.
* Der Angebotsablauf ist eine **vorgebaute Kette** (27 Schritte, drei Rückfragerunden vorab ausgelegt).
* Der **freie Planer darf die stärksten Fähigkeiten nicht nutzen:** Analyse der Anfrage, Ableiten fehlender Angaben, Auslesen von Antworten, Preise und Angebote sind an feste Abläufe gebunden.
* Kundentexte sind **feste Vorlagen** im Code.

### Vorschlag: der Vorgangs-Agent wird der Normalfall, feste Abläufe werden Leitfäden

* **Vorgangs-Agent:** Für jeden Eingang plant die KI die nächsten Schritte aus den Fähigkeiten, die der Betrieb **tatsächlich hat** (Verbindungen, Regeln), prüft den Plan deterministisch,
  führt aus, wartet, plant neu bei jedem Ereignis.
* **Leitfaden** statt Schiene: Ziel · Grenzen · bewährte Reihenfolge · was zu übergeben ist. Die KI darf abweichen, solange die Grenzen halten. Leitfäden schreibt die Plattform (nicht der Betrieb).
  Der heutige Angebotsablauf wird der erste Leitfaden.
* **Alle Fähigkeiten für den freien Planer:** Analyse, Auslesen von Antworten und Anforderungsermittlung werden allgemein verfügbar; Preise/Angebote bleiben an eine belegte Preisquelle gebunden.
* **Kundentexte schreibt die KI** (professionell, Sie-Form, Sprache der Anfrage), danach die bestehende Prüfung auf unzulässigen Inhalt; Wortlaut und Begründung stehen im Verlauf.
* **Anbindungen:** weiter über die festen Schnittstellen; neue Adapter erst nach der Stabilisierung und je Bedarf eines Betriebs.

### Reihenfolge

| Schritt | Inhalt | Ergebnis |
|---|---|---|
| **0 Messlatte** | Abnahmematrix mit den 19 Testszenarien durch die **heutige** Verarbeitung; Kennzahlen: richtig bearbeitet · Eingriffsquote · Dauer · unzulässige Zusagen (soll 0 sein) | Vergleichswert, ohne den „besser“ nicht belegbar ist |
| **1 Schlank machen (unabhängig, sofort möglich)** | BYOK und technische Seiten aus dem Mandantenmenü; Regeln auf Autonomiegrad + 6 Gruppen; Profil als Freitext; Ton/Sprachen/Grenzen entfernen | Weniger Einstellungen, klarere Rollen |
| **2 Vorgangs-Agent im Schattenbetrieb** | Der neue Planer plant parallel mit, führt aber nichts aus; Vergleich mit Schritt 0 | Belegte Gleichwertigkeit oder Verbesserung, ohne Risiko |
| **3 Umschalten, Angebotsablauf als Leitfaden** | Der Vorgangs-Agent übernimmt den Angebotsweg; Texte durch die KI | Flexibler Normalfall |
| **4 Weitere Vorgangsarten** | Auskunft, Beschwerde, Bewerbung, Lieferantenangebot, Rechnungseingang (zuletzt) als Leitfäden; Altweg ausschalten | Ein einheitliches Verhalten |
| **5 Lernen aus Eingriffen** | Korrekturen und Ablehnungen fließen als Vorschläge zurück (Grundlage: Bericht „Wo greifen Menschen ein?“) | Weniger Eingriffe über die Zeit |

**Parallel (Stabilisierung):** Ausfall live belegen, Freigaben-Liste mit Filtern, Alterung von Vorgängen, Konten (Passwort zurücksetzen, Kontosperre, MFA für Administratoren und Betreiber).

### Risiken und Gegenmaßnahmen

* **Weniger Vorhersehbarkeit durch freies Planen** (die KI-Einstufung war zuletzt zu 83,8 % konsistent): Schattenbetrieb, Messlatte, Plan-Prüfung bleibt deterministisch, Obergrenzen bleiben.
* **Mehr KI-Aufrufe und Kosten:** Kostenlimit je Vorgang wirkt bereits; Messung je Szenario.
* **Texte der KI:** Prüfung auf unzulässige Zusagen bleibt Pflicht; Stichproben im Verlauf; bei Unsicherheit Übergabe.
* **Umbau des Kerns:** schrittweise, jeder Schritt mit Rückfallmöglichkeit auf den vorherigen Weg.

## 4. Entscheidungen, die ich brauche

1. Freiheitsgrade und Leitplanken wie in Abschnitt 1 – einverstanden?
2. Administration verschlanken wie in Abschnitt 2 (von 15 auf etwa 6 Seiten, 31 Regeln auf einen Schalter plus sechs Gruppen)?
3. Reihenfolge wie in Abschnitt 3 – mit **Messlatte (Schritt 0) zuerst**?
