# Telefonie-Anbindung (Twilio)

Status: **REQUIRES PROVIDER CREDENTIALS** (siehe §63,
`docs/IMPLEMENTATION_STATUS.md`). Diese Datei wird befüllt, sobald eine
reale Twilio-Anbindung implementiert wird — bis dahin ist
`TelephonyConnector` (`packages/integration-core/src/telephony/`) nur
über `MockTelephonyConnector` nutzbar (`TELEPHONY_CONNECTOR=mock`,
Default).

## Voraussetzung: Twilio-Konto + Telefonnummer

Eine reale Anbindung braucht ein Twilio-Konto mit einer erworbenen
Telefonnummer (Voice-fähig), sowie `TWILIO_ACCOUNT_SID`/
`TWILIO_AUTH_TOKEN` oder ein API-Key-Paar
(`TWILIO_API_KEY`/`TWILIO_API_SECRET`, empfohlen gegenüber dem
Account-Auth-Token für produktive Systeme) und eine öffentlich
erreichbare `TWILIO_WEBHOOK_BASE_URL` für Status-Callbacks (siehe
`.env.example`). Für Recording/Transkription zusätzlich Twilios
Voice-Intelligence- oder ein separates STT-Add-on (`STT_PROVIDER` in
`.env.example` sieht bereits einen konfigurierbaren
Transkriptions-Provider vor). Das ist ein administrativer Vorgang
außerhalb der Codebasis (Nummernkauf, ggf. regulatorische
Prüfung je nach Land) und kann nicht durch Implementierungsarbeit allein
gelöst werden — ein echter, dokumentierter Blocker (§62 des
Master-Prompts).

## Was hier ergänzt wird, sobald der Zugang vorliegt

- Konkrete Twilio-API-Endpunkte für `TelephonyConnector.
  listRecentCalls()` (Voice API `Calls`-Ressource, ggf. mit
  Recording-/Transkriptions-Unterressourcen) — ausschließlich aus der
  offiziellen Twilio-API-Referenz.
- **Der komplett fehlende "Anruf → Case/Lead"-Workflow** (§28/§59
  Szenario E): anders als Mail/Kalender/CRM ist `TelephonyConnector`
  bisher in **keinen** Agent-Workflow eingebunden — es gibt kein
  Pendant zum `POST /intake/emails`-Endpunkt für eingehende Anrufe. Das
  bräuchte einen neuen `POST /intake/calls`-ähnlichen Endpunkt (oder
  eine Erweiterung von `IntakeService`) sowie ein Tool in
  `packages/agent-core`, das ein Anruftranskript denselben
  Klassifikations-/Case-Anlage-Schritten unterzieht wie eine E-Mail.
  Dieser fachliche Workflow selbst fehlt unabhängig von den
  Zugangsdaten und wäre eine eigene Implementierungsphase.
- Webhook-Signatur-Verifikation (Twilios `X-Twilio-Signature`-Header)
  für eingehende Status-Callbacks an `TWILIO_WEBHOOK_BASE_URL` — Twilio
  liefert ebenfalls nur *at-least-once*, die bereits vorbereitete
  `WebhookIdempotencyService` (`docs/SECURITY.md` Abschnitt 8) wäre der
  richtige Anknüpfungspunkt.
- Mapping zwischen einem ORBIT-Domänenmodell für Anrufe (existiert
  aktuell **nicht** im Schema — bräuchte ein neues `Call`-Modell,
  analog zu `EmailMessage`) und Twilios `Call`-/`Recording`-/
  `Transcription`-Ressourcen.

## Übergangslösung bis dahin

`MockTelephonyConnector` implementiert das Interface bereits vollständig
und ist unit-getestet (siehe `docs/INTEGRATIONS.md`) — es fehlt nicht
nur der reale Provider, sondern auch der fachliche Workflow selbst, der
ihn nutzen würde. Beides ist unabhängig voneinander nachrüstbar: der
reale Connector sobald Zugangsdaten vorliegen, der Workflow (neuer
`Call`-Case-Typ, Klassifikations-Tool) unabhängig davon rein auf
Basis des bereits vorhandenen Mocks.
