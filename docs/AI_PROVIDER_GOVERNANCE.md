# AI-Provider-Governance (Amendment 03 §8–§12, §22)

Code: `apps/api/src/ai-governance/*` (Register, Adapter, Tresor, Messung), `apps/api/src/ai-providers/ai-provider-resolver.service.ts` (Laufzeit-Auflösung),
`apps/api/src/platform/ai/*` (Plattform-API), `packages/shared/src/ai-governance.ts` (reine Entscheidungslogik). Tests: `ai-governance.spec.ts` (Logik),
`ai-provider-resolver.service.spec.ts` (Auflösung ohne DB), `platform-ai-governance.e2e-spec.ts` (echte DB, RLS, 17 Tests).

## 1. Modell

```text
Geschäftscode ──(logisches Profil, z. B. COMPLEX_REASONING)──▶ AiProviderResolverService
   BYOK?  ja ─▶ nur der Mandantenschlüssel  (Ausfall = ehrlicher Fehler, KEIN Fallback)
          nein ─▶ aktive Route (Mandanten-Override vor global) ─▶ Kette gemäß Fallback-Modus
                    ─▶ erster Kandidat mit: Anbieter ACTIVE · Modell APPROVED · Verbindung ACTIVE/DEGRADED · Fähigkeiten · Region/Datenrichtlinie · Gesundheit
                    ─▶ Adapter (Registry) + Secret (Plattform-Tresor) ─▶ Messung (Nutzung, Gesundheit)
          keine Route für das Profil ─▶ Umgebungs-Standard (ENV_BOOTSTRAP, wie bisher; sichtbar)
```

Geschäftscode nennt nur Profile (`FAST_CLASSIFICATION`, `DOCUMENT_EXTRACTION`, `COMPLEX_REASONING`, `BUSINESS_DRAFTING`, `COPILOT_INTERACTIVE`, `AGENT_TOOL_USE`). Die Aufrufer sind
umgestellt: Triage und Ausführungsnachweis → `FAST_CLASSIFICATION`, Planer → `COMPLEX_REASONING`, Faktenextraktion → `DOCUMENT_EXTRACTION`, Sonde → `COPILOT_INTERACTIVE`,
Agentenläufe → `AGENT_TOOL_USE`. `BUSINESS_DRAFTING` ist angelegt, wird aber noch von keinem Aufrufer genutzt (Entwürfe sind heute Vorlagen).

## 2. Register (Plattformdomäne, ohne `tenant_id`, RLS über `app.platform_scope`)

| Tabelle | Inhalt |
|---|---|
| `ai_provider_definitions` | Anbieter, `adapterKey`, Lifecycle `DRAFT…RETIRED`, Regionen, Fähigkeiten, Datenrichtlinien, Version |
| `ai_model_definitions` | Modell je Anbieter, Lifecycle `VALIDATING/APPROVED/DEPRECATED/BLOCKED/RETIRED`, Fähigkeiten, Region, Kostenprofil (je 1 Mio. Token), `evaluationStatus` |
| `ai_model_profiles` | Profil + Version; **veröffentlichte Versionen sind unveränderlich** (DB-Trigger), Änderung = neue Version |
| `ai_provider_routes` | Profil → Primärmodell + Fallbacks, `fallbackMode`, Traffic-Anteil, Zeitfenster; höchstens eine aktive Route je (Profil, Umgebung, Mandantenscope) – partieller Unique-Index |
| `platform_ai_connections` | ORBIT-Managed-Zugang je Anbieter/Umgebung; Secret nur als Referenz (`vault:<id>` oder `env:<NAME>`) |
| `platform_secrets` | verschlüsselte Secrets (AES-256-GCM, gleiche Verschlüsselung wie der Mandanten-Tresor) |
| `ai_provider_health` | Gesundheit je Anbieter/Modell/Umgebung |
| `ai_usage_records` | Nutzung je Aufruf, **mandantengebunden (RLS)**, im Plattform-Scope lesbar; kein Prompt-/Antwortinhalt |

Neue Anbieter brauchen **einen Adapter im Code** (`AiAdapterRegistry`) und Registereinträge – kein Businesscode ändert sich (OPS-05/11/35).

## 3. Regeln (alle serverseitig, einzeln getestet)

* **Aktivierung einer Route** (`checkRouteActivation`): Profil veröffentlicht, Primär-/Fallbackmodelle freigegeben **und Evaluation bestanden**, Verbindung aktiv, Fähigkeiten/Region/Datenrichtlinie erfüllt,
  Anbieter nicht gesperrt/deaktiviert, Fallback innerhalb der Profilgrenze. Vorschau (`GET routes/:id/activation-preview`) nennt Gründe, betroffene Mandanten und die abgelöste Route.
* **Modellfreigabe** verlangt `evaluationStatus = PASSED`.
* **Fallback:** `NO_FALLBACK` (Standard) → nie ein anderes Modell; `SAME_PROVIDER_FALLBACK` → nur derselbe Anbieter; `APPROVED_CROSS_PROVIDER_FALLBACK` → nur in der Route freigegebene Modelle. Zur
  Laufzeit wechselt ein Aufruf nur bei Fehlern, die ein anderer Kandidat beheben kann (Rate-Limit, Timeout, Anbieterfehler, Auth); fachliche Fehler (ungültige Ausgabe) lösen keinen Wechsel aus.
* **Gesundheit:** drei Fehler in Folge → `DOWN` (Circuit Breaker, nach 60 s wieder probiert); Rate-Limit → `RATE_LIMITED`; `DISABLED` per Notbremse bleibt bis zur Freigabe gesperrt.
* **BYOK (OPS-09/10):** „BYOK aktiv“ beginnt beim ersten erfolgreichen Verbinden (`byok_active_since`) und endet nur durch ausdrückliches Trennen. Fällt der Schlüssel danach aus, gibt es einen Fehler
  (`AI_PROVIDER_UNAVAILABLE`), **nie** ein Ausweichen auf die Plattform oder einen anderen Anbieter. Sobald das Register für den Anbieter gepflegt ist, sind nur freigegebene Anbieter/Modelle zulässig;
  vorher gilt – wie bisher – keine Einschränkung (Bootstrap).
* **Secrets:** nie in Antworten, Listen oder Audit; Rotation ohne Businesscode-Änderung (Version +1, Verbindung wird neu validiert). `env:`-Referenzen werden per Deployment rotiert.
* **Konkurrenz:** jede Änderung trägt `expectedVersion`; veraltete Stände ergeben 409. Aktivierung und Ablösung der alten Route erfolgen in einer Transaktion.

## 4. Bootstrap und Migration

Ohne Registerdaten verhält sich das System wie zuvor (Umgebungs-Standard, `ENV_BOOTSTRAP`). `POST /platform/ai/bootstrap-from-environment` (Owner/Operator, Step-up) übernimmt – idempotent – den per Umgebung
konfigurierten Anbieter ins Register (Anbieter, Modell, sechs Standardprofile v1, Verbindung als `env:`-Referenz, je Profil eine **inaktive** Route). Das Modell hat danach `evaluationStatus = NONE`: erst nach belegter
Evaluation lassen sich die Routen aktivieren. Bestehende BYOK-Verbindungen mit Status `CONNECTED` wurden in der Migration auf „BYOK aktiv“ gesetzt.

## 5. Nachweisstand (ehrlich)

| Aspekt | Stand |
|---|---|
| Entscheidungslogik, Auflösung, Fallback, BYOK-Regel, Messung | TESTED LOCALLY (Unit + E2E gegen echte DB) |
| Zweitanbieter (OPS-35) | **TESTED WITH MOCK:** zwei registrierte Stub-Adapter; kein zweiter echter Anbieter mit Zugangsdaten angebunden |
| echte Anbieterprüfung (`validateConfiguration`) einer Plattformverbindung | implementiert, **nur live nachweisbar** (REQUIRES PROVIDER CREDENTIALS) |
| Kostenschätzung | rechnet nur mit gepflegtem Kostenprofil und gemeldeten Token; sonst `null` (nie erfunden). Kostenlimits/Anomalie-Alarme (Amendment 03 §12.3) sind **nicht** umgesetzt |
| Plattform-UI für die AI-Verwaltung | nicht umgesetzt (API vollständig) |
| Mandantenspezifische Region | nicht modelliert; es gilt `ORBIT_DEFAULT_DATA_REGION` (Standard `EU`) |
| Traffic-Anteil <100 % | Mandanten außerhalb des Anteils fallen auf den Umgebungs-Standard zurück (kein Zwei-Routen-Canary) |
