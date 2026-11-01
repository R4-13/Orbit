# Offene Arbeiten nach Meilenstein C – priorisierte Übersicht (Planungsvorschlag, 01.11.2026)

> **Verdichtet und teilweise überholt durch** [`PILOT_VORBEREITUNGSPAKET_2026-11-01.md`](PILOT_VORBEREITUNGSPAKET_2026-11-01.md) (konkreter Pilotumfang, angerechnete Nachweise, Aufteilung vor/während/nach, D9-Prüfplan). Diese Übersicht bleibt die allgemeine Backlog-Sicht; für die nächsten Schritte gilt das Paket.

**Zweck:** kurze Entscheidungsgrundlage nach dem Abschluss von Meilenstein C (`MEILENSTEIN_C_ABSCHLUSS_2026-11-01.md`). Abgeleitet **ausschließlich aus dem vorhandenen Backlog** (`OPEN_DEVELOPMENT_ITEMS.md`, Punkt-IDs dort), dem Konzept `KONZEPT_FLEXIBLE_AUTONOMIE_2026-10-18.md` (§9 Einführungsstufen, §9.2 Messung D9, D4, D7) und den Abnahmeberichten. **Nichts davon ist begonnen; es ist keine Umsetzungsfreigabe.** Bereits abgenommene Punkte (u. a. Meilenstein B, C, FX-01/02/18/19/20, Lead-Abgleich) werden nicht erneut geöffnet.

**Dieser Abschluss und diese Übersicht autorisieren keinen Pilot mit echten Kunden und keine Erweiterung der Autonomieregeln.**

Legende Art: **E** Entwicklung · **N** Nachweis/Messung · **B** Entscheidung/Betrieb des Auftraggebers · **X** externe Zustimmung/Zugangsdaten. Wo der Nachweisstand im Backlog nicht eindeutig ist, steht „vorab prüfen“.

## A. Fehlt für einen **begrenzten, begleiteten Pilot** (Konzept Stufe 2: Mandant `Musterwerk`, Vorgangsart Angebotsanfrage, Mensch begleitet jeden Vorgang)

| # | Punkt (Backlog-ID) | Art | Fehlender Nachweis / fehlende Fähigkeit | Abschlussbedingung |
|---|---|---|---|---|
| A1 | **Einstiegshürde D9 / Schattenbetrieb** (FX-04) | N, B | Das Schatten-Kontingent ist mit 61 von 60 verbraucht (nie zurückgesetzt); die Auswertung der Schattenplanungen steht aus. Der 60-Fälle-Messlauf vom 21.10. war diagnostisch (gemischte Codestände), keine Abnahme. Es fehlt ein bewerteter Lauf auf einem festen aktuellen Stand. | **Entscheidung des Auftraggebers** zu Kontingent/Vorgehen (Obergrenze wird nicht von mir angehoben); danach Bericht: ≥ 60 bewertete Fälle, jedes vereinbarte Szenario mindestens einmal, kritische Fälle (Notfall, Phishing, eingeschleuste Anweisung, Pflichtfreigaben, Doppelwirkung) ≥ 3×, Kennzahlen je Szenariotyp, **Muss-Kriterien 100 %**, keine harte Grenzverletzung |
| A2 | **Unbekannte Vorgänge und Ereignisse ohne Nachricht zusätzlich abnehmen** (D7; FX-01 live belegt, FX-03 nur teilweise) | N, E | Der Pilot beweist nur den Angebotsbereich. Offen bei Ereignissen ohne Nachricht: Aufgabe mit zusätzlicher Erinnerung, Wiederkehr, Erinnerung an Dritte (FX-03). | Abnahmebericht für unbekannte Vorgänge und für die Ereignisarten, die im Pilot zugelassen werden; nicht abgenommene Arten sind im Pilot ausdrücklich gesperrt oder gehen an einen Menschen |
| A3 | **Dauerhafte Mail-Verbindung** (INT-04, FN-11) | X | Google-Zustimmung läuft im Testmodus nach 7 Tagen ab; nur der Auftraggeber kann „In production“ setzen. | Verbindung läuft ≥ 14 Tage ohne manuelle Erneuerung (deckt den Beobachtungszeitraum) |
| A4 | **Notfall-Hinweis Gas** (FX-10, P1) | B, E | Gasspezifischer Sicherheitshinweis neben „Notruf 112“ fehlt; Inhalt muss der Betrieb freigeben. | abgestimmter Text im Notfallverfahren + Test; Freigabe des Betriebs dokumentiert |
| A5 | **Zuständigkeiten und Mitarbeiterverzeichnis** (FN-06) | B | „Monteur informieren“ bleibt eine Übergabe mit offenem Restziel, solange `DISPATCH`/Monteure nicht gepflegt sind. | Verzeichnis von Musterwerk gepflegt; jede Meldung erreicht nachweislich eine benannte Person |
| A6 | **Sicht für die begleitende Person** (FN-10) | E | Abgleichstand des Leads (SYNCED/FAILED/CONFLICT) und Konflikt-Hinweis stehen nur in Status/Hinweisen/Ereignissen, nicht in der Oberfläche. | Anzeige in Lead-Detail und Vorgangsansicht, mit Test |
| A7 | **Notbremse und Rückfall im Zielsystem** (Konzept §9.1: `planner.adaptive`, Neuaufnahme stoppen vorhanden) | N | Im Backlog nicht als Probe im Zielsystem mit laufenden Vorgängen nachgewiesen – vorab prüfen. Die „ausdrückliche Übernahme“ eines Vorgangs ist **nicht gebaut** (FX-17, laut Konzept erst vor einer Ausweitung nötig). | dokumentierte Probe: Neuaufnahme stoppen und Notbremse mit laufenden Vorgängen (nichts geht verloren, keine Wirkung ohne Freigabe) |
| A8 | **Sicherung und Wiederherstellung** (TEC-08) | E, N | Sicherungs-Zeitplan und MinIO-Sicherung offen; Wiederherstellung nur lokal erprobt. | Zeitplan läuft; Wiederherstellung auf Wegwerf-Datenbank belegt (`verify`); MinIO-Sicherung belegt |
| A9 | **Zuverlässiges Prüftor für Änderungen im Pilot** (FN-15, TEC-06) | E, N | Ursache der Zeitüberschreitungen **unbekannt**; ein grünes Tor gelingt derzeit nur bei ruhigem Rechner. Änderungen im Pilot brauchen ein reproduzierbares Tor. | Ursache geklärt **oder** ein festgelegtes, dokumentiertes Torverfahren, das bei definierter Last reproduzierbar grün ist (ohne Zeitlimits pauschal zu erhöhen) |
| A10 | **Kosten sichtbar** (FX-16) | B | Modellpreis am KI-Profil fehlt, `estimated_cost` bleibt leer. | Preis hinterlegt; Kosten je Vorgang in Euro auswertbar (Kostenlimit BPF-01 wirkt nur mit gepflegtem Profil) |
| A11 | **Beobachtungszeitraum** (D9) | N | Zwei Wochen im Pilot; ersetzt die Fallzahl nicht. | Bericht nach zwei Wochen mit Eingriffen, Fehlern, Kosten (Eingriffsbericht `/admin/interventions` vorhanden) |

Nicht Teil des Pilot-Muss, weil Finance laut Entscheidung vom 18.10. nachrangig ist: Rechnungspfad live (MST-02), echte OCR (MST-03), DATEV/Lexware (MST-04). Falls der Pilot Rechnungen im Postfach sieht, müssen diese nachweislich als Übergabe an einen Menschen enden – **vorab klären**, ob Finance im Pilot ausgeschlossen wird.

## B. Fehlt für **unbeaufsichtigten Betrieb** (zusätzlich zu A; nie automatisch nach dem Pilot)

| # | Punkt (Backlog-ID) | Art | Fehlender Nachweis / fehlende Fähigkeit | Abschlussbedingung |
|---|---|---|---|---|
| B1 | **Lockerung der Planfreigabe** (D4) | B, N | Schreibende Wirkungen unbekannter Vorgänge warten bewusst auf die Planbestätigung durch einen Menschen. Ohne diese Freigabe kein unbeaufsichtigter Betrieb. | ausdrückliche, begrenzte Entscheidung je Mandant, Aktionsumfang und Risiko, begründet durch Pilotergebnisse; als Entscheidung dokumentiert |
| B2 | **Belegte Zuverlässigkeit über die Fallzahl hinaus** (AUT-01, BPF-05, PLT-08) | N | Größere Stichproben, weitere Modelle, zweiter echter KI-Anbieter (heute ein Anbieter im Betrieb), laufende Qualitätsmessung. | Pilotdaten + Auswertung mit festen Gütekriterien; Ausfall des KI-Anbieters führt nachweislich zu begründeter Übergabe (FX-19 vorhanden) |
| B3 | **Eskalation und Meldewege** (AUT-05 Rest, AUT-06) | E, X | Meldungen an Personen gehen heute ehrlich nur per E-Mail; Meldung beim Warten auf Kundschaft/Systeme und weitere Kanäle offen. | Eskalationskette mit Nachweis, dass ein unbeachteter Vorgang eine Person erreicht |
| B4 | **Rücklesung und Koordination der Wirkungen** (FX-08 Rest, FX-07) | E, N | Rücklesung für Versand und CRM offen; Wirkungsschlüssel nicht live nachgewiesen. | Rücklesung je Fähigkeit; Doppelwirkung im Zielsystem ausgeschlossen (live belegt) |
| B5 | **Übernahme eines Vorgangs** (FX-17) | E | Ausdrücklicher Befehl (Plan beenden, Belege übernehmen) nicht gebaut. | gebaut und getestet; begonnene Wirkung wird nie im Altweg neu gestartet |
| B6 | **Sicherheit und Betrieb** (MST-09, MST-10, MST-12, PLT-02, TEC-09, INT-01) | E, X | Virenscan für Uploads, Webhook-Signaturen (sobald ein Anbieter sendet), CI auf echtem Runner, MFA-Pflicht/Passkeys, kalibrierte Alarme, aktives Health-Monitoring. | je Punkt im Backlog formulierte Bedingung erfüllt und geprüft |
| B7 | **Last** (UNI-01) | N | Schreiblast, mehrere Instanzen, Produktionsdatenbestand nicht gemessen; zwei Lese-Routen über Budget. | Lasttestbericht innerhalb der Budgets |
| B8 | **Weitere Vorgangsarten** (Stufe 3: Beschwerde FX-05, Bewerbung, Lieferantenangebot, Rechnungseingang MST-02/03/04) | E, X, N | Je Art eigene Fähigkeiten und Abnahme; Rechnungspfad braucht echte OCR/Finanzsystem. | je Art wie Stufe 2 abgenommen; nur abgenommene Arten laufen unbeaufsichtigt |
| B9 | **Fähigkeiten für übergebene Anliegen** (FN-07) | B, E | Dokumentkopie versenden, Terminänderung (Kalender bisher ausgeschlossen), Angebotserstellung im freien Ablauf – nur nach Entscheidung des Auftraggebers. | Entscheidung; bei Ja: Fähigkeit mit Richtlinie, Rücklesung und Abnahme |

## C. **Spätere Verbesserungen** (kein Abnahmehindernis)

* **FN-16** (kombinierte Angaben in einzelne Fakten zerlegen; Hinweise des Hauptvorgangs differenzieren), **FN-12** (Beschriftung freier Angaben im Lead), **FN-05** (Responses-Schnittstelle, Modellvergleich).
* Sprache und Anrede (AUT-07 Rest, FX-11), Statusfrage mit mehrdeutigem Bezug (FX-12), Nachfassen vor der Übergabe (FX-13), Kundenstamm-Nutzung (AUT-08, AUT-03), Administration/Unternehmensprofil (FX-14).
* Oberfläche: manuelle Barrierefreiheitsprüfung (UX-02), Vertiefung der Unterseiten (UX-04), Seitenwechsel/Suche (UX-05), Kurz-Kennung (UX-06), Plattform-UI (PLT-01), Plan-Editor (BPF-07).
* Integrationen und Plattform: Lexware/DATEV (AUT-09, MST-04), Microsoft 365 (MST-05), Telefonie (MST-01), Preisquelle aus ERP (BPF-06), Systemlandkarte/mehrere Konten (INT-02/03), Mandantenlebenszyklus (PLT-06), Sonde-Erweiterungen (SON-01/02).
* Technische Schulden: große Dienste aufteilen (TEC-04), `next build` unter Windows (TEC-05), Routine-Wiederholung der Playwright-/Live-Suiten (TEC-10).

## Vorschlag zur Reihenfolge (zur Entscheidung, nichts begonnen)

1. **Zuerst Entscheidungen des Auftraggebers** (kosten keine Entwicklung): Schatten-Kontingent/Vorgehen (A1), Pilotumfang inkl. Finance ausgeschlossen ja/nein, Google „In production“ (A3), Gas-Hinweistext (A4), Pflege des Verzeichnisses (A5), Modellpreis (A10).
2. **Dann kleine Entwicklung/Nachweise für den begleiteten Pilot:** A6, A7, A8, A9, danach A2.
3. **Danach A1 (bewerteter Lauf)** auf dem dann festen Stand; erst nach bestandenem A1 würde ein begleiteter Pilot zur Entscheidung stehen (mit A11 als Beobachtung).
4. **B-Punkte** erst auf Grundlage von Pilotdaten; **C** bei Bedarf.
