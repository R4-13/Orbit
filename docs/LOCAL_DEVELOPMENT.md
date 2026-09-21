# Lokale Entwicklung — Project ORBIT

Voraussetzungen: Node.js ≥ 20, pnpm ≥ 9 (`packageManager` in `package.json`
pinnt `pnpm@9.15.0` — pnpm 10 bricht den aktuellen Lockfile/Postinstall-Flow,
siehe `docs/ASSUMPTIONS.md` #12/#46), Docker Desktop.

## Erstes Setup

```bash
cp .env.example .env
```

`.env` danach anpassen:

- `CREDENTIAL_ENCRYPTION_KEY` generieren: `openssl rand -base64 32`
- `DATABASE_APP_PASSWORD` (und damit `DATABASE_URL_APP`) nur ändern, wenn
  auch `docker-compose*.yml` entsprechend angepasst wird — beide müssen
  übereinstimmen (siehe Abschnitt "Row-Level Security" unten).
- Alle übrigen Platzhalter (`DATEV_*`, `HUBSPOT_*`, `TWILIO_*`, …) können
  leer bleiben — jeder Connector läuft per Default als Mock
  (`*_CONNECTOR=mock`).

```bash
pnpm install

# Infrastruktur (Postgres, Redis, MinIO) starten
docker compose -f docker-compose.dev.yml up -d

# Datenbank migrieren (inkl. Row-Level-Security-Policies) + Demo-Daten laden
pnpm prisma:deploy
pnpm prisma:seed

# API, Worker und Web parallel starten
pnpm dev
```

Danach: API unter `http://localhost:3001`, Web unter
`http://localhost:3000`, Login mit den Demo-Zugangsdaten aus
[`docs/DEMO_DATA.md`](DEMO_DATA.md).

Alternativ die komplette Demo containerisiert (API/Web/Worker inklusive):

```bash
docker compose up
```

## Zwei Docker-Compose-Dateien — nicht mischen

`docker-compose.dev.yml` (Projektname `orbit-dev`, Container-Suffix
`-dev`, eigene Volumes `orbit_postgres_dev_data`/`orbit_minio_dev_data`)
und `docker-compose.yml` (Projektname `orbit`, eigene Volumes
`orbit_postgres_data`/`orbit_minio_data`) sind **vollständig getrennte
Postgres-/MinIO-Instanzen** — kein gemeinsamer Zustand. Zwischen beiden zu
wechseln bedeutet, in einer leeren Datenbank aufzuwachen (`docs/ASSUMPTIONS.md`
"Nachtrag"-Abschnitt). Nach einem Wechsel: `pnpm prisma:deploy` +
`pnpm prisma:seed` erneut ausführen.

## Row-Level Security: zwei DB-Rollen

Seit Phase 15 (`docs/ASSUMPTIONS.md` #85-90) verbindet sich die laufende
App über eine andere Postgres-Rolle (`orbit_app`, `DATABASE_URL_APP`) als
der, mit der Migrationen laufen (`orbit`, `DATABASE_URL`, immer
Superuser). Die Rolle `orbit_app` wird **automatisch** angelegt, aber nur
beim allerersten Start eines **frischen** Postgres-Volumes
(`docker/postgres/10-init-app-role.sh`, läuft als
`docker-entrypoint-initdb.d`-Skript). Zwei Konsequenzen:

- Ein bereits existierendes, älteres Volume (von vor Phase 15) hat die
  Rolle nicht automatisch — entweder das Volume neu anlegen
  (`docker compose -f docker-compose.dev.yml down -v && ... up -d`,
  **löscht alle lokalen Daten**) oder die Rolle manuell nachziehen (SQL
  aus `docker/postgres/10-init-app-role.sh`, gegen die laufende Instanz
  per `psql`/`docker exec` ausgeführt).
- `pnpm db:reset` (`prisma migrate reset --force`) legt zwar die
  Datenbank/das Schema neu an, aber die Rolle selbst (ein Cluster-Objekt)
  bleibt erhalten — die `ALTER DEFAULT PRIVILEGES`-Regel aus dem
  Init-Skript ist danach aber weg (sie hängt am `public`-Schema, das
  `migrate reset` neu erstellt), wodurch neu angelegte Tabellen nicht mehr
  automatisch für `orbit_app` freigegeben sind. Siehe `docs/ASSUMPTIONS.md`
  #93 für den Workaround.

## Automatisierte Tests

```bash
pnpm lint
pnpm typecheck
pnpm test          # Unit-Tests (Vitest + Jest), kein laufender Stack nötig
pnpm build
pnpm test:e2e       # E2E — siehe Voraussetzungen unten
```

**`pnpm test:e2e` braucht den vollen, laufenden Stack:** Postgres/Redis/
MinIO (siehe oben) und geseedete Demo-Daten (`pnpm prisma:seed`) — die
Playwright-Suite (`apps/web/e2e/`) liest die Musterwerk-Fixtures direkt.
Details zum Testaufbau: `docs/ASSUMPTIONS.md` Phase 14 (#78-84).

**Playwright-Browser fehlen beim ersten Mal** — einmalig installieren:

```bash
pnpm --filter @orbit/web exec playwright install --with-deps chromium
```

**Auf Windows**: `pnpm build` für `@orbit/web` (Next.js `output:
"standalone"`) schlägt lokal mit `EPERM: symlink` fehl, sofern der
Windows-Entwicklermodus nicht aktiv ist (Einstellungen → Für Entwickler) —
betrifft nur den *Production*-Build, nicht `next dev`/Tests/Typecheck.
Siehe `docs/ASSUMPTIONS.md` #17. Der `test:e2e`-Task hängt in `turbo.json`
von `build` ab — auf einer betroffenen Windows-Maschine also entweder den
Entwicklermodus aktivieren, oder `apps/web`s Playwright-Suite direkt gegen
einen bereits laufenden `next dev`-Server ausführen:

```bash
pnpm --filter @orbit/api dev &     # Terminal 1
pnpm --filter @orbit/web dev &     # Terminal 2
cd apps/web && npx playwright test # Terminal 3
```

## Mehrere `nest start --watch`-Prozesse

Ein Hintergrund-`pnpm --filter @orbit/api dev`-Prozess, der beim
Beenden nicht sauber terminiert wurde, blockiert Port 3001 für den
nächsten Start (`EADDRINUSE`) — der neue Prozess läuft dann in einem
kaputten Zustand weiter, statt klar zu scheitern. Symptom: seltsam
langsame/hängende Requests oder sporadische Timeouts ohne erkennbaren
Grund in der Anwendungslogik (live in dieser Form beobachtet, siehe
`docs/ASSUMPTIONS.md` #90 — am Ende keine RLS-/Performance-Ursache,
sondern genau dieser Prozess-Konflikt). Vor dem Neustart prüfen, ob noch
ein alter `node.exe`-Prozess auf Port 3001 lauscht, und ihn beenden.

## Demo-Daten neu laden

`pnpm prisma:seed` ist idempotent — jeder Lauf löscht den vorherigen
`musterwerk`-Mandanten (kaskadierend) und legt ihn frisch an. Details und
Login-Zugangsdaten: [`docs/DEMO_DATA.md`](DEMO_DATA.md).
