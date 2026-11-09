# Pilotbetrieb – Betriebsanleitung (Entwurf, 09.11.2026)

**Stand:** Vorbereitung. Nichts hiervon ist im Betrieb eingesetzt oder freigegeben; ein Pilot mit echten Kunden gibt es nicht. Die Anleitung ist für die **benannte Person und ihre Vertretung** (Entscheidung E1) und für den Betreiber des Rechners geschrieben. Namen, Telefonnummern und den Ort der externen Sicherung trägt der Betreiber ein (Platzhalter `[…]`). Keine Zugangsdaten in diesem Dokument.

## 1. Wer macht was

| Rolle | Aufgabe | Name / Erreichbarkeit |
|---|---|---|
| Verantwortliche Person | begleitet jeden Vorgang, entscheidet Freigaben, ist erste Anlaufstelle der Meldungen | `[Name, Telefon]` (E1) |
| Vertretung | übernimmt bei Abwesenheit und bei Eskalation | `[Name, Telefon]` (E1) |
| Betreiber des Rechners | Notbremsen, Neustart, Sicherung, Google-Zustimmung | `[Name, Telefon]` (E6) |

Meldeweg bei Übergaben: Meldung → Erinnerung → Eskalation (zuständig → Vertretung → Leitung; Notfälle 15/45 Minuten), nur E-Mail. Eine **Probe mit echten Empfängern** erfolgt erst nach Benennung der Personen und ausdrücklicher Versandfreigabe (bis dahin nur Tom).

## 2. Stoppen – vier Stufen (von fein nach grob)

| Stufe | Wirkung | Wie | Zurück |
|---|---|---|---|
| 1 Einzelner Vorgang | dieser Vorgang tut nichts mehr | in der Vorgangsansicht *Pausieren* (kommt später zurück) oder *Abbrechen* (endgültig) | *Fortsetzen* |
| 2 Autonomes Senden | keine automatisch gesendete Nachricht mehr; alles geht in die Freigabe | Plattformkonsole → Notbremsen → `external.autonomous_send` ziehen | Notbremse lösen |
| 3 KI | keine neuen KI-Aufrufe; Vorgänge warten ehrlich („KI nicht verfügbar“), nichts wird verworfen | Notbremse `ai.executions` (alles) oder `planner.adaptive` (nur freie Planung) | Notbremse lösen |
| 4 Aufnahme und Hintergrund | keine neue Mail wird aufgenommen, keine Frist/Erinnerung läuft; Oberfläche bleibt erreichbar | `docker stop orbit-worker` (Mails bleiben im Postfach und werden nach dem Start nachgeholt) | `docker start orbit-worker` |
| 5 Alles | auch Oberfläche und Schnittstelle aus | zusätzlich `docker stop orbit-api orbit-web` | `docker start orbit-api orbit-web orbit-worker` |

Der Betreiber zieht die Notbremsen; die benannte Person pausiert/bricht Vorgänge ab. **Nach jedem Stopp** wird die Wirkung geprüft (Abschnitt 4), nicht angenommen.

## 3. Wiederanlauf

Reihenfolge: Datenbank und Speicher laufen → `orbit-api` → `orbit-worker` → Notbremsen lösen → Oberfläche prüfen → *Fortsetzen* der pausierten Vorgänge. Danach der Vergleich der Zustände (Abschnitt 4). Mails, die während des Stopps ankamen, erscheinen nach dem Start des Workers; ihr Eingang wird aus dem Postfach nachgeholt, nichts geht verloren. Bei **abgelaufener Google-Zustimmung** (Banner „Verbindung unterbrochen“) die Verbindung erneuern.

## 4. Stopp- und Wiederanlaufprobe (vorbereitet, nicht ausgeführt)

Umfang: nur der bestehende Testumfang (Tom → Musterwerk), mehrere laufende Testvorgänge, keine neuen Empfänger, keine Kalenderbuchung. Beweissicherung mit `apps/api/scripts/stop-drill.ts` (liest nur):

| Schritt | Aktion | Nachweis |
|---|---|---|
| 0 | Ausgangslage: mindestens drei Testvorgänge in verschiedenen Zuständen (wartet auf Antwort, wartet auf Freigabe, in Bearbeitung) | `stop-drill.ts schnappschuss musterwerk vorher.json` |
| 1 | Stufe 4 (Worker aus), eine Testmail von Tom senden | Mail kommt **nicht** an: `schnappschuss … nach-stopp.json`; `vergleich vorher.json nach-stopp.json --stopp` bestanden |
| 2 | Stufe 2 (`external.autonomous_send`) und einen Vorgang pausieren; Worker wieder an | in diesem Fenster keine bestätigte Aktion, keine gesendete Nachricht |
| 3 | Notbremsen lösen, Vorgang fortsetzen | Testmail wird nachgeholt; `vergleich vorher.json nachher.json` bestanden |
| 4 | Eskalationskette: eine Testmeldung ohne Reaktion bis zur Vertretung (Zeiten für den Test verkürzen) | Meldung, Erinnerung, Eskalation sind im Verlauf sichtbar |
| 5 | Protokoll | Zeitpunkte, Vergleichsausgaben, Abweichungen, wer was gezogen hat |

Bestanden, wenn: kein Vorgang und kein Eingang verloren, keine Wirkung im Stopp-Fenster, Wiederanlauf holt nach, Kette erreicht die Vertretung.

## 5. Sicherung und Wiederherstellung

| Was | Wie | Wann |
|---|---|---|
| Datenbank + Dokumentenspeicher | `scripts/backup-run.sh --execute` (ohne `--execute` nur Anzeige); schreibt `backups/backup-protokoll.jsonl` | täglich 02:30 (Zeitplan: `scripts/schedule-backup.ps1 -Execute`, legt Aufgaben der Windows-Aufgabenplanung an; ohne `-Execute` nur Anzeige) |
| Wiederherstellungsprüfung | `scripts/backup-restore-check.sh`: Alter der Sicherung, Rückspielen in eine Wegwerf-Datenbank, Dokumentensicherung gegen Manifest und Bucket | sonntags 03:30 und nach jeder größeren Änderung |
| Objekt-Rückspielprobe | `backup-documents.ts wiederherstellen <Ordner> --praefix restore-probe/<Zeit>/ --execute` (legt unter einem Probe-Präfix ab, liest zurück, entfernt) | nach Bedarf |
| **Externer Ort** | `BACKUP_EXTERNAL_DIR` in `.env.backup.local` (nicht im Repository) auf einen Ort **außerhalb dieses Rechners** setzen | **Betreiber nennt den Ort (E6)**; bis dahin vermerkt das Protokoll jedes Mal `NICHT_KONFIGURIERT` – die Sicherung schützt dann nicht vor Verlust des Rechners |

Bekannte Altlast im Entwicklungsbestand: ein Dokument des Test-Mandanten `musterwerk-smoke-test` (21.09.2026) hat sein Objekt im Speicher verloren; die Prüfung meldet es als Problem. Aufräumen (Datensatz löschen) oder als bekannt eintragen (`BACKUP_KNOWN_ORPHANS=<Schlüssel>` in `.env.backup.local`) entscheidet der Betreiber.

## 6. Zugänge, Anhänge, Postfach (Betriebsregeln)

* Nur namentlich benannte Konten, keine geteilten; starke Passwörter; die Oberfläche ist nicht öffentlich erreichbar (Betreiber legt Erreichbarkeit fest, E6).
* **Anhänge:** technisch erzwungen. Freigegeben sind nur PDF, Word (.docx), Klartext/CSV, JPEG und PNG bis 5 MB je Anhang, höchstens 5 Anhänge und 15 MB je Nachricht. Alles andere (Programme, Archive, Webseiten, zu große oder zu viele Dateien, Dateien mit falscher Signatur) wird **weder abgerufen noch gespeichert noch gelesen**; der Vorgang bekommt die Aufgabe „Anhang prüfen“ mit Name, Art, Größe und Grund. Wer den Anhang prüfen will, öffnet ihn **im Postfach selbst**, nicht über ORBIT, und leitet nichts weiter. Bilder und Scans ohne Text werden abgelegt, aber nicht ausgewertet (keine Texterkennung).
* **Postfach:** ein eigenes Pilot-Postfach; ORBIT liest dort jede Nachricht. Nur die Bereiche Lesen und Senden, keine Kalenderberechtigung.
* **Kosten:** ein durchgesetztes Kostenbudget (`apps/api/scripts/cost-budget.ts`, erst nach Freigabe) weist neue KI-Aufrufe ab, wenn Verbrauch plus laufende Aufrufe plus der schlimmste Fall des nächsten Aufrufs das Budget überschreiten würden; betroffene Vorgänge warten ehrlich.

## 7. Verwaltungswerkzeuge – gemeinsame Regel

Alle Werkzeuge zeigen **standardmäßig nur an**. Eine Änderung geschieht nur mit ausdrücklichem `--execute` (PowerShell: `-Execute`) und steht im Protokoll: Plattform-Audit (`cost-budget.ts`, `platform-flag-tenant.ts`), Mandanten-Audit (`shadow-quota.ts`), `backup-protokoll.jsonl` (Sicherung). Werkzeuge: `scripts/backup-run.sh`, `scripts/backup-restore-check.sh`, `scripts/schedule-backup.ps1`, `apps/api/scripts/{backup-documents,cost-budget,shadow-quota,stop-drill}.ts`, `tools/messlatte/messlauf.mjs` (Trockenlauf).
