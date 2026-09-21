#!/bin/sh
# Runs once, automatically, on a *fresh* Postgres data directory (the
# official image only executes /docker-entrypoint-initdb.d/* the first time
# a container starts against an empty volume — see postgres:16-alpine's
# entrypoint). Creates the restricted role the application actually
# connects as at runtime, separate from $POSTGRES_USER (which owns the
# schema/runs migrations and, critically, is always a Postgres superuser —
# superusers unconditionally bypass Row-Level Security, so RLS
# (packages/domain/prisma/migrations/20260921124445_enable_row_level_security)
# would otherwise be entirely inert). See docs/ASSUMPTIONS.md Phase 15.
set -e

: "${DATABASE_APP_PASSWORD:?DATABASE_APP_PASSWORD must be set (see .env.example)}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orbit_app') THEN
      CREATE ROLE orbit_app LOGIN PASSWORD '${DATABASE_APP_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END
  \$\$;

  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO orbit_app;
  GRANT USAGE ON SCHEMA public TO orbit_app;

  -- Applies automatically to tables/sequences that migrations (run by
  -- \$POSTGRES_USER) create *after* this script runs — i.e. every table,
  -- since this runs before "prisma migrate deploy" ever does on a fresh
  -- database. An already-initialized volume (existing dev DB) needs these
  -- grants applied to its already-existing tables separately; see
  -- docs/ASSUMPTIONS.md Phase 15 for the one-off command used here.
  ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orbit_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO orbit_app;
EOSQL
