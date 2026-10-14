#!/usr/bin/env bash
# Sicherung und Wiederherstellungsprobe der ORBIT-Datenbank (TEC-08).
#
#   scripts/backup-postgres.sh backup [Zielordner]      # legt orbit-<Zeitstempel>.dump an (pg_dump, Custom-Format, komprimiert)
#   scripts/backup-postgres.sh verify <Datei.dump>      # stellt die Sicherung in eine WEGWERF-Datenbank wieder her und prüft sie – die echte Datenbank bleibt unberührt
#
# Annahmen: Docker-Compose-Stack aus dem Repository (Container "orbit-postgres", Benutzer "orbit", Datenbank "orbit"). Für andere Umgebungen
# POSTGRES_CONTAINER / POSTGRES_USER / POSTGRES_DB setzen. Das Passwort wird nie auf der Kommandozeile übergeben: pg_dump/psql laufen IM Container
# über den lokalen Socket (Vertrauensstellung des Containers).
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-orbit-postgres}"
PGUSER="${POSTGRES_USER:-orbit}"
PGDB="${POSTGRES_DB:-orbit}"
command="${1:-}"

case "$command" in
  backup)
    target="${2:-./backups}"
    mkdir -p "$target"
    file="$target/orbit-$(date +%Y%m%d-%H%M%S).dump"
    docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" --format=custom --compress=6 --no-owner > "$file"
    size=$(wc -c < "$file")
    [ "$size" -gt 1024 ] || { echo "Sicherung ist verdächtig klein ($size Byte) – abgebrochen." >&2; rm -f "$file"; exit 1; }
    echo "Sicherung angelegt: $file ($size Byte). Bitte außerhalb dieses Rechners aufbewahren und die Wiederherstellung mit 'verify' proben."
    ;;
  verify)
    file="${2:?Bitte die Sicherungsdatei angeben}"
    [ -f "$file" ] || { echo "Datei nicht gefunden: $file" >&2; exit 1; }
    scratch="orbit_restore_check_$(date +%s)"
    cleanup() { docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -qc "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true; }
    trap cleanup EXIT
    docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -qc "CREATE DATABASE \"$scratch\"" >/dev/null
    docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$scratch" --no-owner --exit-on-error < "$file"
    tables=$(docker exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    tenants=$(docker exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -Atc "SELECT count(*) FROM tenants")
    migrations=$(docker exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -Atc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
    echo "Wiederherstellung geprobt: $tables Tabellen, $tenants Mandanten, $migrations angewendete Migrationen."
    [ "$tables" -gt 50 ] && [ "$migrations" -gt 0 ] || { echo "Die Probe-Wiederherstellung sieht unvollständig aus." >&2; exit 1; }
    ;;
  *)
    echo "Aufruf: $0 backup [Zielordner] | verify <Datei.dump>" >&2
    exit 2
    ;;
esac
