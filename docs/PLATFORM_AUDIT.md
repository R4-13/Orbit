# Platform Audit (Amendment 03 §19)

**Ein Audit-Speicher für beide Domänen** (ADR OPS-A3, Governance GOV): `audit_logs`. Neu sind nur Spalten und eine zweite Domäne – kein konkurrierender Store.

| Spalte | Bedeutung |
|---|---|
| `domain` | `TENANT` (wie bisher) oder `PLATFORM` |
| `tenant_id` | Pflicht bei `TENANT`, **immer NULL** bei `PLATFORM` (CHECK-Constraint) |
| `actor_platform_user_id` | handelnde Plattformidentität (kein FK – Audit überlebt jede Identitätsverwaltung) |
| `target_tenant_id` | betroffener Mandant (kein FK – eine Mandantenlöschung löscht Betreiber-Audit nicht per Cascade) |
| `correlation_id`, `support_session_id` | Korrelation (Support-Sessions: Phase OPS-5) |

## Garantien (getestet in `platform-security-boundary.e2e-spec.ts`)

* **Unveränderlich:** Ein Datenbank-Trigger verbietet `UPDATE` und `DELETE` auf `domain = PLATFORM` – auch mit Plattform-Scope und für die Anwendungsrolle. Es gibt keinen Schreib-/Änderungs-/Löschendpunkt (OAS-03).
* **Isolation:** Die RLS-Policy lässt Mandanten nur `domain = TENANT` der eigenen `tenant_id` sehen (auch nicht mit RLS-Bypass). Plattformzeilen sind nur im Plattform-Scope sichtbar; Mandantencode kann sie weder lesen noch anlegen.
* **Keine Secrets:** Vorher/Nachher laufen durch `redactValue` (Schlüsselnamen **und** Wertmuster: Bearer, `sk-…`, JWT, PEM, URL-Zugangsdaten). Zusätzlich werden `beforeHash`/`afterHash` (SHA-256 über die geschwärzten, kanonisch sortierten Werte) abgelegt (OAS-02/OAS-04).
* **Rollenabhängige Sicht** (`GET /platform/audit`): `audit.read` (Owner, Security, Auditor) alles; `audit.read.scoped` (Operator, FinOps, Release, Engineering) nur Ereignisse des Fachbereichs (Präfixe); `audit.read.own` (Support) nur eigene Handlungen; alle anderen 403.

## Ereignisse

Anmeldung/Abmeldung/Fehlschlag/Step-up, verweigerter Zugriff (Route + fehlender Scope), Identität angelegt/Rolle erteilt/entzogen/deaktiviert, AI-Anbieter/-Modell/-Profil/-Route/-Verbindung/-Secret
geändert, Diagnosezugriff (`PLATFORM_DIAGNOSTICS_READ`, mit Begründung). Die vollständige Typenliste steht in `PLATFORM_AUDIT_EVENT_TYPES`
(`packages/shared/src/platform.ts`); noch nicht ausgelöst werden die Typen für Mandantenlebenszyklus, Overrides, Connector, Feature Flag, Kill Switch, Sicherheitsrichtlinie und Support-Sessions (Phasen OPS-3/OPS-5).

## Offene Punkte

Retention/Archivierung (Platform Security Policy) und Partitionierung bei Volumen sind nicht umgesetzt; Kryptografische Verkettung der Einträge (Hash-Kette) ist nicht vorhanden – die Unveränderlichkeit beruht auf dem Trigger und den DB-Rechten.
