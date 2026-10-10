# Autonomie-Bewertung: Kann ORBIT beliebige Anfragen selbstständig verstehen und abarbeiten?

Stand: 10.10.2026 · Methode: 15 realistische Eingänge aus 9 Gewerken/Anlässen, echtes Modell (`gpt-6-luna`), echte Datenbank, frischer Mandant mit dem
mitgelieferten Prozess „Angebotsanfrage“ und der Regel „Rückfragen autonom“. Versand und Kalender sind abgefangen (es geht nichts hinaus). Wiederholbar mit
`LIVE_AI=1 ASSESSMENT_OUT=<Datei> npx jest --config test/jest-e2e.json test/autonomy-assessment.live.e2e-spec.ts` (`apps/api`).

**Grenzen der Bewertung:** simulierter Eingangskanal (kein echter Gmail-Abruf), ein Lauf je Szenario (Modelle antworten nicht immer gleich), ein Mandant mit
Demo-Katalog. Die Ergebnisse zeigen Muster, keine Statistik.

## Ergebnis auf einen Blick

| Ergebnis | Fälle |
|---|---|
| **Selbstständig bis zur Antwort der Kundschaft** (Anfrage verstanden, gezielte Fragen, Mail gesendet, wartet) | 4 von 15: Wärmepumpe, KFZ-Inspektion, Hecke/Rasen, englische Solaranfrage |
| Richtig aussortiert (Newsletter, Lieferantenwerbung) | 2 |
| **Nur eine Aufgabe für einen Menschen – kein Vorgang, keine Antwort an die Kundschaft** | **6**: Dach-Notfall, Wasserrohrbruch, Terminanfrage Elektrik, Reklamation, Bewerbung, Terminverschiebung |
| Falsch zugeordnet, Ablauf bricht mit Meldung ab | 1: „Wann kommt mein Angebot?“ wurde als neue Angebotsanfrage behandelt |
| Vorgang angelegt, aber Mensch nötig | 1: Rechnung ohne Anhang |
| Lead + Aufgabe „Kontaktieren“, die Frage bleibt unbeantwortet | 1: allgemeine Auskunft (Leistungen, Telefonzeiten) |

## Was gut funktioniert

* **Verstehen:** Die **Absicht** wurde in 15 von 15 Fällen richtig erkannt (z. B. „dringende Dachreparatur“, „Terminverschiebung“, „Nachfrage zum Angebot“), auch bei Englisch und bei Gewerken außerhalb des Katalogs. Die feste **Kategorie** passte nicht immer (die Nachfrage zum Angebot wurde als Angebotsanfrage, die Terminverschiebung als „unbekannt“ eingestuft) – ein Grund mehr, nicht von ihr abhängig zu sein.
* **Angebotsanfragen jeder Branche:** Für die vier Fälle lief die ganze Kette ohne Menschen: Verstehen, vorhandene Angaben mit Beleg, gezielte Fragen (z. B. „Wärmeverteilung?“,
  „Welche Inspektion ist fällig?“, „Dachform und Ausrichtung?“), Terminvorschlag, Versand, Warten. Dafür war **keine** Prozessbeschreibung pro Gewerk nötig.
* **Aussortieren:** Newsletter und Werbung lösen keine Arbeit aus.

## Wo es scheitert (mit Ursache im Code)

1. **Nur drei Arten von Eingängen werden bearbeitet.** `triage-decision.ts` enthält eine feste Tabelle (`CATEGORY_DOMAIN_ROUTES`): Angebotsanfrage, Vertriebsanfrage → Vertrieb,
   Eingangsrechnung → Finanzen. Jede andere geschäftliche Anfrage (Notfall, Termin, Reklamation, Bewerbung, Auskunft …) endet in `intake.service.ts` bei
   „*kein Prozess hinterlegt*“ → eine Aufgabe „Prüfung erforderlich“. Es entsteht **kein Vorgang** (keine Historie, keine Fristen, keine Nachverfolgung), und die Kundschaft
   bekommt **keine Reaktion**. Das ist genau das Gegenteil von „ORBIT erkennt, was zu tun ist“.
2. **Notfälle werden wie Post behandelt.** Die Einstufung erkennt „Dach undicht, regnet rein“ und „Rohrbruch“ mit 99 % Sicherheit als dringend – es folgt trotzdem nur ein
   Eintrag in der Aufgabenliste: keine sofortige Bestätigung an die Kundschaft, keine Benachrichtigung der verantwortlichen Person, keine Priorisierung.
3. **Der KI-Planer ist nicht angeschlossen.** `PlannerService` kann ohne Prozessbeschreibung einen Plan vorschlagen (Ad-hoc-Plan), wird aber vom Eingang nie dafür aufgerufen, und
   ein Ad-hoc-Plan wartet **immer** auf menschliche Freigabe (Amendment 02 §11.4), unabhängig vom Risiko der Schritte.
4. **Zu wenige Fähigkeiten.** Das Fähigkeitenverzeichnis hat 9 Einträge (Kontext lesen, Angaben entnehmen, Anforderungen prüfen, Entwurf, Senden, Preis, Angebot erstellen/erzeugen,
   Aufgabe). Es fehlen: **Termin vorschlagen und buchen**, **Eingang bestätigen/antworten** ohne Angebotsbezug, **intern benachrichtigen/eskalieren**, **Auskunft aus dem Betriebswissen
   geben**, **Kontakt/Lead anlegen**, **Status zu einem bestehenden Vorgang melden**, **fehlenden Anhang beim Lieferanten anfordern**.
5. **Kein Betriebswissen.** Es gibt kein Modell für „wie dieses Unternehmen arbeitet“: Branche, Leistungen und Ausschlüsse, Einsatzgebiet, Öffnungs- und Notdienstzeiten,
   Preis- und Terminregeln, Tonalität, Ansprechpartner/Eskalation, häufige Fragen. Die KI kennt nur Firmenname und Leistungskatalog. Deshalb kann sie „Machen Sie auch Fliesenarbeiten?“
   oder „Bis wann sind Sie erreichbar?“ nicht beantworten und nicht entscheiden, was „im Sinne des Unternehmens“ ist.
6. **Keine Zuordnung zur Person/zum bestehenden Vorgang.** Antworten werden über E-Mail-Verweise (Thread, In-Reply-To) zugeordnet, nicht über Absender und offene Vorgänge. „Wann kommt mein
   Angebot?“ oder „Termin verschieben“ finden ihren Vorgang nicht; im Test entstand sogar ein neuer, sinnloser Angebotsvorgang, der abbrach.
7. **Sprache.** Antwortet jemand auf Englisch, geht die Rückfrage trotzdem in deutschem Rahmentext hinaus (`communication-templates.ts`); nur die Fragen sind vom Modell.
8. **Feste Frage-Runde.** Nach einer Rückfrage entscheidet bei Lücken oder Widersprüchen ein Mensch (Blueprint `maxAutoQuestions: 1`).

## Zielbild und Vorschlag

Prinzip: **Jeder geschäftlich relevante Eingang wird ein Vorgang.** Eine KI versteht ihn im Kontext des Betriebs, schlägt aus den vorhandenen Fähigkeiten einen Ablauf vor, und die
**Regeln & Freigaben des Mandanten** (nicht eine pauschale Ad-hoc-Sperre) entscheiden, was ohne Mensch laufen darf. Die bestehenden Sicherungen bleiben: Belege für Angaben, geprüfte
Preise, Freigabe für Geld/Rechtliches, Idempotenz, Audit.

| Stufe | Inhalt | Wirkung |
|---|---|---|
| **P0 – Notfall und Haltung** | Dringlichkeit ernst nehmen: sofortige Bestätigung an die Kundschaft (in deren Sprache), Benachrichtigung der verantwortlichen Person (Mail/Push), Vorgang mit Priorität; **jeder** relevante Eingang bekommt einen Vorgang statt nur einer Aufgabe | Dach-/Rohrbruch-Fälle werden nie mehr „liegengelassen“ |
| **P1a – Betriebsprofil** | „Wie wir arbeiten“: Branche, Leistungen/Ausschlüsse, Einsatzgebiet, Zeiten, Notdienst, Terminlängen, Preisregeln, Tonalität, Ansprechpartner/Eskalation, häufige Fragen. Einrichtung geführt, KI-gestützt (aus eingefügtem Text/Dokumenten) | Gibt der KI das Wissen, um „im Sinne des Unternehmens“ zu entscheiden und Auskünfte zu geben |
| **P1b – Autonomer Vorgangs-Agent** | Statt fester Tabelle: Planer ohne Prozessbeschreibung für alle Eingänge; **Freigabe je nach Risiko der Schritte** (Bestätigen/Fragen/Termin vorschlagen autonom, Geld/Verträge mit Freigabe); bewährte Pläne werden als Prozess vorgeschlagen | Beantwortet die Kernfrage dieser Bewertung |
| **P1c – Fähigkeiten** | Eingang bestätigen/antworten, Termin vorschlagen **und buchen** (Kalender-Schreibzugriff), intern benachrichtigen, Auskunft aus dem Betriebsprofil, Kontakt/Lead anlegen, Statusauskunft, fehlenden Anhang anfordern | Deckt die sechs „nur Aufgabe“-Fälle ab |
| **P1d – Zuordnung** | Absender → Person/offene Vorgänge (Status, Terminverschiebung, Reklamation zu einem Auftrag) | „Wann kommt mein Angebot?“ wird beantwortet statt neu angelegt |
| **P2 – Lernen** | zweite automatische Rückfrage-Runde, Auswertung „Wo greifen Menschen ein?“, Vorschläge aus Korrekturen | Automatisierungsquote steigt messbar |

**Empfehlung:** P0 sofort (klein, sicherheitsrelevant), dann P1a und P1b zusammen (ohne Betriebswissen entscheidet der Agent im Blindflug), P1c/P1d schrittweise je
Anwendungsfall. Mit `handwerkernull@gmail.com` (Betrieb) und `tomorbit777@gmail.com` (Kunde) lässt sich jede Stufe mit echter Mailstrecke abnehmen.

## Offene Entscheidungen (Produkt, nicht Technik)

1. **Wer wird bei Notfällen benachrichtigt, und wie?** (Person, Mail/SMS/Push, Notdienstzeiten)
2. **Was darf ORBIT ohne Freigabe zusagen?** (Eingang bestätigen: ja; Termin buchen; Preise nennen; Notdienst zusagen)
3. **Wer pflegt das Betriebsprofil?** (Einrichtung durch den Inhaber mit KI-Hilfe, laufende Ergänzung durch Korrekturen)
