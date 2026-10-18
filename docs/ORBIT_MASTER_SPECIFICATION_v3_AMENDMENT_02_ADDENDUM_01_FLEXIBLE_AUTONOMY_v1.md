# Amendment 02 – Addendum 01: Flexible, autonome Bearbeitung (v1)

Stand: 2026-10-18. Status: **verbindlich** (Entscheidung des Auftraggebers vom 18.10.2026). Scope: ergänzt `ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_02_BUSINESS_PROCESS_ORCHESTRATION_FRAMEWORK_v1.2.md`
(im Folgenden **A02**). Die ausführliche Begründung, der Code-Befund und die Abnahmematrix stehen in
[`KONZEPT_FLEXIBLE_AUTONOMIE_2026-10-18.md`](KONZEPT_FLEXIBLE_AUTONOMIE_2026-10-18.md) (Fassung 2.1) – **dieses Addendum definiert nichts davon neu**, sondern referenziert und ergänzt nur dort, wo A02 schweigt.

## 0. Regeln dieses Addendums

1. Es gilt A02 v1.2 unverändert. Wo dieses Addendum einen A02-Abschnitt nennt, **konkretisiert** es ihn; es hebt keinen auf.
2. Es entsteht **keine zweite Orchestrierungsarchitektur, keine zweite Policy-Enum und keine zweite Zustandsmaschine** (A02 §32.1; Governance §4–§6). Begriffe: *Leitfaden* = Blueprint, *Vorgangs-Agent* = Orchestrator + Planer, *Vollmacht* = Policy + Einschränkungen, *Autonomiegrad* = Voreinstellung.
3. Neue Persistenz nur nach Governance §5.3.

## 1. Ereignisse (A02 §5, §13, §29.1)

**ADD-1.1** Ausgangspunkt eines Vorgangs ist ein **Geschäftsereignis**; eine eingehende Nachricht ist eine Unterart. Der Auftragseingang ist eine Vorgangsart, E-Mail und Telefon sind Kanäle.
**ADD-1.2** Geschäftsereignisse laufen durch den **vorhandenen** Eingang (`CaseEvent` mit `inbound`/`dedupeKey`) und dieselbe Zuordnungsentscheidung. Jedes Ereignis hat Quelle, Eindeutigkeitsschlüssel und Zeitpunkt.
**ADD-1.3** Die verfügbaren Ereignisquellen sind im Betrieb sichtbar. Quellen: Nachricht, Auftrag/Aufgabe über Sonde oder System, Frist/fehlende Antwort, Überwachung laufender Vorgänge, technische Übertragungsfehler, Personal (zunächst manuell/Sonde durch berechtigte Personen), Änderungen in angebundenen Systemen (nur nach offizieller Herstellerdokumentation und nach Stabilisierung des Auftragseingangs).

## 2. Ziel, Abschluss, Leitfäden (A02 §7, §11.4, §28, §34)

**ADD-2.1** Ein fehlender Leitfaden blockiert nie. Aus Ziel, Kontext und tatsächlich verfügbaren Fähigkeiten muss ein zulässiger Plan entstehen; schreibende Wirkungen unbekannter Vorgänge bleiben **planfreigabepflichtig** (A02 §11.4). Eine Lockerung erfolgt nur ausdrücklich und begrenzt nach Mandant, Aktionsumfang und Risiko auf Basis nachgewiesener Ergebnisse, nie automatisch.
**ADD-2.2** Ein Plan endet nur in einem zulässigen Endzustand: *Ziel erreicht (belegt)*, *Wartepunkt mit Frist und Fortsetzungsregel*, *Freigabe angefordert*, *Übergabe mit Begründung*.
**ADD-2.3** **Abschlusskriterien gehören zum Ziel** und gelten für alle Planrevisionen. Eine Revision darf sie weder streichen noch abschwächen; eine Lockerung ist nur durch eine begründete menschliche Entscheidung möglich (A02 §33.3, §34). Eine Zusammenfassung oder Aufgabe schließt nur ab, wenn sie das vereinbarte Ziel *ist*.
**ADD-2.4** Eine fehlende technische Fähigkeit oder Vollmacht wird **ausdrücklich festgestellt** und führt zu einer begründeten Übergabe mit Hinweis im Einrichtungsassistenten.
**ADD-2.5** Verstehende Fähigkeiten (Auslesen von Angaben, Anforderungsermittlung) stehen allen Plänen offen. Preise und Angebote bleiben an eine belegte Preisquelle gebunden (siehe ADD-4.2).

## 3. Zuordnen, Aufteilen, Koordination (A02 §13, §33)

**ADD-3.1** Je Ereignis wird entschieden: *neuer Vorgang · ergänzt/ändert bestehenden · mehrere Anliegen · betrifft mehrere Vorgänge*. Mehrere Anliegen werden als eigene Ziele geführt, nichts geht verloren.
**ADD-3.2** Mehrfachzuordnung erzeugt je Vorgang ein Ereignis, aber **keine zusätzlichen oder widersprüchlichen Wirkungen**. Neben dem Schutz je Vorgang gilt eine **Koordination auf Objekt- und Aktionsebene** (Wirkungsschlüssel *Fähigkeit + Zielobjekt + Wirkung*; Empfänger/Anlass; gemeinsame Termine, Aufträge).
**ADD-3.3** Ein eigener persistenter Bezug zwischen Vorgängen ist zulässig, wenn die Beziehung sonst nicht zuverlässig, nachvollziehbar und dauerhaft abbildbar ist; Begründung nach Governance §5.3.

## 4. Aktionsklassen und Zuverlässigkeit (A02 §14, §29.3, §32)

**ADD-4.1** Jede Aktion gehört zu **einer** von drei Klassen: **gesperrt** (`DISABLED`/Plattformregel), **nach menschlicher Freigabe** (`REQUIRE_APPROVAL`), **autonom innerhalb der Vollmacht** (`AUTONOMOUS` mit Einschränkungen). Zahlungsausführung ist in dieser Ausbaustufe gesperrt.
**ADD-4.2** Eine Freigabe bestätigt eine Handlung, sie macht aus einem Preis ohne Quelle **keinen belegten Preis**. Eine berechtigte Person kann den Preis ausdrücklich festlegen (Fakt, Herkunft `HUMAN`, Person, Zeitpunkt); damit entsteht die nachvollziehbare Quelle.
**ADD-4.3** Vor jeder wirksamen Aktion: Berechtigung, **aktuelle Voraussetzungen**, mögliche Doppelverarbeitung. Danach: **tatsächliche Wirkung prüfen** (Rücklesung). Eine Zeitüberschreitung löst **keinen blinden Wiederholungsversuch** aus (`OUTCOME_UNKNOWN` bleibt bis zum Abgleich).
**ADD-4.4** Externe Inhalte überschreiben keine inneren Regeln oder Vollmachten. Lernen aus Korrekturen erzeugt ausschließlich **Vorschläge** und erweitert nie von selbst Berechtigungen.
**ADD-4.5** Betriebsregeln für Sprache und Ansprache setzt der Mandantenadministrator; sie gelten auch für besondere Nachrichtenarten, überschreiben aber nie fachliche Pflichtinhalte oder Sicherheitsregeln.

## 5. Einführung und Rückfall (Plattform: A03 §6, §15)

**ADD-5.1** Reihenfolge: Festschreiben → Messlatte (Ist-Zustand) → Schattenbetrieb (**bewertet die Planung**) → begrenzte aktive Einführung (Pilot `Musterwerk`/Angebotsanfrage; **aktive kontrollierte Tests bewerten die Ausführung**) → schrittweise Ausweitung. Der Pilot beweist zunächst nur seinen Anwendungsbereich; unbekannte Vorgänge und Ereignisse ohne Nachricht sind zusätzlich abzunehmen.
**ADD-5.2** Rollout und Notbremse nutzen die vorhandenen Mittel (Feature-Flags, Kohorten, Kill-Switch `planner.adaptive`); keine zweite Rollout-Technik.
**ADD-5.3** **Genau ein Bearbeitungsweg je Vorgang.** Der Weg wird beim Anlegen festgelegt und gespeichert; der Schalter wirkt auf **neue** Vorgänge. Kein Vorgang wird gleichzeitig von Alt- und Neuweg bearbeitet. Ein Wechsel erfolgt nur durch ausdrückliche Übernahme (Plan wird mit Begründung beendet, vorhandene Belege, Freigaben und Wirkungen bleiben); begonnene Wirkungen führen zur Übergabe an einen Menschen, nicht zum automatischen Neustart im anderen Weg.

## 6. Administration und KI-Anbieter (UI/UX v2 §19; A03 §10)

**ADD-6.1** Die Administration bleibt in den Gruppen von UI/UX v2 §19. Autonomiegrad und sechs Gruppen sind **Darstellung** über den Policy-Aktionen; Aktionen ohne Gruppe fallen auf eine sichtbare Standardregel „Freigabe“. Migration bestehender Regeln ist nachvollziehbar und **nie lockerer** als der Bestand. Geschäftsgrenzen bleiben sichtbar und einstellbar; Plattformobergrenzen sind fest.
**ADD-6.2** Aus einem Freitext-Profil abgeleitete Fakten, Ausschlüsse und Zuständigkeiten sind sichtbar, korrigierbar und gelten als Vorschlag; fachliche Vollmachten entstehen daraus nie ungeprüft.
**ADD-6.3** **BYOK** (A03 §10, OPS-09/10) ist eine **vom Betreiber je Mandant freigegebene Option, Standard AUS** (Flag `ai.byok`, fail-closed). Die Sperre gilt **serverseitig**. Bestehende Daten bleiben erhalten; freigegebene Anbieter und Modellprofile gibt allein der Betreiber vor.

## 7. Abnahme (A02 §34; Konzept Abschnitt 13)

**ADD-7.1** **Muss-Kriterien** gelten in jedem entsprechenden Fall zu 100 %: Pflichtfreigaben, Mandantentrennung, zwingende sicherheitsrelevante Übergaben. Allgemeine Quoten eröffnen dafür keine Ausnahme.
**ADD-7.2** **Null-Kriterien:** unzulässige oder unbelegte Links, Zahlungsinformationen und Zusagen; Doppelaktionen und widersprüchliche Wirkungen; gleichzeitige Bearbeitung durch zwei Wege.
**ADD-7.3** Zielerreichung und gerechtfertigte Übergabe werden **getrennt** gemessen; alle Kennzahlen werden **je Szenariotyp** ausgewiesen. Weniger menschliche Eingriffe ist allein kein Erfolgsnachweis.
**ADD-7.4** Einstiegshürde: mindestens 60 bewertete Fälle, volle Szenarioabdeckung inkl. wiederholter kritischer Fälle; zwei Wochen sind Beobachtung, kein Ersatz. Die Fallzahl ist kein allgemeiner Zuverlässigkeitsnachweis.
