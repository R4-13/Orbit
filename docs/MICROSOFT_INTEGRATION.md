# Microsoft-365-Anbindung (Mail + Kalender)

Status: **REQUIRES PROVIDER CREDENTIALS** (siehe §63,
`docs/IMPLEMENTATION_STATUS.md`). Diese Datei wird befüllt, sobald eine
reale Microsoft-Graph-Anbindung implementiert wird — bis dahin sind
`MailConnector` und `CalendarConnector`
(`packages/integration-core/src/{mail,calendar}/`) nur über
`MockMailConnector`/`MockCalendarConnector` nutzbar
(`MAIL_CONNECTOR=mock`, `CALENDAR_CONNECTOR=mock`, jeweils Default).

## Warum Mail und Kalender in einer Datei

Microsoft bündelt beide Oberflächen hinter derselben API (Microsoft
Graph) und derselben Azure-AD-App-Registrierung — ein Postfach- und ein
Kalenderzugriff teilen sich denselben OAuth-Client
(`MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`/`MICROSOFT_TENANT_ID`/
`MICROSOFT_REDIRECT_URI`, siehe `.env.example`), nur mit unterschiedlichen
Graph-Scopes. Eine gemeinsame Registrierung schließt beide Connectoren
gleichzeitig frei.

## Voraussetzung: Azure-AD-App-Registrierung

Eine reale Anbindung braucht eine im Microsoft Entra Admin Center (bzw.
Azure Portal) registrierte Multi-Tenant- oder Single-Tenant-App mit
delegierten oder Anwendungsberechtigungen für Microsoft Graph (konkrete
Scopes und ob delegiert vs. Application Permissions richtig sind, hängt
von der genauen Zustellungsart ab — Change-Notifications
vs. reiner Polling-Zugriff — und wird erst bei der Implementierung aus
der offiziellen Microsoft-Graph-Dokumentation festgelegt, niemals
erraten, siehe CLAUDE.md). Das ist ein administrativer Vorgang außerhalb
der Codebasis (Tenant-Admin-Zustimmung ggf. erforderlich) und kann nicht
durch Implementierungsarbeit allein gelöst werden — ein echter,
dokumentierter Blocker (§62 des Master-Prompts).

## Was hier ergänzt wird, sobald der Zugang vorliegt

- Konkrete Graph-Endpunkte/Scopes für `MailConnector.listNewMessages()`
  (`/me/messages` bzw. `/users/{id}/messages` Delta-Query),
  `sendMessage()` (`/sendMail`) und `CalendarConnector.findAvailability()`
  (`/me/calendar/getSchedule`)/`createMeeting()`
  (`/me/events`) — ausschließlich aus der offiziellen
  Microsoft-Graph-Referenz.
- Entscheidung Polling vs. Change-Notifications (Webhook) für neue
  E-Mails — letzteres bräuchte einen öffentlich erreichbaren
  Callback-Endpunkt und die in `docs/SECURITY.md` Abschnitt 8 bereits
  vorbereitete `WebhookIdempotencyService`-Infrastruktur, da Microsoft
  Graph-Benachrichtigungen nur *at-least-once* zustellt.
- OAuth-Flow-Details (Redirect-URI-Anforderungen, Token-Lifetime,
  Refresh-Verhalten, Admin-Consent-Ablauf) für die vier oben genannten
  Env-Variablen.
- Mapping zwischen ORBIT-Domänenmodellen (`EmailMessage`, `Meeting`,
  siehe `packages/domain/prisma/schema.prisma`) und den entsprechenden
  Graph-Ressourcen (`message`, `event`).
- Rate-Limit-/Throttling-Verhalten von Microsoft Graph und wie
  `MailConnector`/`CalendarConnector`-Implementierungen darauf reagieren
  (Retry-After-Header).

## Übergangslösung bis dahin

Die Fachlogik (Communication-Agent, §12-17, `IntakeService`,
Terminvorschläge in `MeetingsService`) wird ausschließlich gegen die
providerunabhängigen Interfaces implementiert und mit
`MockMailConnector`/`MockCalendarConnector` verifiziert (siehe
`docs/INTEGRATIONS.md`). Der Agent-Intake-Endpunkt (`POST
/api/v1/intake/emails`, siehe `docs/AGENT_ARCHITECTURE.md`) simuliert
den Eingang, den ein echter `MailConnector`-Webhook später automatisch
auslösen würde — die Fachlogik dahinter (Klassifikation, Case-Anlage,
Extraktion) bleibt dabei unverändert. Sobald Microsoft-Graph-Zugangsdaten
vorliegen, entstehen `MicrosoftMailConnector`/`MicrosoftCalendarConnector`
-Klassen, die dieselben Interfaces implementieren.
