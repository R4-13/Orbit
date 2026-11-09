# Technische Pilotvorbereitung – Übergabe- und Abschlussnotiz (09.11.2026)

**Branch:** `wip/pilot-technik-2026-11` · **Basis:** `78c4992` (main) · **Geprüfter Stand:** `cf4f2c9` (alle Code-Änderungen; danach nur Dokumentation). **Dies ist keine Abnahme und keine Freigabe für Merge oder Deployment.** Keine Zugangsdaten in dieser Notiz.

## Geprüft und eingesetzt – getrennt

| Frage | Antwort |
|---|---|
| Welcher Stand ist geprüft? | `cf4f2c9` auf dem Branch `wip/pilot-technik-2026-11` |
| Was lief? | Lint und Typecheck (23 Aufgaben) grün · Unit-Tests 95 Suiten / 726 Tests grün · `knip` und `jscpd` ohne Befund (offline aus dem lokalen Cache) · `node --test tools/messlatte/` (14 Tests) und Simulator-Tests grün · **vollständiges e2e-Tor im festen Arbeitsverzeichnis `../orbit-e2e`: 82 Suiten / 661 Tests grün, 7 Live-Suiten bewusst übersprungen**, Dauer 44 min bei einer Rechnerlast von 59–73 % CPU (FN-15 bleibt: kein Rotlauf diesmal) |
| Was lief nicht? | `pnpm build` für `@orbit/web` bricht lokal unter Windows beim Kopieren der Standalone-Dateien ab (`EPERM … symlink`), **nach** erfolgreichem Kompilieren und Erzeugen aller 44 Seiten; `apps/web` ist gegenüber `78c4992` unverändert. Umgebungsgrenze, kein Codefehler. |
| Was ist eingesetzt? | **Nichts Neues.** Die Container `orbit-api`, `orbit-worker`, `orbit-web` laufen mit dem bisherigen Abbild (nach dem Tor unverändert wieder gestartet, API gesund). Die Migration `20261102090000_cost_reservations_shadow_quota` ist **nur in `orbit_e2e`** angewendet, **nicht** in der Entwicklungsdatenbank. |
| Was ist aktiviert? | Nichts: kein Kostenlimit, kein Zusatzkontingent, keine Schattenplanung (Grundzähler 61 von 60 unverändert), keine Windows-Aufgabe, keine Google-Änderung; es wurde keine Mail gesendet und kein bezahlter Modellaufruf ausgelöst. |

## Umgesetzt und geprüft

| Teil | Kern | Nachweis |
|---|---|---|
| Kostenkontrolle (Annahme #639) | Preiskatalog mit Quelle/Datum; Messung mit Kosten im Umgebungsweg; Reservierung des schlimmsten Falls vor jedem Aufruf unter Datenbanksperre (API und Worker gemeinsam); atomare Abrechnung; ungewisser Ausgang = möglicher Verbrauch; nie abgerechnete Reservierungen zählen weiter | e2e `pilot-cost-control` (11 Fälle, darunter zwei getrennte Verbindungen als API/Worker); Mutation ohne Sperre → beide Gleichzeitigkeitstests rot; Mutation „Reservierungen ignorieren“ → rot |
| Zusatzkontingent (#640) | inaktiv, Hauptbuch, Wiederholungsschlüssel (doppelte Zustellung zählt einmal, neuer Versuch zählt), Grundzähler unberührt | e2e `shadow-quota` (7), `shadow-plan` |
| Anhangsfreigabe (#641) | Prüfung vor/während/nach dem Abruf; Zurückhalten statt Speichern/Lesen; Aufgabe „Anhang prüfen“ | Unit (6 + 3 Connector), e2e `attachment-hold` (3), Mutation → rot |
| W8 Prüfwerkzeug (#642) | Matrix als Parameter; Konsistenzprüfung R01–R20; abgeleitete Zahlen; Trockenlauf; Matrix berichtigt (Pflichtfreigabe, „nur Hallo“, Sonderprüfungen) | `node --test` (14), Trockenlauf bestanden: 34 Szenarien im Probelauf, nichts gesendet |
| Betriebssicherung (#643) | Backup-Lauf, Dokumentensicherung mit Manifest, Wiederherstellungsprüfung, Zeitplan nur mit `-Execute`, Stopp-Probe-Beweissicherung, Runbook | Lauf in Wegwerf-Ordner (2.726 Objekte, Datenbankdump 252 Tabellen im Inhaltsverzeichnis), Wiederherstellung in Wegwerf-Datenbank (84 Tabellen, 2 Mandanten, 72 Migrationen), Schnappschuss-Vergleich |
| Google-Anleitung (#644) | nach offiziellen Seiten berichtigt; nichts extern geändert | Dokumentation |

## Ursachen der zwei früheren roten Tests

1. **Kostenwächter:** die Prüfung lief in zwei Transaktionen je Aufruf mit Standard-Wartezeiten von Prisma; unter Last scheiterte der Transaktionsstart (zusätzlich ein falsch erwarteter Test). Jetzt eine Transaktion, Sperre erst bei geltendem Limit, 20 s Wartezeit, Ausfall der Prüfung weist den Aufruf ehrlich ab.
2. **Zusatzkontingent:** Testfehler (Wiederholung ohne erste Planung) **und** echte Lücke (keine Idempotenz einer doppelt zugestellten Wiederholung) → Wiederholungsschlüssel.

## Offen / extern blockiert

* **Betreiberentscheidungen:** E1 (Umfang, benannte Person, Vertretung), E2 (Google-Projektwahl, siehe `GOOGLE_INTEGRATION.md`), E3 (Gas-Text, W2 nicht begonnen), E4 (Preis/Währung bestätigen), E5 (Kontingent 45 und Budget 5 USD freigeben), E6 (Pilot-Postfach, Erreichbarkeit, **externer Sicherungsort**, Datenschutz).
* **Nicht ausgeführt:** Stopp-/Wiederanlaufprobe (Werkzeug und Ablauf fertig), Zeitplan der Sicherung, Einspielen der Migration, Einsatz des geprüften Abbilds, D9-Prüflauf, Pilot.
* **Befund im Bestand:** ein Dokument des Mandanten `musterwerk-smoke-test` (21.09.) hat sein Objekt im Speicher verloren; die Wiederherstellungsprüfung meldet es, bis der Betreiber aufräumt oder es als bekannt einträgt.
* **Nicht Teil dieses Auftrags:** Virenscan, Texterkennung für Scans, zweiter KI-Anbieter, FN-15/FN-16.
