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
