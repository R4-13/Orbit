# Google-Anbindung (Gmail + Google Calendar)

Status: **REQUIRES PROVIDER CREDENTIALS** (siehe §63,
`docs/IMPLEMENTATION_STATUS.md`). Diese Datei wird befüllt, sobald eine
reale Google-Anbindung implementiert wird — bis dahin sind
`MailConnector` und `CalendarConnector`
(`packages/integration-core/src/{mail,calendar}/`) nur über
`MockMailConnector`/`MockCalendarConnector` nutzbar
(`MAIL_CONNECTOR=mock`, `CALENDAR_CONNECTOR=mock`, jeweils Default).

## Warum Mail und Kalender in einer Datei

Gmail-API und Google-Calendar-API laufen über denselben Google-Cloud-
Projekt-OAuth-Client (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/
`GOOGLE_REDIRECT_URI`, siehe `.env.example`) — eine einzige
OAuth-Consent-Registrierung mit den passenden Scopes deckt beide
Connectoren ab.

## Voraussetzung: Google-Cloud-Projekt + OAuth-Consent-Screen

Eine reale Anbindung braucht ein in der Google Cloud Console angelegtes
Projekt mit aktivierter Gmail API und Google Calendar API, einen
konfigurierten OAuth-Consent-Screen und — für produktiven Einsatz über
den Testnutzer-Kreis hinaus — eine Google-Verifizierung der angeforderten
Scopes (kann je nach Scope-Sensitivität mehrere Wochen dauern). Das ist
ein administrativer Vorgang außerhalb der Codebasis und kann nicht durch
Implementierungsarbeit allein gelöst werden — ein echter, dokumentierter
Blocker (§62 des Master-Prompts).

## Die Verbindung muss dauerhaft bestehen bleiben

Eine Verbindung wird **einmal** hergestellt und erneuert sich danach selbst: ORBIT löst das Refresh-Token bei Bedarf ein (ein Zugangstoken gilt rund eine Stunde). Damit das
über Wochen funktioniert, gilt:

* **Veröffentlichungsstatus des OAuth-Zustimmungsbildschirms.** Steht die App in der Google Cloud Console auf **„Testing“** (Nutzertyp „Extern“), läuft jede Zustimmung –
  und damit das Refresh-Token – nach **7 Tagen** ab, egal wie oft ORBIT es verwendet
  ([Google: Manage App Audience](https://support.google.com/cloud/answer/15549945),
  [Google: OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)). Dann zeigt ORBIT „Verbindung unterbrochen“, und die Person muss neu zustimmen. Das
  ist die häufigste Ursache für eine Verbindung, die sich „nach einer Zeit“ trennt. Welche Abhilfe zu welchem Projekt passt, steht im Abschnitt **„Pilot: Google-Konfiguration prüfen und entscheiden“** unten
  (Stand der offiziellen Dokumentation: 02.11.2026). Die frühere Kurzfassung „einfach auf In production stellen“ war unvollständig: `gmail.readonly` ist bei Google ein **eingeschränkter**
  (restricted), `gmail.send` ein **sensibler** Bereich; eine nicht verifizierte App in Produktion zeigt die Warnung „nicht verifizierte App“ und ist auf **100 neue Nutzer über die gesamte Lebenszeit des Projekts**
  begrenzt; und der Zustimmungsbildschirm gilt **für das ganze Projekt**, also für jeden OAuth-Client darin.
* **Was ORBIT selbst tut.** Nur eine *endgültige* Ablehnung durch Google (`invalid_grant`: widerrufen, abgelaufen, Passwort/Zustimmung geändert) setzt die Verbindung auf
  „Anmeldung erforderlich“. Netzwerkfehler, Zeitüberschreitungen, 5xx und 429 lassen sie bestehen; der nächste Abgleich versucht es erneut. Früher als „abgemeldet“
  markierte Verbindungen versuchen eine einmalige Selbstwiederherstellung (`TOKEN_REFRESH_FAILED`, höchstens alle 30 Minuten).
* **Was die Person sieht.** Ein Banner auf jeder Seite („Die Verbindung zu Gmail ist unterbrochen … Jetzt erneuern“), die Dashboard-Meldung und das Audit
  (`INTEGRATION_AUTH_REQUIRED`, `INTEGRATION_RECOVERED`).
* **Freigabe bei unterbrochener Verbindung.** Scheitert die Ausführung wegen einer fehlenden oder unterbrochenen Verbindung, bleibt die **Freigabe offen** und die Person
  erhält die Ursache; nach dem Erneuern genügt eine erneute Freigabe. Eine E-Mail gilt erst als gesendet, wenn Gmail den Versand bestätigt hat.

## Pilot: Google-Konfiguration prüfen und entscheiden (Stand 02.11.2026)

Grundlage sind ausschließlich die offiziellen Google-Seiten, die am 02.11.2026 gelesen wurden (keine Seite nennt ein Änderungsdatum): [Manage App Audience](https://support.google.com/cloud/answer/15549945),
[OAuth 2.0 – Ablauf von Refresh-Tokens](https://developers.google.com/identity/protocols/oauth2), [Gmail-Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[OAuth-App-Verifizierung](https://support.google.com/cloud/answer/13463073), [Wann keine Verifizierung nötig ist](https://support.google.com/cloud/answer/13464323),
[OAuth-Clients verwalten](https://support.google.com/cloud/answer/15549257), [Ressourcenhierarchie](https://docs.cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy).
Nicht gelesen wurden die Seite zur Einrichtung des Zustimmungsbildschirms (die angegebene Adresse lieferte die Seite zum Branding) und die Seite zum Datenzugriff. **ORBIT ändert nichts an Google; alle Schritte macht der Betreiber.**

### Was gilt

| Frage | Antwort laut Google-Dokumentation |
|---|---|
| Wo stellt man es ein? | Google Cloud Console → **Google Auth Platform** → *Audience* (Nutzertyp, Veröffentlichungsstatus), *Data Access* (Bereiche), *Clients* (OAuth-Clients), *Verification Center*. Direkt: `console.developers.google.com/auth/audience`, `/auth/clients`, `/auth/verification`. Die frühere Bezeichnung „APIs & Dienste → OAuth-Zustimmungsbildschirm → Zielgruppe“ führt je nach Oberfläche nicht mehr dorthin. |
| „Intern“ oder „Extern“? | **Intern** ist nur für Projekte möglich, die zu einer **Google-Cloud-Organisation** gehören (die gibt es nur mit Google Workspace oder Cloud Identity). Ein Projekt eines normalen gmail.com-Kontos hat keine Organisation und kann nur **Extern** sein (Schlussfolgerung aus der Hierarchie-Seite; dort nicht ausdrücklich als Satz formuliert). Eine interne App braucht keine Verifizierung und hat nicht die 100-Nutzer-Grenze, aber nur Mitglieder der Organisation können zustimmen; für eingeschränkte Gmail-Bereiche kann der Organisations-Administrator Zusatzeinstellungen verlangen. |
| Gehört unser Projekt zu einer Organisation? | In der Projektauswahl der Console zeigt der Organisations-Filter nur Organisationen; verlässlich zeigt es `gcloud projects describe <PROJEKT-ID>` im Feld `parent` (kein `parent` = keine Organisation). Dafür braucht man die Rolle Eigentümer oder Browser auf dem Projekt. |
| Testing → In production (Extern) | Die **7-Tage-Grenze** der Zustimmung und des Refresh-Tokens entfällt. Es bleiben andere Gründe für ein ungültiges Token: sechs Monate ungenutzt, Passwortänderung des Kontos bei Gmail-Bereichen, Überschreiten der Token-Höchstzahl je Nutzer und Client. |
| Was zeigt Google dann beim Zustimmen? | Für sensible/eingeschränkte Bereiche **vor** der Verifizierung die Warnung „nicht verifizierte App“ (*Erweitert → Weiter*). |
| Wie viele Nutzer? | Ohne Verifizierung **100 neue Nutzer insgesamt, über die gesamte Lebenszeit des Projekts, nicht zurücksetzbar**. Im Testing-Status: 100 eingetragene Testnutzer. |
| Brauchen wir die Verifizierung? | Sobald eine App eingeschränkte oder sensible Bereiche in Produktion nutzt und über die Nutzergrenze hinaus verwendet werden soll, ja. Für **eingeschränkte** Bereiche (`gmail.readonly`) kommt bei serverseitiger Speicherung von Gmail-Daten zusätzlich eine **Sicherheitsprüfung** (Security Assessment) hinzu. Das ist eine Frage für den allgemeinen Betrieb, nicht für ein einzelnes Pilot-Postfach. |
| Wirkt eine Änderung auf andere Apps? | Zustimmungsbildschirm, Nutzertyp, Veröffentlichungsstatus und Nutzergrenze gehören zum **Projekt**; sie gelten für jeden OAuth-Client darin (die Seiten sagen das nicht in einem Satz, es folgt aus der Beschreibung je Projekt). Das Löschen eines einzelnen Clients lässt andere unberührt, entwertet aber Token dieses Clients. Google empfiehlt, **Test und Produktion in getrennten Projekten** zu führen. |

### Entscheidung des Betreibers (nichts davon ist umgesetzt)

1. **Bestand prüfen, ohne etwas zu ändern:** Console → Google Auth Platform → *Clients*: welche OAuth-Clients hängen am Projekt (ORBIT, Kunden-Simulator, weitere Projekte)? → *Data Access*: welche Bereiche sind eingetragen, **wer nutzt sie**? → *Audience*: Nutzertyp, Status, bereits verbrauchte Nutzer. Bereiche, Clients oder Testnutzer **nicht entfernen**, solange nicht feststeht, dass kein anderer Client sie braucht.
2. **Pilot-Postfach klären:** Ist es ein Google-Workspace-Konto in einer eigenen Organisation? Dann ist ein **neues Projekt in dieser Organisation** mit Nutzertyp *Intern* die einfachste Lösung (keine Verifizierung, keine Nutzergrenze, kein 7-Tage-Ablauf). Ist es ein normales gmail.com-Konto, bleibt nur *Extern*.
3. **Empfehlung bei Extern:** ein **eigenes Projekt nur für den ORBIT-Pilot** (nicht das gemeinsam genutzte Projekt umstellen), Status *In production*, nur die zwei Bereiche `gmail.readonly` und `gmail.send` eintragen, **keine Kalenderbereiche**. Die Nutzergrenze (100 neue Nutzer insgesamt) reicht für ein einzelnes Pilot-Postfach; für den allgemeinen Betrieb wird die Verifizierung nötig. Damit bleibt das gemeinsame Projekt samt seinen Berechtigungen unberührt.
4. **Alternative im gemeinsamen Projekt:** nur nach Schritt 1 und nur, wenn alle dortigen Clients mit „In production“ und der Warnung „nicht verifizierte App“ leben können. Das Umstellen ist nicht trivial rückgängig zu machen (Rückstellung auf Testing führt wieder zum 7-Tage-Ablauf).
5. **In ORBIT** danach die Gmail-Verbindung des Pilotmandanten **trennen und neu verbinden** (alte Token gehören zum alten Client/Status). Die Zustimmung nur für Lesen und Senden erteilen; „Kalender-Verfügbarkeit erlauben“ bleibt aus.
6. **Prüfen:** am Tag 8 und am Ende der Beobachtung ist die Verbindung weiter „verbunden“, ohne neue Zustimmung.

## Kalender-Verfügbarkeit für Terminvorschläge

ORBIT kann bei Anfragen, für die ein verlässliches Angebot einen Termin braucht (Aufmaß, Besichtigung, Beratung), Vor-Ort- oder Telefontermine zu **freien Zeiten** vorschlagen.
Dafür liest es nur **frei/belegt** der Kalender (Scope `calendar.freebusy`, Schnittstelle `freebusy.query`, siehe
[Google: Freebusy query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)) – keine Termininhalte, kein Schreibzugriff.

* **Einrichten:** Integrationen → Gmail → „Kalender-Verfügbarkeit erlauben“ (neue Zustimmung; bereits erteilte Berechtigungen wie Senden bleiben erhalten). Voraussetzung: die
  **Google Calendar API** ist im selben Google-Cloud-Projekt aktiviert und der Scope im Zustimmungsbildschirm eingetragen.
* **Welche Kalender:** standardmäßig der Hauptkalender (`primary`). Für die Monteure/Installateure deren Kalender-IDs (meist die E-Mail-Adresse) angeben; die Kalender müssen
  für das verbundene Konto freigegeben sein. Mehrere Kalender gelten als Pool: ein Termin wird vorgeschlagen, sobald mindestens einer frei ist.
* **Ohne Kalender** (nicht verbunden, nicht lesbar, Fehler): ORBIT erfindet keine Zeiten; die Nachricht bittet um Terminwünsche bzw. eine Rufnummer und passende Zeiten.
* **Status:** implementiert und mit Doubles getestet; **nicht live gegen einen echten Google-Kalender geprüft** (braucht Ihre Zustimmung und die aktivierte Calendar API).

## Was hier ergänzt wird, sobald der Zugang vorliegt

- Konkrete Endpunkte/Scopes für `MailConnector.listNewMessages()`
  (Gmail API `users.messages.list`/`.get`), `sendMessage()`
  (`users.messages.send`) und `CalendarConnector.findAvailability()`
  (Calendar API `freebusy.query`)/`createMeeting()` (`events.insert`) —
  ausschließlich aus der offiziellen Gmail-API-/Calendar-API-Referenz.
- Entscheidung Polling vs. Gmail-Push-Notifications (Cloud Pub/Sub) für
  neue E-Mails — `GOOGLE_PUBSUB_TOPIC` (siehe `.env.example`) ist bereits
  als Konfigurationswert vorgesehen. Push-Zustellungen sind ebenfalls nur
  *at-least-once* garantiert — dieselbe `WebhookIdempotencyService`-
  Infrastruktur (`docs/SECURITY.md` Abschnitt 8) käme hier zum Einsatz.
- OAuth-Flow-Details (Redirect-URI-Anforderungen, Refresh-Token-
  Handling — Google widerruft Refresh-Tokens nach 7 Tagen Inaktivität im
  Testmodus) für die drei oben genannten Env-Variablen.
- Mapping zwischen ORBIT-Domänenmodellen (`EmailMessage`, `Meeting`) und
  den entsprechenden Gmail-/Calendar-Ressourcen (`Message`, `Event`).
- Quota-/Rate-Limit-Verhalten der Gmail API (Nutzungskontingente pro
  Projekt) und wie eine `GoogleMailConnector`-Implementierung darauf
  reagieren müsste.

## Übergangslösung bis dahin

Die Fachlogik (Communication-Agent, §12-17, `IntakeService`,
Terminvorschläge in `MeetingsService`) wird ausschließlich gegen die
providerunabhängigen Interfaces implementiert und mit
`MockMailConnector`/`MockCalendarConnector` verifiziert (siehe
`docs/INTEGRATIONS.md`). Der Agent-Intake-Endpunkt (`POST
/api/v1/intake/emails`) simuliert den Eingang, den ein echter
`MailConnector`-Webhook später automatisch auslösen würde. Sobald
Google-Zugangsdaten vorliegen, entstehen
`GoogleMailConnector`/`GoogleCalendarConnector`-Klassen, die dieselben
Interfaces implementieren.
