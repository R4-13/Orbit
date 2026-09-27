# Observability

**Status (Phase 25): Distributed Tracing implementiert und live
verifiziert.** Schließt den in `docs/MASTER_SPEC_GAP_ANALYSIS.md` §41
vermerkten Punkt "❌ OpenTelemetry: nur `OTEL_ENABLED`-Env-Flag, nicht
verdrahtet" — das Flag existierte seit Phase 1, wurde aber bis hierhin
nirgends gelesen.

**Update (docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md Phase 2): der unten
als offen benannte `/metrics`-Endpunkt ist implementiert und live
verifiziert.** `GET /api/v1/metrics` (Prometheus-Format, `prom-client`)
— siehe `docs/IMPLEMENTATION_STATUS.md` für den vollständigen
Metrik-Katalog. `llm_request_duration`/`copilot_response_latency`
bleiben weiterhin bewusst offen (siehe `docs/ASSUMPTIONS.md` #217).

## Warum jetzt

`docs/SCALABILITY_CONCEPT.md` benennt Observability explizit als
Voraussetzung für die *nächsten* Skalierungsbausteine (Pro-Tenant-
Rate-Limiting, PgBouncer): ohne Tracing/Metriken bleibt ein "lauter
Nachbar" oder eine langsame Query unsichtbar, bevor sie andere Tenants
spürbar beeinträchtigt. Diese Phase legt die Grundlage, bevor an jenen
Bausteinen weitergearbeitet wird.

## Was verdrahtet ist

- **`apps/api/src/tracing.ts`**: `startTracing(serviceName)`, aufgerufen
  als aller erste Aktion in `apps/api/src/main.ts` (`serviceName:
  'orbit-api'`) und `apps/api/worker/main.ts` (`serviceName:
  'orbit-worker'`) — vor jedem anderen Import. OpenTelemetrys
  Auto-Instrumentierung patcht Node's Modul-Loader
  (require-in-the-middle); würde `AppModule`/`WorkerModule` zuerst
  importiert, wären `http`/`ioredis`/etc. bereits geladen, bevor die
  Patches greifen — siehe Kommentar in `tracing.ts`.
- Nur aktiv, wenn `OTEL_ENABLED=true` **und** `OTEL_EXPORTER_OTLP_ENDPOINT`
  gesetzt ist — beides bereits seit Phase 1 im Env-Schema
  (`packages/config/src/env.ts`), Default `OTEL_ENABLED=false` (Opt-in,
  kein Overhead für alle, die es nicht nutzen).
- **`@opentelemetry/auto-instrumentations-node`** (Bundle aus
  einzelnen Instrumentierungspaketen) deckt automatisch ab: eingehende
  HTTP-Requests, Express-Middleware-Kette, NestJS-Controller-Methoden
  (`@opentelemetry/instrumentation-nestjs-core`), ausgehende
  HTTP-Aufrufe, `ioredis` (erfasst u. a. die echten `EVAL`-Aufrufe der
  in Phase 23 gebauten `ThrottlerRedisStorageService` und der
  BullMQ-Queue). `@opentelemetry/instrumentation-fs` ist explizit
  deaktiviert (extrem hohes Span-Volumen ohne Aussagekraft).
- Export per OTLP/HTTP an einen selbst gehosteten **Jaeger v2**-Container
  (`cr.jaegertracing.io/jaegertracing/jaeger:2.21.0`, OTLP-Receiver auf
  4317/gRPC und 4318/HTTP standardmäßig aktiv, keine Konfiguration
  nötig) — neuer `jaeger`-Service in `docker-compose.yml` und
  `docker-compose.dev.yml`, UI unter `http://localhost:16686`.

## Live-Verifikation (Phase 25)

Mit `OTEL_ENABLED=true` gegen den lokalen Jaeger-Container gestartet
(separater API-Prozess auf Port 3099, um den laufenden Dev-Server nicht
zu stören):

- API und Worker starten jeweils mit `[otel] Tracing gestartet
  (service=orbit-api, ...)` bzw. `service=orbit-worker`.
- Jaeger listet `orbit-api` als Service (`GET
  http://localhost:16686/api/v3/services`).
- Im Jaeger-UI sichtbar: ein `GET /api/v1/health/ready`-Trace mit 11
  Spans, Tiefe 4 — komplette Kette von den Express-Middlewares
  (helmet/cors/json-parser/...) über `HealthController.ready` bis zu
  einem verschachtelten `eval`-Span mit Tag `redis` (der reale
  `ThrottlerRedisStorageService`-Lua-Aufruf, der bei **jedem** Request
  über den globalen `ThrottlerGuard` läuft — ein unmittelbarer,
  ungeplanter Beweis, dass die ioredis-Instrumentierung echte
  Redis-Aufrufe aus Phase 23 korrekt erfasst).
- Negativ-Fall: mit `OTEL_ENABLED=false` (Default) keine
  `[otel]`-Logzeile, keine Verbindungsversuche, kein Fehler — reines
  Opt-in bestätigt.

## Scope-Grenzen (bewusst, nicht vergessen)

- ~~Kein `/metrics`-Endpunkt/Prometheus.~~ **Umgesetzt in
  docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md Phase 2** — siehe Update-
  Hinweis oben.
- **Keine Prisma-Query-Spans.** Prisma 6.x bräuchte dafür
  `previewFeatures = ["tracing"]` im Schema + Client-Neugenerierung —
  ein eigener, migrationsrelevanter Schritt mit eigenem Risiko, bewusst
  nicht in diese Phase gezogen. Auto-Instrumentierungen für den rohen
  `pg`-Treiber (im Bundle enthalten) greifen hier ohnehin nicht:
  Prisma spricht mit seiner eigenen Query-Engine, nicht über das
  npm-Paket `pg`.
- **Log-Korrelation (Trace-IDs in Logs, §31) ist NICHT aktiv** — **echter
  Fund** beim Verifizieren dieser Phase: `pino`/`pino-http` stehen zwar
  seit Phase 1 als Dependencies in `apps/api/package.json`
  (`docs/MASTER_SPEC_GAP_ANALYSIS.md` §41 behauptete bisher
  fälschlich "✅ Strukturiertes Logging (pino/pino-http)"), werden aber
  nirgends im Code tatsächlich verwendet — alle bisherigen Logs laufen
  über NestJS' eingebauten Standard-`Logger`, nicht über pino. Die
  enthaltene `@opentelemetry/instrumentation-pino`-Konfiguration in
  `tracing.ts` ist deshalb aktuell wirkungslos (kein `require('pino')`
  im Prozess, nichts zum Patchen) — bewusst trotzdem drin gelassen
  (kein Overhead, keine Nebenwirkung), damit sie sofort greift, sobald
  `pino`/`pino-http` tatsächlich als Logger verdrahtet werden. Das
  eigentliche Verdrahten von pino als Nest-Logger ist ein eigener,
  nicht-trivialer Schritt (betrifft die Logger-Bootstrapping in
  `main.ts`/`worker/main.ts` und potenziell jede Log-Ausgabe im
  System) — bewusst nicht Teil dieser Phase, `docs/MASTER_SPEC_GAP_ANALYSIS.md`
  §41 entsprechend korrigiert.
- **Metrics-Instrumentierung im NodeSDK ist nicht konfiguriert** (kein
  `metricReader`) — nur Tracing.

## Lokale Nutzung

```bash
# Infra inkl. Jaeger starten (host-run api/web/worker):
docker compose -f docker-compose.dev.yml up -d

# In .env: OTEL_ENABLED=true setzen (Endpoint-Default passt bereits)
# API/Worker normal starten — Traces erscheinen unter:
# http://localhost:16686
```

Im vollen `docker-compose.yml`-Stack ist `jaeger` bereits als Service
enthalten; `OTEL_EXPORTER_OTLP_ENDPOINT` wird dort automatisch auf den
Container-internen Hostnamen (`http://jaeger:4318`) überschrieben,
`OTEL_ENABLED` bleibt weiterhin über `.env` gesteuert (Opt-in).
