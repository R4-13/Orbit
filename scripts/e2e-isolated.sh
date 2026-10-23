#!/usr/bin/env bash
# E2E-Läufe getrennt von der laufenden Entwicklungsumgebung (Worker, API, Redis-Queues).
#
# Hintergrund: Die E2E-Suites teilten sich Datenbank `orbit` und Redis-Datenbank 0 mit dem laufenden Worker-Container. Der Worker bearbeitet dort Fristen, Wartezeiten und Queue-Jobs
# aller Mandanten – auch der gerade laufenden Testmandanten – und kann Testzustände zwischen zwei Schritten verändern (Verdacht bei einem einmaligen Fehler im Live-Abgleich-Test).
# Dieses Skript legt eine eigene Datenbank `orbit_e2e` an (Migrationen + Rechte der Laufzeitrolle), nutzt Redis-Datenbank 15 und startet Jest damit. Die Entwicklungsdaten werden nicht angefasst.
#
# Aufruf (aus dem Repo-Wurzelverzeichnis):  scripts/e2e-isolated.sh [jest-Argumente / Testdateien ...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
# Live-Läufe mit echtem Modell (LIVE_AI=1): die lokale KI-Konfiguration überschreibt die Werte aus .env.
if [ "${LIVE_AI:-}" = "1" ] && [ -f "$ROOT/.env.llm.local" ]; then set -a; source "$ROOT/.env.llm.local"; set +a; fi

# Begrenzter Modellvergleich: Denkaufwand nur für diesen Lauf überschreiben (kein globaler Wechsel), z. B. OVERRIDE_REASONING_EFFORT=medium.
if [ -n "${OVERRIDE_REASONING_EFFORT:-}" ]; then export OPENAI_REASONING_EFFORT="$OVERRIDE_REASONING_EFFORT"; fi

E2E_DB="${E2E_DB_NAME:-orbit_e2e}"
BASE_URL="${DATABASE_URL%%\?*}"          # postgresql://orbit:pw@localhost:5432/orbit
BASE_URL="${BASE_URL%/*}"                # ohne Datenbankname
APP_URL="${DATABASE_URL_APP%%\?*}"; APP_URL="${APP_URL%/*}"

# Datenbank anlegen, falls sie fehlt (Container-Postgres, Superuser der Entwicklungsumgebung).
PGUSER_NAME="${POSTGRES_USER:-orbit}"
if ! docker exec orbit-postgres psql -U "$PGUSER_NAME" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${E2E_DB}'" | grep -q 1; then
  docker exec orbit-postgres psql -U "$PGUSER_NAME" -d postgres -c "CREATE DATABASE ${E2E_DB}" >/dev/null
  echo "[e2e] Datenbank ${E2E_DB} angelegt."
fi

export DATABASE_URL="${BASE_URL}/${E2E_DB}?schema=public"
export DATABASE_URL_APP="${APP_URL}/${E2E_DB}?schema=public&connection_limit=20"
# Eigener Redis nur für Tests (Container orbit-redis-e2e, Host-Port 16379): der Redis der Entwicklungsumgebung ist vom Host aus nicht erreichbar (nicht veröffentlicht) und wird vom Worker genutzt.
if [ "$(docker inspect -f '{{.State.Running}}' orbit-redis-e2e 2>/dev/null)" != "true" ]; then
  docker rm -f orbit-redis-e2e >/dev/null 2>&1 || true
  docker run -d --name orbit-redis-e2e -p 16379:6379 redis:7-alpine >/dev/null
  echo "[e2e] Test-Redis orbit-redis-e2e gestartet (Port 16379)."
fi
export REDIS_URL="redis://localhost:${E2E_REDIS_PORT:-16379}/${E2E_REDIS_DB:-0}"
export E2E_ISOLATED=1
# Zielabdeckung (Anliegenliste im Plan): Skript-Tests mit festen Plänen kennen sie nicht; Live-Läufe mit echtem Modell prüfen sie (LIVE_AI=1). Ausdrücklich überschreibbar.
export PLAN_REQUIRE_OUTCOMES="${PLAN_REQUIRE_OUTCOMES:-$([ "${LIVE_AI:-}" = "1" ] && echo true || echo false)}"

( cd "$ROOT/packages/domain" && npx prisma migrate deploy >/dev/null && npx prisma db execute --file prisma/post-reset-grants.sql --schema prisma/schema.prisma >/dev/null )
# Die Suiten setzen den Demo-Mandanten `musterwerk` (und seine Benutzer) voraus – in der frischen Datenbank einmal anlegen.
if ! docker exec orbit-postgres psql -U "$PGUSER_NAME" -d "${E2E_DB}" -tAc "SELECT 1 FROM tenants WHERE slug='musterwerk'" | grep -q 1; then
  ( cd "$ROOT/packages/domain" && npx ts-node prisma/seed.ts >/dev/null )
  echo "[e2e] Demo-Daten in ${E2E_DB} angelegt."
fi
echo "[e2e] ${E2E_DB} migriert; Test-Redis Port ${E2E_REDIS_PORT:-16379}, DB ${E2E_REDIS_DB:-0}; Jest startet."

cd "$ROOT/apps/api"
exec node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand "$@"
