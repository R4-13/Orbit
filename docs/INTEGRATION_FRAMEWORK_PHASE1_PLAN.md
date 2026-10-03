# Integration Framework — Phase 1 Umsetzungsplanung

Konkrete Umsetzungsplanung für `docs/ORBIT_MASTER_SPECIFICATION_v3_AMENDMENT_01_INTEGRATION_FRAMEWORK.md`
(v2.0), §23 Punkt 4 ("eine konkrete Umsetzungsplanung für Phase 1 erstellen").
Diese Datei wird während der Umsetzung aktualisiert; der jeweils aktuelle
Implementierungsstand steht in `docs/IMPLEMENTATION_STATUS.md`.

## Ist-Zustand (vor diesem Increment, siehe docs/ASSUMPTIONS.md für Details)

Wiederverwendbar, bleibt erhalten:

- `CredentialEncryptionService` (`apps/api/src/security/`) — echtes
  AES-256-GCM, bereits korrekt implementiert. Wird von der neuen
  `CredentialVaultService` als Backing-Mechanismus genutzt, nicht ersetzt.
- `Integration`-Prisma-Modell + `IntegrationConnectorType`-Enum (bereits
  inkl. `GMAIL`) — wird erweitert, nicht ersetzt.
- `MailConnector`/`CalendarConnector`/`CrmConnector`/`FinanceConnector`-
  Interfaces (`packages/integration-core`) + ihre Mock-Implementierungen —
  bleiben für den bestehenden Nutzungspfad (Agent-Tools) unverändert.
- `*_CONNECTOR`-Env-Variablen-Pattern (`connectors.module.ts`) — wird um
  einen `gmail`-Zweig für `MAIL_CONNECTOR` ergänzt, nicht umgebaut.
- `AiProviderResolverService.resolveForTenant()` — architektonisches
  Vorbild für den neuen, zwingend tenant-aufgelösten Gmail-OAuth-Zugriff
  (siehe "Wichtiger Architektur-Fund" unten).

Muss entfernt/ersetzt werden:

- Freies JSON-Credential-Textfeld im Enduser-UI
  (`apps/web/src/app/(app)/integrations/page.tsx`).
- `UpsertIntegrationCredentialsDto` (`Record<string, unknown>`-Freitext).
- Direkte `encryptedCredentials: Bytes?`-Speicherung auf `Integration` ohne
  Vault-Abstraktion (Amendment v2 §6 verlangt eine `credential_reference`).

## Wichtiger Architektur-Fund (während der Analyse)

`MailConnector` (und ebenso `CalendarConnector`/`CrmConnector`/
`FinanceConnector`) ist heute ein **prozessweiter Singleton ohne
`tenantId`-Parameter** in jeder Methode (`listNewMessages()`,
`sendMessage()` — keine Tenant-Angabe). Das passt für Mocks, ist aber mit
echten, pro Tenant unterschiedlichen OAuth-Credentials strukturell
unvereinbar: ein einzelner injizierter `MailConnector` kann nicht wissen,
welches Tenants Google-Token er gerade verwenden soll.

Entscheidung: **Die bestehende `MAIL_CONNECTOR`-Injektion (genutzt von
`SalesAgentTools` für ausgehende Follow-up-Mails) bleibt unverändert.**
Der neue Gmail-OAuth-Connector für das Integration Framework bekommt einen
eigenen, tenant-aufgelösten Zugriffspfad nach dem bereits etablierten
Vorbild von `AiProviderResolverService.resolveForTenant()` — keine
disruptive Änderung an einer bestehenden, funktionierenden Komponente
(Amendment §18.5/§23.5). Eine spätere Migration von `SalesAgentTools` auf
den tenant-aufgelösten Connector ist eine bewusst zurückgestellte, separate
Entscheidung — außerhalb des für Phase 1 geforderten Scopes (Gmail-
Connect/Read-Flow, nicht Umbau des bestehenden Sales-Follow-up-Pfads).

## Increments (in Reihenfolge, jedes einzeln typecheck/lint/test/verifiziert)

### A — Datenmodell & Credential Vault Abstraktion

- Neues Prisma-Modell `IntegrationCredentialSecret` (tenant-gescoped
  Ablage-Tabelle hinter der Vault-Abstraktion: `id`, `tenantId`,
  `encryptedValue: Bytes`, `version`, `createdAt`, `updatedAt`).
- `Integration`-Modell erweitert: `externalAccountId`,
  `externalAccountDisplayName`, `grantedCapabilities: Json?`,
  `credentialReference: String?` (ersetzt `encryptedCredentials: Bytes?`
  direkt auf dem Modell), `lastSuccessAt`, `lastErrorAt`, `lastErrorCode`.
- `IntegrationStatus`-Enum erweitert: `+ CONNECTING, DEGRADED,
  AUTH_REQUIRED` (§10).
- Neue `CredentialVaultService`
  (`storeSecret`/`readSecret`/`updateSecret`/`deleteSecret`,
  `apps/api/src/security/credential-vault.service.ts`) — nutzt intern
  `CredentialEncryptionService` + das neue Prisma-Modell. Einzige Stelle,
  die je ein Klartext-Secret sieht.
- Migration (keine Altdaten-Migration nötig — jeder bestehende
  `Integration`-Datensatz im Demo-/Dev-Stand ist ein Mock ohne echte
  Credentials, bestätigt durch Code-Analyse).
- Unit-Tests für `CredentialVaultService`.

### B — Connector Registry (generisches Framework, §4)

- Neues `packages/integration-core/src/registry/` mit `ConnectorMetadata`-
  Typ + statischer Registry für alle 7 bestehenden Connector-Typen
  (Metadaten: `authentication.type`, `capabilities`, `setup.mode`,
  `sonde_supported`, …). Statisch (kein DB-Admin-UI) — ausreichend für
  Phase 1/2, vermeidet unnötige Komplexität vor echtem Bedarf.
- Neue Endpunkte `GET /integrations/connectors`,
  `GET /integrations/connectors/:id`.

### C — OAuth2-Basis-Service + Gmail-Connector (real, gegen offizielle Google-Doku)

- Generischer `OAuth2Service` (Authorization-URL-Aufbau, `state`-CSRF-
  Schutz, PKCE, Token-Exchange) — providerunabhängig, Google ist der erste
  Verwender.
- `GmailConnectorService` (tenant-aufgelöst, siehe Architektur-Fund oben):
  `startConnection`/`completeConnection`/`testConnection`/
  `refreshAuthentication`/`disconnect` gegen die echte Google-API
  (`https://accounts.google.com/o/oauth2/v2/auth`,
  `https://oauth2.googleapis.com/token`,
  `https://gmail.googleapis.com/gmail/v1/...` — ausschließlich offizielle
  Google-Endpunkte, keine Vermutungen).
- Neue Endpunkte: `POST /integrations/:connectorId/connect`,
  `GET /integrations/:connectorId/callback`,
  `POST /integrations/connections/:id/test`,
  `POST /integrations/connections/:id/reconnect`,
  `DELETE /integrations/connections/:id`.
- Contract-/Mock-Tests für den OAuth-Flow (State-Validierung, Token-
  Exchange-Request-Shape) — **ohne** echte `GOOGLE_CLIENT_ID`/`SECRET`
  lauffähig (gemocktes `fetch`).
- Live-Validierung gegen ein echtes Google-Konto bleibt
  `REQUIRES_PROVIDER_CREDENTIALS`, bis echte `GOOGLE_CLIENT_ID`/
  `GOOGLE_CLIENT_SECRET` in der lokalen `.env` hinterlegt sind — blockiert
  laut Amendment v2 §23 ausdrücklich **nicht** die Implementierung selbst.

### D — Neues Enduser-UI (kein JSON mehr)

- `apps/web/.../integrations/page.tsx` ersetzt: OAuth-Connectoren zeigen
  „Mit Google verbinden"-Button (führt zu `POST .../connect`, folgt der
  zurückgegebenen Autorisierungs-URL); nach Callback-Redirect zeigt die
  Seite das dynamisch ermittelte Konto + Test/Neu verbinden/Trennen.
  Nicht-OAuth-Connectoren (DATEV/Lexware/HubSpot/Twilio, weiterhin Mock)
  bekommen ein aus der Registry-Metadatenstruktur generiertes, strukturiertes
  Formular statt des Freitext-JSON-Felds (§8/§21.4).

### E — Dokumentation & Migration

- `docs/INTEGRATIONS.md` aktualisiert (Gmail: Interface + Connector:
  IMPLEMENTED, Real: `REQUIRES PROVIDER CREDENTIALS` bis echte Werte
  vorliegen).
- `docs/ASSUMPTIONS.md`/`docs/IMPLEMENTATION_STATUS.md` je Increment
  aktualisiert, dieser Plan als abgeschlossen markiert.

## Status

| Increment | Status |
|---|---|
| A — Datenmodell & Credential Vault | ✅ Abgeschlossen (`docs/ASSUMPTIONS.md` #351-363) |
| B — Connector Registry | ✅ Abgeschlossen (`docs/ASSUMPTIONS.md` #364-371) |
| C — OAuth2 + Gmail-Connector | ✅ Abgeschlossen (`docs/ASSUMPTIONS.md` #372-381) — Live-Validierung gegen echtes Google-Konto bleibt `REQUIRES_PROVIDER_CREDENTIALS` |
| D — Neues UI | ✅ Abgeschlossen (`docs/ASSUMPTIONS.md` #382-385) — live im Browser verifiziert |
| E — Doku/Migration | ✅ Abgeschlossen (diese Datei, `docs/IMPLEMENTATION_STATUS.md`, `docs/ASSUMPTIONS.md`) |
