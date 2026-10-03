# Integrationen / Connector-Katalog

Diese Datei dokumentiert jeden externen Connector: Zweck, aktuellen
Implementierungsstatus (siehe Legende in `IMPLEMENTATION_STATUS.md`), die
zugehörige Env-Variable zur Auswahl (`@orbit/config/src/env.ts`) und was für
eine Live-Anbindung fehlt. Sie wird bei jeder Connector-Änderung
aktualisiert.

## Architekturprinzip

Kein Fachmodul (Finance-, Sales-, Agent-Workflows) spricht jemals direkt
mit einem Drittanbieter-SDK oder einer Drittanbieter-HTTP-API. Jede
Interaktion läuft über ein providerunabhängiges Interface in
`@orbit/integration-core` (`src/<connector>/types.ts`), das zwei
austauschbare Implementierungen hat:

- **Mock** (`src/<connector>/mock-*-connector.ts`) — deterministisch,
  in-memory, keine externen Zugangsdaten nötig. Default in Entwicklung/CI
  (`*_CONNECTOR=mock`).
- **Real** (folgt pro Connector in der jeweiligen Phase) — spricht die
  echte Provider-API. Wird ausschließlich gegen die offizielle
  Herstellerdokumentation implementiert; niemals aus Vermutung heraus (§62
  des Master-Prompts / CLAUDE.md).

Welche Implementierung zur Laufzeit verwendet wird, entscheidet die
jeweilige `*_CONNECTOR`-Env-Variable — nie ein Codepfad, der beide
Implementierungen unterschiedlich behandelt.

## Connector-Katalog

| Connector | Interface | Env-Variable | Status | Phase (reale Anbindung) |
|---|---|---|---|---|
| Finance / FiBu (DATEV, Lexware Office) | `FinanceConnector` (`src/finance/types.ts`) | `FINANCE_CONNECTOR` (`mock` \| `datev` \| `lexware`) | Interface + Mock: IMPLEMENTED. Real: REQUIRES PROVIDER CREDENTIALS | Phase 7 (Finance-Workflow) |
| Mail (Microsoft 365/Outlook, Gmail) — `SalesAgentTools`-Singleton-Pfad | `MailConnector` (`src/mail/types.ts`) | `MAIL_CONNECTOR` (`mock` \| `microsoft` \| `gmail`) | Interface + Mock: IMPLEMENTED. Real: REQUIRES PROVIDER CREDENTIALS | Phase 9 |
| Gmail — Integration-Framework-Connector (`GmailConnectorService`, tenant-aufgelöst, OAuth2) | kein geteiltes Interface (siehe `docs/ASSUMPTIONS.md` #374) — eigener, tenant-aufgelöster Service (`apps/api/src/integrations/gmail-connector.service.ts`) | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` | Code: IMPLEMENTED + TESTED WITH MOCK (OAuth2-Flow, Token-Refresh, Nachrichten-/Anhang-Parsing — 42 Unit-Tests, `fetch` gemockt). Live-Verbindung gegen ein echtes Google-Konto: REQUIRES PROVIDER CREDENTIALS (`GOOGLE_CLIENT_ID`/`SECRET` in `.env` noch leer) | Amendment-01-Phase-1 (siehe `docs/ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_01_INTEGRATION_FRAMEWORK.md`) |
| Kalender (Microsoft/Outlook, Google Calendar) | `CalendarConnector` (`src/calendar/types.ts`) | `CALENDAR_CONNECTOR` (`mock` \| `microsoft` \| `google`) | Interface + Mock: IMPLEMENTED. Real: REQUIRES PROVIDER CREDENTIALS | Phase 9 |
| CRM (HubSpot) | `CrmConnector` (`src/crm/types.ts`) | `CRM_CONNECTOR` (`mock` \| `hubspot`) | Interface + Mock: IMPLEMENTED. Real: REQUIRES PROVIDER CREDENTIALS | Phase 10 |
| Telefonie (Twilio) | `TelephonyConnector` (`src/telephony/types.ts`) | `TELEPHONY_CONNECTOR` (`mock` \| `twilio`) | Interface + Mock: IMPLEMENTED. Real: REQUIRES PROVIDER CREDENTIALS | Phase 11 |
| Object Storage (S3-kompatibel / MinIO) | `StorageService` (`apps/api/src/storage/storage.service.ts`) | `S3_ENDPOINT`/`S3_*` | LIVE TESTED (MinIO via Docker) | — (kein Connector im engeren Sinn, echte S3-API bereits live nutzbar) |
| OCR (Rechnungs-Texterkennung) | `OcrProvider` (`packages/integration-core/src/ocr/types.ts`) | `OCR_PROVIDER` (`mock` \| `tesseract`) | Interface + Mock: IMPLEMENTED. Real (Tesseract): NICHT BEGONNEN (Implementierungs-, kein Zugangsdaten-Blocker) | Phase 7 (Finance-Workflow, Rechnungsextraktion) |
| Speech-to-Text | — | `STT_PROVIDER` (`mock` \| `whisper`) | NICHT BEGONNEN | Phase 11 (Telefonie/Sales-Workflow) |
| LLM-Provider (Agent-Runtime) | `LLMProvider` | `LLM_PROVIDER` (`mock` \| `anthropic`) | NICHT BEGONNEN | Phase 6 (Agent Runtime) |

**Warum zwei Gmail-Zeilen:** Der ursprüngliche `MAIL_CONNECTOR=gmail`-Pfad (prozessweiter Singleton, genutzt von `SalesAgentTools` für ausgehende Follow-up-Mails) und der neue, tenant-aufgelöste `GmailConnectorService` (Integration-Framework-Amendment, OAuth2, Enduser-"Mit Google verbinden") sind bewusst getrennte Implementierungen — Ersterer bleibt unverändert ein Mock, Letzterer ist real und bereits gegen echte Google-Endpunkte implementiert. Eine Zusammenführung (`SalesAgentTools` auf den echten Connector migrieren) ist ein bewusst zurückgestellter, separater Folgeauftrag (`docs/ASSUMPTIONS.md` #353/#374).

## Warum jeder Connector eine Mock-Implementierung *zuerst* bekommt

1. Der komplette Finance-/Sales-Workflow (Phase 7/8) muss ohne echte
   Drittanbieter-Zugangsdaten entwickel- und testbar sein — sowohl lokal
   als auch in CI (kein GitHub-Actions-Secret für DATEV/HubSpot/Twilio
   nötig, um die Kernlogik zu verifizieren).
2. Die Demo-Instanz ("Musterwerk GmbH", Phase 13) läuft dauerhaft mit
   Mock-Connectoren — es gibt keine echten Bankdaten/Kundendaten Dritter im
   Demo-Betrieb.
3. Sobald ein Kunde echte Zugangsdaten bereitstellt, wechselt nur die
   Env-Variable (`FINANCE_CONNECTOR=datev` etc.) — die aufrufende
   Fachlogik (Finance-/Sales-Workflow, Agent-Tools) ändert sich nicht,
   weil sie ausschließlich gegen das Interface programmiert ist.

## Was für eine reale Anbindung fehlt (pro Connector)

Jeder reale Connector benötigt, bevor er implementiert werden kann:

1. Ein OAuth-App-/Partner-Registrierung beim jeweiligen Anbieter (Client
   ID/Secret — siehe die entsprechenden `*_CLIENT_ID`/`*_CLIENT_SECRET`
   Variablen in `.env.example`).
2. Für DATEV zusätzlich: eine DATEV-Partnerschaft/Zulassung (eigener,
   separater Prozess, siehe `docs/DATEV_INTEGRATION.md`).
3. Testzugang zur jeweiligen Sandbox-/Test-Umgebung des Anbieters, um die
   reale Implementierung gegen echte Antworten zu verifizieren (nicht nur
   gegen die eigene Interpretation der Dokumentation).

Ohne (1)–(3) bleibt der jeweilige Connector auf Status
`REQUIRES PROVIDER CREDENTIALS` (§63) — dies ist ein echter, dokumentierter
Blocker, kein Implementierungsversäumnis.
