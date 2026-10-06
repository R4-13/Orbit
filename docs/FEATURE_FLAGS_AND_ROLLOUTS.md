# Feature Flags, Kill Switches und Mandantenlebenszyklus (Amendment 03 §6, §14, §15)

Code: `packages/shared/src/platform-control.ts` (reine Logik: `evaluateFlag`, `tenantGateOf`, Kill-Switch-Katalog), `apps/api/src/platform-control/*` (Laufzeit + Schreibpfad),
`apps/api/src/platform/control/*` (Plattform-API). Tests: `platform-control.spec.ts`, `platform-control.e2e-spec.ts` (17, echte DB).

## Feature Flags (`/platform/features`)

| Ebene (stärkste zuerst) | Bedeutung |
|---|---|
| Mandant (`tenantOverrides`) | Wert nur für diesen Mandanten |
| Kohorte (`cohortOverrides`, optional `percent`) | Mandanten mit `feature_cohorts` ∋ Kohorte; Prozentanteil über stabilen Hash je Mandant/Flag/Kohorte (kein Flackern) |
| Umgebung (`environmentOverrides`) | `development/test/staging/production` |
| Standard (`defaultValue`) | sonst |

* Pflicht: `owner`, Beschreibung; optional `expiresAt`. Abgelaufene (`expiresAt`/`EXPIRED`), zurückgezogene (`RETIRED`) und Entwurfs-Flags (`DRAFT`) liefern **nur den Standardwert** – ein Rollout wirkt nie still weiter.
* Reservierte Schlüssel (`security.*`, `auth.*`, `audit.*`, `tenant_isolation…`) lassen sich nicht als Flag anlegen: Sicherheitskontrollen liegen nicht hinter einem optionalen Schalter (Amendment 03 §14.3). Ein Flag liefert nur Werte und kann Mandantenisolation nicht umgehen.
* Änderungen: `expectedVersion` (409 bei veraltetem Stand), Begründung, Audit mit Vorher/Nachher, Step-up. `GET /platform/features/:key/preview` zeigt je Mandant den wirksamen Wert und die bestimmende Ebene sowie die Verteilung.
* Mandantensicht: `GET /api/v1/features` liefert nur Flags mit `exposeToTenant` und nur den eigenen Wert (nie Kohorten, Overrides, andere Mandanten). Mandanten-UI-Konsumenten der Flags gibt es noch nicht – die Infrastruktur steht.
* Kohorten werden über die Mandantenänderung (`PATCH /platform/tenants/:id/lifecycle`, `featureCohorts`) gesetzt.

## Kill Switches (`/platform/kill-switches`)

Fester, im Code definierter Katalog (kein freier Schalter): `ai.executions`, `external.autonomous_send`, `planner.adaptive`. Ziehen/Lösen nur mit `platform.killswitch.write` (Owner, Security, Release Manager), Step-up, Begründung; auditiert inkl. Wirkungsbeschreibung.

| Schalter | Wirkung (serverseitig, sofort für **neue** Aktionen) | Durchsetzungspunkt |
|---|---|---|
| `ai.executions` | Neue KI-Aufrufe aller Pfade (Managed, BYOK, Bootstrap) → `AI_PROVIDER_UNAVAILABLE`; Triage meldet „später“ (`PENDING_TRIAGE`), kein falsches Urteil | `AiProviderResolverService.resolveProfile` |
| `external.autonomous_send` | `AUTONOMOUS` → `REQUIRE_APPROVAL` für externe Sendeaktionen; Mandantenpolicy bleibt unverändert gespeichert | `PolicyEnforcementService.resolveMode` |
| `planner.adaptive` | Planer meldet „nicht verfügbar“; Referenzgraphen laufen weiter | `PlannerService` |

**Sicherer Zustand laufender Fälle (OCF-06, getestet):** Mit gezogenem Schalter wartet eine sonst autonome Rückfrage auf Freigabe (`AWAITING_APPROVAL`, Case `WAITING_FOR_APPROVAL`), es wird nichts versendet, der Case ist nicht abgeschlossen. Nach dem Lösen läuft dieselbe Mandantenpolicy wieder autonom.

**Wirkungsgrenzen (ehrlich):** Entscheidungen werden höchstens 5 s zwischengespeichert (in einem Prozess sofort durch Invalidierung, über mehrere Replikas nach ≤ 5 s). Bei nicht lesbarer Datenbank gilt der zuletzt bekannte Schalterzustand. Schalter für „einzelne Capability“, „einzelnes Modell“ und „Feature-Kohorte“ aus Amendment 03 §15 sind über die vorhandenen Mittel abgebildet (Modell: Notbremse `providers/:key/disable`, Modelllebenszyklus `BLOCKED`; Connector: Lifecycle `SUSPENDED`; Kohorte: Flag-Override) und nicht als eigene Schalter.

## Mandantenlebenszyklus und Sperren (`/platform/tenants/:id/lifecycle…`)

`status` (`PROVISIONING | ACTIVE | SUSPENDED | OFFBOARDING | CLOSED`) plus `suspension_scopes` (`LOGIN`, `AUTOMATION`, `CONNECTORS`, `BILLING`, `SECURITY_QUARANTINE`) – kein pauschaler Boolean.

| Zustand | Anmeldung | Autonome Verarbeitung | Verbindungsaktivität |
|---|---|---|---|
| `ACTIVE`, keine Sperre | ✓ | ✓ | ✓ |
| `LOGIN` | ✗ (auch bestehende Tokens, ≤ 5 s) | ✓ | ✓ |
| `AUTOMATION` / `BILLING` | ✓ | ✗ (Aktionen nur nach Freigabe; Lesen/Einordnen bleibt) | ✓ |
| `CONNECTORS` | ✓ | ✓ | ✗ (Capabilities mit Connector nicht ausführbar, verständlicher Grund) |
| `SECURITY_QUARANTINE` oder nicht `ACTIVE` | ✗ | ✗ | ✗ |

* **Bestätigte Wirkung:** `GET …/lifecycle-preview` liefert beschriebene Wirkung (z. B. „7 aktive Nutzer können sich nicht mehr anmelden…“) und ein Bestätigungs-Token, das an genau diesen Zielzustand und diese Wirkung gebunden ist; `PATCH …/lifecycle` ohne passendes Token wird abgelehnt (kein generisches „OK“).
* Daten bleiben erhalten; Aufheben stellt alles wieder her. Jede Änderung wird mit Vorher/Nachher und Wirkung im Plattform-Audit (`targetTenantId`) festgehalten.
* Noch nicht umgesetzt: `provision`/`offboard`/`close` als Abläufe (heute nur Statuswerte; die Löschung läuft weiterhin über den bestehenden DSGVO-Pfad `tenants/me`), regionale Richtlinien je Mandant, Tarif (`planKey`), `supportPolicyRef`.

## Connector-Lifecycle (`/platform/connectors`)

Siehe `PLATFORM_CONNECTOR_REGISTRY.md`.
