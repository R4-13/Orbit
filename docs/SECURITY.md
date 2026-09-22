# Security — Project ORBIT

Konsolidierte Sicherheitsübersicht: was tatsächlich implementiert ist,
was bewusst (noch) nicht, und warum. Diese Datei fasst zusammen, was
bisher über `docs/ASSUMPTIONS.md` (Phase 15, #85-93) und
`docs/KNOWN_LIMITATIONS.md` verteilt war — für Details/Live-Verifikation
der einzelnen Punkte siehe dort. Kein Punkt hier ist neu erfunden; jeder
ist am Code verifizierbar.

## Bedrohungsmodell (Kurzfassung)

ORBIT ist eine Multi-Tenant-B2B-SaaS-Anwendung, die administrative
Finance-/Sales-Prozesse für mehrere unabhängige Kunden (Tenants) auf
gemeinsamer Infrastruktur automatisiert, teilweise autonom (Agent
Runtime, siehe `docs/AGENT_ARCHITECTURE.md`). Die zwei größten Risiken
sind entsprechend:

1. **Cross-Tenant-Datenzugriff** — Tenant A darf niemals Daten von
   Tenant B sehen oder verändern, auch nicht bei einem Bug in der
   Anwendungslogik.
2. **Unautorisierte Aktionen mit finanzieller/geschäftlicher Wirkung** —
   ein Agent oder ein Nutzer ohne ausreichende Berechtigung darf keine
   Rechnung freigeben, keinen Lieferanten aktivieren, keine Zahlung
   auslösen.

Beides wird durch mehrschichtige, unabhängig wirksame Kontrollen
adressiert (siehe unten) — keine einzelne Kontrolle ist der einzige
Schutz gegen eines dieser beiden Risiken.

## 1. Multi-Tenant-Isolation

Zwei unabhängige Verteidigungslinien (`docs/ARCHITECTURE.md` §"Zwei
Verteidigungslinien", live verifiziert in `docs/ASSUMPTIONS.md` #85-87):

1. **Anwendungsschicht**: `PrismaService.forTenantId(tenantId)`
   (`packages/domain/src/tenant-scope.ts`) — eine Prisma-Client-Extension,
   die jeden Read automatisch mit `where.tenantId` filtert und jeden
   Write mit `tenantId` stempelt. Ein Zugriffsversuch auf einen fremden
   Tenant über einen falsch gescopten Query wirft
   `TenantIsolationViolationError`, statt still leer oder falsch zu
   antworten.
2. **Datenbankschicht**: Postgres Row-Level Security auf 21 von 24
   tenant-gescopten Tabellen (`FORCE ROW LEVEL SECURITY` + eine
   `tenant_isolation`-Policy pro Tabelle). Die laufende Anwendung
   verbindet sich über eine eigene, **nicht-superuser** Rolle
   (`orbit_app`, `DATABASE_URL_APP`) — getrennt von der Migrations-Rolle
   (`orbit`, `DATABASE_URL`), die zwangsläufig Superuser ist und RLS
   strukturell umgeht (Postgres-Verhalten, keine Fehlkonfiguration).
   `forTenant()` setzt die Tenant-Session-GUC (`app.tenant_id`) pro
   Transaktion (SET-LOCAL-Semantik) — kein Leck über den
   Connection-Pool auf eine spätere, fremde Anfrage möglich.

**Bewusste Ausnahme**: `role_permissions`, `user_roles`,
`refresh_tokens` haben keine eigene `tenant_id`-Spalte und sind nur
indirekt über die Elterntabelle (`roles.tenant_id`/`users.tenant_id`)
abgesichert — sie werden im aktuellen Code nie direkt mit
nutzergesteuerten Filtern abgefragt (`docs/ASSUMPTIONS.md` #87).

**Bewusster Bypass**: `PrismaService.withRlsBypass()` für die Handvoll
echter Cross-Tenant-Fälle (Login, bevor der Tenant bekannt ist;
Tenant-Bootstrap, bevor der Tenant existiert) — fester, auditierbarer
Code in `apps/api`, nie durch Nutzereingaben beeinflusst.

## 2. Authentifizierung

- **Passwort-Hashing**: argon2 (`AuthService`).
- **Access-Token**: JWT, zustandslos, 15 Minuten Standard-Laufzeit
  (`JWT_ACCESS_TTL`). Trägt Rollen + Permissions direkt im signierten
  Payload — `JwtStrategy.validate()` macht **keinen** DB-Rückruf pro
  Request (Performance-Tradeoff: eine Rechteänderung wirkt erst nach
  Ablauf/Refresh des aktuellen Tokens, nicht sofort).
- **Refresh-Token**: 7 Tage Standard-Laufzeit (`JWT_REFRESH_TTL`),
  SHA-256-gehasht in der DB gespeichert (nie im Klartext), Single-Use mit
  Rotation — `AuthService.refresh()` widerruft den alten Token
  unabhängig vom Erfolg der Ausstellung des neuen (verhindert
  Wiederverwendung eines gestohlenen Refresh-Tokens nach einmaliger
  Benutzung durch den legitimen Client).
- **Rate-Limiting**: global über `ThrottlerGuard` als `APP_GUARD`
  (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`, Default 120 Requests/60s),
  plus ein eigenes, strengeres Limit auf `/auth/login` und
  `/auth/refresh` (`AUTH_RATE_LIMIT_MAX`/`_WINDOW_MS`, Default 60/5min —
  gegen die tatsächliche Login-Last der E2E-Suite kalibriert, siehe
  `docs/ASSUMPTIONS.md` #91). **Hinweis**: Diese beiden Auth-Limits
  werden direkt aus `process.env` gelesen (`auth.controller.ts`), nicht
  über das Zod-validierte `OrbitEnv`-Objekt wie der Rest der
  Konfiguration — ein kleiner Stilbruch, kein Sicherheitsproblem (beide
  Werte sind reine Zahlen mit sinnvollem Default), aber erwähnenswert für
  wer künftig `packages/config/src/env.ts` als vollständige Quelle
  erwartet.
- **Session-Speicherort (Frontend)**: JWT liegt in `localStorage`, nicht
  in einem httpOnly-Cookie (`docs/ASSUMPTIONS.md` #68, #92 — bewusste
  MVP-Entscheidung, kein Versehen). **Konsequenz**: ein erfolgreicher XSS
  auf der Web-Origin könnte die Tokens auslesen. Eine Migration zu
  httpOnly-Cookies bräuchte einen Auth-Proxy (Next.js Middleware/Route
  Handler) + CSRF-Schutz für den dann cookie-basierten Pfad — als
  offener Härtungs-Kandidat dokumentiert, nicht umgesetzt.

## 3. Autorisierung

Zwei bewusst getrennte Achsen (siehe `docs/AGENT_ARCHITECTURE.md` für
die ausführliche Begründung):

- **RBAC** (`packages/shared/src/permissions.ts`) — gated menschliche
  Requests. Sechs Rollen (`TENANT_ADMIN`, `FINANCE_USER`, `SALES_USER`,
  `APPROVER`, `VIEWER`, `SYSTEM_ADMIN`) × eine feste Liste von
  Permission-Strings. Kein globaler Guard — jeder geschützte Controller
  wendet `@UseGuards(JwtAuthGuard, PermissionsGuard)` +
  `@RequirePermissions(...)` explizit an; nur `AuthController` und
  `HealthController` sind absichtlich offen.
- **Policy Engine** (`PolicyConfig`, `PolicyEnforcementService`) — gated
  Agent-Autonomie (darf ein Agent diese Aktion *selbstständig*
  ausführen: `DISABLED`/`SUGGEST_ONLY`/`REQUIRE_APPROVAL`/`AUTONOMOUS`).
  **Fail-Safe-Verhalten**: fehlt für eine Tenant/Action-Kombination eine
  `PolicyConfig`-Zeile, liefert `resolveMode()` `REQUIRE_APPROVAL` (nicht
  den Code-Default) — sicherer Fehlschlag statt versehentlicher
  Autonomie. `payment.execute` ist zusätzlich **hart auf `DISABLED`
  gesperrt**, nicht nur per Default (§60 Nicht-Ziel: keine automatische
  Banküberweisung, unabhängig von jeder Tenant-Konfiguration).

## 4. Datenverschlüsselung

- **Transport**: TLS wird von der jeweiligen Deployment-Umgebung
  terminiert (Reverse Proxy/Load Balancer) — nicht Teil der
  Anwendung selbst. Siehe `docs/DEPLOYMENT.md`.
- **At-Rest, Connector-Credentials**: seit Phase 19g tatsächlich
  implementiert. `CredentialEncryptionService`
  (`apps/api/src/security/`) verschlüsselt/entschlüsselt mit
  AES-256-GCM (`CREDENTIAL_ENCRYPTION_KEY`, ein frischer, zufälliger
  IV pro Aufruf — nie derselbe IV zweimal mit demselben Schlüssel;
  authentifiziert, also manipulationssicher: eine veränderte
  Ciphertext/IV/Tag-Kombination lässt `decrypt()` fehlschlagen statt
  stillschweigend falsche Daten zu liefern). Neues `IntegrationsModule`
  (`GET /integrations`, `PUT /integrations/:connectorType/credentials`,
  `DELETE /integrations/:connectorType`, gated über
  `INTEGRATION_CONFIGURE`) ist der erste echte Schreib-/Lesepfad für
  `Integration.encryptedCredentials` — die entschlüsselten Klartext-
  Credentials werden **nie** über die API zurückgegeben, nur ein
  `hasCredentials: boolean`-Flag; Entschlüsselung ist ausschließlich für
  die künftige interne Nutzung durch einen echten Connector-Adapter
  vorgesehen (noch keiner vorhanden, jeder Connector bleibt ein Mock,
  siehe `docs/INTEGRATIONS.md`). Live gegen echte Postgres verifiziert:
  die gespeicherten Bytes sind nachweislich Chiffretext, kein Klartext
  im DB-Dump auffindbar.
- **At-Rest, sonstige Daten**: keine anwendungsseitige Verschlüsselung
  einzelner Felder (z. B. IBAN, personenbezogene Daten) — Schutz beruht
  auf RLS + Infrastruktur-Verschlüsselung (Postgres-Volume-Encryption,
  je nach Hosting-Umgebung).

## 5. Eingabevalidierung

- **HTTP-Ebene**: globale `ValidationPipe` (`whitelist: true,
  forbidNonWhitelisted: true, transform: true`, `main.ts`) — jeder
  DTO-Typ (`class-validator`-Decorators) lehnt unbekannte Felder ab,
  statt sie stillschweigend zu ignorieren.
- **Datei-Upload**: seit Phase 19g serverseitig durchgesetzt, mit einer
  bewusst bestehen bleibenden Einschränkung. `DocumentsService.
  createUploadUrl()` prüft die **deklarierte** Größe/MIME-Type gegen
  `MAX_UPLOAD_SIZE_BYTES`/`ALLOWED_UPLOAD_MIME_TYPES`
  (`packages/config/src/env.ts`, konfigurierbar) und lehnt eine
  Anfrage außerhalb dieser Grenzen ab, **bevor** überhaupt eine
  `Document`-Zeile oder eine Presigned-URL erzeugt wird (live
  verifiziert: 403 für zu große Datei, 403 für nicht erlaubten
  MIME-Type, 201 für eine gültige PDF). **Weiterhin offen**: da Dateien
  nie durch den API-Prozess laufen (direkter Client→S3-Upload), gibt es
  **keine Prüfung, dass die tatsächlich hochgeladenen Bytes** dieser
  Deklaration entsprechen (kein Content-Type-Sniffing, keine
  Größen-Verifikation nach dem Upload) — ein Client könnte technisch
  trotzdem größere/andere Bytes unter der deklarierten Signatur hochladen.
  Ein echter Check bräuchte entweder einen S3-Event-Webhook
  (Post-Upload-Validierung + ggf. Löschung) oder den Umweg über
  `putObjectBytes()` (Phase 18, aktuell nur vom Agent-Intake-Pfad
  genutzt) für jeden Upload — beides eine größere Änderung am
  Upload-Flow, bewusst nicht in dieser Phase mitgezogen.
- **Keine Antiviren-/Malware-Prüfung** hochgeladener Dokumente.

## 6. HTTP-Härtung

- `helmet()` global aktiv (`main.ts`) — Standard-Security-Header
  (HSTS, X-Content-Type-Options, etc.).
- **CORS**: `CORS_ALLOWED_ORIGINS` (kommagetrennte Liste), `credentials:
  true` — kein Wildcard-Origin in Produktion vorgesehen.
- **Fehlerantworten**: globaler `OrbitExceptionFilter` mappt jeden
  bekannten `OrbitError` auf den deklarierten HTTP-Status + strukturierten
  JSON-Body (`{code, message, details}`) — keine rohen
  Stacktraces/Interna in der Response. Unbekannte (nicht-`OrbitError`)
  Exceptions fallen auf NestJS' Standard-500 zurück.

## 7. Audit-Trail

`AuditLog` (append-only, `AuditService.record()`) — jede sicherheits-
oder geschäftsrelevante Aktion (Freigaben, Ablehnungen, Statusänderungen,
Agent-Läufe, Tool-Aufrufe, Policy-Entscheidungen) wird mit `actorType`
(`USER`/`AGENT`/`SYSTEM`), `actorUserId` (optional, bei Agent-Aktionen
oft leer), Entity-Referenz und strukturiertem `payload` protokolliert.
Bewusst **keine Foreign Key auf `User`** — der Audit-Trail muss
unabhängig vom Lebenszyklus eines Nutzerkontos lesbar bleiben (ein
gelöschter Nutzer darf seine historischen Aktionen nicht aus dem Log
reißen).

## 8. Webhook-Idempotenz (vorbereitet)

Kein einziger echter Webhook-Empfänger existiert bisher (jeder Connector
ist noch ein Mock) — trotzdem bereits vorbereitet, damit der erste
tatsächliche Provider-Webhook (z. B. ein Microsoft-Graph-Postfach-Push)
nicht ohne Duplikatschutz gebaut wird. `WebhookIdempotencyService`
(`apps/api/src/webhooks/`) plus das neue `WebhookEvent`-Modell
(eindeutiger Index auf `(tenantId, source, externalEventId)`) machen die
Prüfung "wurde dieses Ereignis schon verarbeitet?" atomar auf
Datenbankebene — ein `INSERT`-Konflikt statt eines separaten
"erst lesen, dann schreiben"-Schritts, der unter echter paralleler
Zustellung (jeder Webhook-Anbieter garantiert nur *at-least-once*, nie
*exactly-once*) ein Race-Fenster hätte. Live verifiziert, inkl. eines
echten Nebenläufigkeits-Tests (5 parallele Aufrufe desselben Ereignisses
— genau einer "gewinnt").

## 9. Bekannte offene Punkte (Zusammenfassung)

| Punkt | Status | Verweis |
|---|---|---|
| httpOnly-Cookie statt `localStorage`-JWT | Bewusst zurückgestellt | `ASSUMPTIONS.md` #68, #92 |
| Datei-Upload: tatsächliche Bytes nicht gegen deklariertes Größe/MIME-Type geprüft | Nur die Deklaration wird serverseitig durchgesetzt (seit Phase 19g), nicht die real hochgeladenen Bytes | Abschnitt 5 |
| Antiviren-/Malware-Scan für Uploads | Nicht implementiert | Abschnitt 5 |
| Dependency-Vulnerability-Scanning (`pnpm audit` o. Ä.) in CI | Nicht Teil der Pipeline | `KNOWN_LIMITATIONS.md` |
| `role_permissions`/`user_roles`/`refresh_tokens` ohne direkte RLS-Policy | Indirekt über Elterntabelle abgesichert, akzeptierter MVP-Tradeoff | `ASSUMPTIONS.md` #87 |
| Rechteänderungen wirken erst nach Token-Ablauf | Architektur-Tradeoff (zustandsloses JWT) | Abschnitt 2 |
| Webhook-Endpunkt selbst | `WebhookIdempotencyService` ist einsatzbereit, aber es gibt noch keinen echten Webhook-Empfänger, der ihn aufruft (kein realer Connector) | Abschnitt 8 |

Für den vollständigen Implementierungsstand jeder einzelnen Komponente
siehe [`docs/IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md); für
die Begründung jeder Entscheidung siehe
[`docs/ASSUMPTIONS.md`](ASSUMPTIONS.md).
