# Platform RBAC und Sicherheitsdomäne (Amendment 03 §2–§3, §23)

Quelle der Wahrheit im Code: `packages/shared/src/platform.ts` (Rollen, Scopes, Matrix), `apps/api/src/platform/auth/*` (Anmeldung, Guards),
`apps/api/src/platform/identity/*` (Identitätsverwaltung). Tests: `platform.spec.ts`, `platform-security-boundary.e2e-spec.ts`,
`platform-identity.service.spec.ts`.

## 1. Domänentrennung

| | Mandantendomäne | Plattformdomäne |
|---|---|---|
| Identität | `users` (an genau einen Mandanten gebunden, RLS) | `platform_users` (ohne Mandantenbezug, RLS über `app.platform_scope`) |
| Rollen | `roles`/`user_roles` je Mandant (`TENANT_ADMIN`, `SYSTEM_ADMIN` = Mandantenrolle!, …) | `platform_role_assignments` (`PLATFORM_*`) |
| Token | `JWT_SECRET`, Claims `tenantId`, `roles`, `permissions` | `PLATFORM_JWT_SECRET`, Claims `sub`, `sid`, `dom=PLATFORM`, `aud=orbit-platform` |
| Sitzung | Refresh-Token je Nutzer | `platform_sessions`, **bei jedem Request** gegen die Datenbank geprüft |
| Routen | `/api/v1/*` | `/api/v1/platform/*` |

* Ein Mandanten-Token scheitert auf Plattformrouten an der Signatur (401); ein Plattform-Token scheitert auf Mandantenrouten ebenso.
* **Rollen und Scopes stehen nicht im Token.** Sie werden pro Request aus der Datenbank gelesen; ein Rollenentzug, eine Deaktivierung oder ein Logout wirken sofort.
* Mandantenrollen dürfen nie `PLATFORM_*` heißen: Prüfung im Code (`assertTenantRoleName`) **und** DB-Check `roles_name_not_platform_chk`. Plattformrollen
  lassen sich nur als `PLATFORM_*` zuweisen (DB-Check auf `platform_role_assignments.role`).
* Ist `PLATFORM_JWT_SECRET` nicht gesetzt, ist die Domäne ausgeschaltet (503, kein Standard-Secret). Das Secret muss sich von `JWT_SECRET` unterscheiden (Konfigurationsprüfung).

## 2. Rollen und Scopes

Die Matrix steht als Code in `PLATFORM_ROLE_SCOPES` und ist durch `platform.spec.ts` abgesichert (u. a.: nur Owner verwaltet Identitäten; Plattform-Secrets setzen nur Owner und
Operator; Support kann weder konfigurieren noch Features ändern; Kill Switch nur Owner/Security/Release Manager).

**Mandantendaten werden von keiner Rolle gelesen.** Der Scope `platform.diagnostics.payload.read` ist keiner Rolle zugeordnet, auch nicht dem Owner; er kann ausschließlich eine
aktive Support-Session verleihen (Phase OPS-5, noch nicht umgesetzt).

## 3. Anmeldung, Sitzung, Step-up

* `POST /platform/auth/login` – argon2-Prüfung auch bei unbekannter E-Mail (keine Konto-Enumeration über die Antwortzeit), strengere Drosselung als die Mandantenanmeldung
  (`PLATFORM_AUTH_RATE_LIMIT_MAX`, Standard 20 je 5 min). Fehlschläge werden auditiert; die E-Mail nur als Hash.
* Access Token 15 min (`PLATFORM_ACCESS_TTL`); Refresh-Token rotiert (einmal verwendbar); im **Cookie-Modus** (Header `X-Orbit-Platform-Cookie: 1`, Browser) nur als httpOnly-Cookie, nie im Antwortkörper; absolute Sitzungsgrenze `PLATFORM_SESSION_MAX_HOURS` (Standard 8) – ein Refresh verlängert sie nie.
* Sitzungen sind an die Umgebung gebunden (`ORBIT_ENVIRONMENT`); eine Sitzung aus einer anderen Umgebung wird abgewiesen.
* **Step-up** (`POST /platform/auth/step-up`): erneute Passwortprüfung öffnet ein Erhöhungsfenster (`PLATFORM_STEP_UP_MINUTES`, Standard 5). Kritische Operationen
  (`@RequireStepUp()`): Identitäten anlegen/Rollen ändern/deaktivieren, Anbieter/Modelle/Profile/Routen ändern, Plattform-Secrets setzen/rotieren, Notbremse.
* **Ehrliche Grenze:** Step-up ist eine Passwort-Neuprüfung, **kein MFA**. `authenticationAssurance` kennt `MFA` als reservierten Wert; MFA/WebAuthn ist nicht umgesetzt.

## 4. Identitätsverwaltung

`POST/GET /platform/identities`, `PUT /platform/identities/:id/roles`, `POST /platform/identities/:id/disable` – nur mit `platform.identity.manage` (Owner) und Step-up.
Rollenänderung/Deaktivierung beenden alle Sitzungen der betroffenen Person sofort. Der **letzte aktive Owner** kann weder entzogen noch deaktiviert werden.
Die erste Identität legt `apps/api/scripts/platform-bootstrap.ts` an (idempotent; Passwort aus der Umgebung oder einmalig zufällig auf der Konsole).

## 5. Offene Punkte

* MFA/WebAuthn, Identity-Provider-Anbindung (SSO) für Betreiber.
* Selbstbedienungs-Passwortwechsel gibt es (`POST /platform/auth/change-password`, UI unter `/platform/account`): aktuelles Passwort wird erneut geprüft, alle **anderen** Sitzungen enden, Audit `PLATFORM_PASSWORD_CHANGED` ohne Passwort. Offen: ein Zurücksetzen durch den Owner für Personen, die ihr Passwort vergessen haben (heute: Zugang neu anlegen), und Ablaufdauer/Passwort-Verlauf.
* Plattform-UI (`/platform/*`): umgesetzt, siehe [`PLATFORM_UI.md`](PLATFORM_UI.md); maßgeblich bleibt die Prüfung der API. Die Verwaltung der Zugänge (anlegen, Rollen, deaktivieren) ist dort für den Owner verfügbar.
