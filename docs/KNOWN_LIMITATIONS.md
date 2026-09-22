# Bekannte Einschränkungen — Project ORBIT

Ehrlicher Statusüberblick über das, was der MVP (noch) nicht tut. Für den
Status jeder einzelnen Komponente siehe
[`docs/IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md); für die
Begründung jeder einzelnen Entscheidung siehe
[`docs/ASSUMPTIONS.md`](ASSUMPTIONS.md) (hier per Nummer verlinkt).

## Bewusste Nicht-Ziele des MVP (§60)

Keine automatische Bankzahlung (`payment.execute` ist hart auf `DISABLED`
gesperrt, nicht nur default-deaktiviert), keine Lohnbuchhaltung, keine
Steuererklärungen, kein vollautomatischer Monatsabschluss, keine
Anbindung an SAP/Salesforce/Pipedrive, kein vollwertiges CPQ/ERP, keine
native Mobile App, kein Kubernetes-Multi-Region-Deployment. Siehe
[`docs/PRODUCT_CONTEXT.md`](PRODUCT_CONTEXT.md).

## Reale Drittanbieter-Anbindungen: **REQUIRES PROVIDER CREDENTIALS**

Jeder Connector (Finance/Mail/Calendar/CRM/Telephony) hat ein fertiges
Interface + eine getestete Mock-Implementierung
(`packages/integration-core`) — aber keine reale Implementierung:

- **DATEV / Lexware** (Finance) — braucht Partner-/OAuth-Registrierung,
  siehe `docs/DATEV_INTEGRATION.md`.
- **Microsoft 365 / Gmail / Google Calendar** (Mail/Calendar) — braucht
  `MICROSOFT_CLIENT_ID`/`GOOGLE_CLIENT_ID` etc.
- **HubSpot** (CRM) — braucht `HUBSPOT_CLIENT_ID`/`_SECRET`.
- **Twilio** (Telephony) — Interface existiert, ist aber noch in keinen
  konkreten Workflow eingebunden (kein "Anruf → Lead"-Endpunkt).

Eine falsch konfigurierte Provider-Auswahl scheitert beim Boot laut
(`IntegrationUnavailableError`) statt still auf Mock zurückzufallen — kein
Implementierungsrückstand, ein echter Zugangsdaten-Blocker (§62 des
Master-Spec).

## Agent-Runtime: live verdrahtet, aber ohne echten Trigger

Seit Phase 18 gibt es ein `AgentModule` + einen echten Endpunkt (`POST
/api/v1/intake/emails`), der die volle Kette LLM → Tool Registry →
Policy Engine → Tool Gateway → Connector live gegen echte Postgres
ausführt (Communication/Intake-, Finance/AP- und Sales/CRM-Agent). Was
weiterhin fehlt: ein **echter Trigger** — der Endpunkt *simuliert* eine
eingehende E-Mail, es gibt keinen echten Mail-Connector-Webhook, der ihn
automatisch aufruft (kein Microsoft Graph-/Gmail-Zugang), keine Unified-
Inbox-UI, die ihn bedient, und keinen vierten Agenten-Typ (Orchestrator)
als eigenen LLM-Lauf (das Routing ist deterministischer Code). Details:
[`docs/AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md).

Direkt daraus folgt weiterhin: **echte OCR** (Tesseract) ist nicht
implementiert (`OCR_PROVIDER=tesseract` scheitert beim Boot wie jeder
andere nicht-mock-Connector) — die Finance-Demo nutzt ausschließlich
`MockOcrProvider` mit vorgegebenen Ergebnissen, jetzt auch über den
Agent-Intake-Pfad.

## E-Mail-Eingang (Inbox)

Kein Mail-Connector-Workflow existiert, deshalb wurde auch keine
Inbox-/E-Mail-Ansicht im Frontend gebaut — der Finance-/Sales-Einstieg
"eingehende E-Mail wird erkannt" (§7) ist konzeptionell vorgesehen, aber
mangels Agent-Verdrahtung (siehe oben) noch nicht auslösbar.

## Sicherheit

- **JWT-Session in `localStorage`**, nicht in einem httpOnly-Cookie
  (`docs/ASSUMPTIONS.md` #68, bewusst nicht in Phase 15 migriert, #92) —
  ein erfolgreicher XSS auf der Web-Origin könnte die Tokens auslesen.
- **Row-Level Security** deckt 21 von 24 tenant-gescopten Tabellen ab;
  `role_permissions`, `user_roles`, `refresh_tokens` haben keine eigene
  `tenant_id`-Spalte und sind nur indirekt (über die Elterntabelle)
  abgesichert (`docs/ASSUMPTIONS.md` #87).
- **CI-Erweiterungen aus Phase 14/15** (MinIO-Service, RLS-Rollen-Setup-
  Schritt, Playwright-Browser-Install, API-Server-Start für die
  Frontend-E2E-Suite) sind **nicht live gegen einen echten
  GitHub-Actions-Runner verifiziert** — jede Einzelkomponente aber gegen
  das lokale Docker-Äquivalent (`docs/ASSUMPTIONS.md` #83, #89).
- **`pnpm db:reset`** auf einem wiederverwendeten (nicht neu erstellten)
  Postgres-Container verliert die automatische Rechtevergabe für neu
  angelegte Tabellen an die `orbit_app`-Rolle — siehe
  [`docs/LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md) für den Workaround.
- Kein Dependency-Vulnerability-Scanning (`pnpm audit` o. Ä.) ist bisher
  Teil der CI-Pipeline.

## Sonstiges

- **`next build` (Windows)**: schlägt lokal ohne aktivierten
  Windows-Entwicklermodus mit `EPERM: symlink` fehl (Docker-Build
  unbetroffen) — `docs/ASSUMPTIONS.md` #17.
- **Worker-Prozess** (`apps/api/worker`) bootet und beendet sich sofort
  wieder — noch kein BullMQ-Queue-Consumer registriert (folgt mit der
  Agent-Verdrahtung, siehe oben).
- **OpenTelemetry** ist als Env-Flag (`OTEL_ENABLED`) vorgesehen, aber
  nicht verdrahtet.
- **Dokument-Upload**: keine Antiviren-/Malware-Prüfung hochgeladener
  Dateien; Validierung beschränkt sich auf MIME-Type/Dateigröße im
  Presigned-URL-Request.
- **Demo-Rechnungen** haben keine echten Dokument-Anhänge (siehe
  `docs/DEMO_DATA.md` "Bekannte Einschränkung").
