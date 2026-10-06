# Support-Sessions (Amendment 03 §18)

Code: `packages/shared/src/support-session.ts` (Regeln), `apps/api/src/platform/support/*` (Dienst, API), Tabelle `platform_support_sessions` (Plattform-RLS, DB-Check Vier-Augen).
Tests: `support-session.spec.ts`, `platform-support-sessions.e2e-spec.ts` (14, echte DB).

**Es gibt kein Impersonation.** Kein „als Kunde einloggen“, kein dauerhaftes Betreiberkonto im Mandanten, kein Token mit Mandantenrechten für Betreiber. Mandanteninhalte sind für Betreiber nur über eine
ausdrücklich angeforderte, begründete, zeitlich begrenzte Sitzung mit enumerierten Scopes erreichbar; die Rollenmatrix (`PLATFORM_RBAC.md`) gibt **keiner** Rolle einen Inhalts-Scope.

## Ablauf

```text
Support/Operator/Owner fordert an: Mandant · Modus · Scopes · Dauer · Grund (Code + Text) · Ticket
   │  Prüfung gegen Plattformrichtlinie (Modus↔Scopes, Dauer ≤ PLATFORM_SUPPORT_SESSION_MAX_MINUTES, nicht verfügbare Scopes)
   ├─ nur Diagnose/Metadaten/Konfiguration ─▶ sofort ACTIVE
   └─ mit Fachinhalt (case.payload.read) ───▶ REQUESTED ─▶ Freigabe durch ZWEITE Person (Security/Owner, Step-up) ─▶ ACTIVE
ACTIVE: Ablauf = Aktivierung + beantragte Dauer. Keine Verlängerung (weder still noch per Endpunkt) – neue Anforderung nötig.
Ende: Ablauf · Schließen durch die anfordernde Person · Widerruf durch Security/Owner (sofort)
```

| Modus | erlaubte Scopes | Mandanteninhalt |
|---|---|---|
| `READ_DIAGNOSTICS` | `diagnostics.read`, `connector.status.read` | nein |
| `READ_TENANT_CONTEXT` | zusätzlich `tenant.config.read`, `case.metadata.read`, `case.payload.read` | nur mit `case.payload.read` (und Freigabe) |
| `ASSISTED_ACTION` / `tenant.action.execute` | – | **nicht verfügbar** (erfordert konkrete Policy/Freigabe, Amendment 03 §18.3) → wird abgelehnt |

## Zugriff

`GET /platform/support-sessions/:id/{tenant | cases | cases/:caseId/diagnostics | cases/:caseId/payload}`. **Bei jedem Aufruf** werden Sitzung, Status/Ablauf (`expiresAt` zählt sofort, auch ohne Statusschreibung),
anfordernde Person (nur sie darf die Session nutzen) und Scope geprüft; jede Verweigerung wird mit Grund auditiert (`PLATFORM_ACCESS_DENIED`).

* `tenant` – Status, Sperren, Kohorten, Policy-Modi, Verbindungsstatus (kein Fachinhalt).
* `cases` – Kennungen, Typ, Status, Blueprint, Zeiten – **ohne Titel/Inhalte**.
* `diagnostics` – technische Projektion (`PLATFORM_DIAGNOSTICS.md`).
* `payload` – Business-Projektion mit Knotendetails, Fakten und Entwurfstexten, geschwärzt (Secrets); nur `case.payload.read`.

Mandantenscharf: jeder Zugriff läuft über `forTenantId(session.targetTenantId)`; ein Fall eines anderen Mandanten ist weder per ID (404) noch in Listen erreichbar. Die Mandanten-ID einer Session ist unveränderlich.

## Audit (OPS-23)

`PLATFORM_SUPPORT_SESSION_REQUESTED/ACTIVATED/CLOSED`, `PLATFORM_SUPPORT_ACCESS` (je Zugriff: Bereich, Fall-ID, betroffene Knoten/Entwürfe als IDs/Zähler – **nie Inhalt**), `PLATFORM_ACCESS_DENIED`. Alle mit `supportSessionId`,
`targetTenantId`, Akteur, Begründung; `tenant_id` bleibt NULL (Betreiber-Audit, für Mandanten unsichtbar).

## Rollen

Anfordern: Support, Operator, Owner · Freigeben/Widerrufen: Security, Owner (nie die eigene Anforderung – Anwendungslogik **und** DB-Check) · Lesen aller Sessions: Security, Owner, Auditor · Support sieht nur eigene Sessions.

## Offen

Mandantensicht auf die eigene Support-Historie (Amendment 03 §18.5: „später“, kein Pflichtbestandteil), unterstützte Aktionen im Mandanten, automatisches Ablaufen-Schreiben (Ablauf ist abgeleitet; der Statuswert `EXPIRED` wird nicht persistiert), Benachrichtigung der Freigebenden.
