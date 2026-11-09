#!/usr/bin/env bash
# Wiederherstellungsprüfung (wöchentlich) – Pilotbetrieb, Teil W4. Ändert nichts an den Betriebsdaten: die Datenbank wird in eine WEGWERF-Datenbank zurückgespielt, die Dokumentensicherung nur gelesen.
#
#   scripts/backup-restore-check.sh              prüft die jüngste Sicherung: Alter, Wiederherstellung in Wegwerf-Datenbank (Tabellen/Mandanten/Migrationen), Dokumentensicherung gegen Manifest und Bucket
#   scripts/backup-restore-check.sh <Datei.dump> prüft diese Datenbanksicherung
#
# Ergebnis: Ausgabe und eine Zeile in <BACKUP_DIR>/backup-protokoll.jsonl; Exit-Code 1, wenn etwas nicht stimmt. Die Prüfung des Alters (BACKUP_MAX_AGE_HOURS, Standard 26) meldet eine ausgefallene tägliche Sicherung.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env.backup.local" ] && { set -a; source "$ROOT/.env.backup.local"; set +a; }
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
MAX_AGE_H="${BACKUP_MAX_AGE_HOURS:-26}"
HOST="${ORBIT_HOST:-127.0.0.1}"
LOG="$BACKUP_DIR/backup-protokoll.jsonl"
log() { mkdir -p "$BACKUP_DIR"; printf '{"zeit":"%s","schritt":"%s","ergebnis":"%s","hinweis":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}" >> "$LOG"; }
fail=0

file="${1:-$(ls -1t "$BACKUP_DIR"/orbit-*.dump 2>/dev/null | head -1 || true)}"
if [ -z "$file" ] || [ ! -f "$file" ]; then log pruefung FEHLER "keine Datenbanksicherung gefunden"; echo "Keine Datenbanksicherung gefunden." >&2; exit 1; fi

age_h=$(( ( $(date +%s) - $(date -r "$file" +%s) ) / 3600 ))
if [ "$age_h" -gt "$MAX_AGE_H" ]; then echo "PROBLEM: die jüngste Sicherung ist $age_h Stunden alt (Grenze $MAX_AGE_H) – die tägliche Sicherung ist ausgefallen."; log alter FEHLER "$age_h Stunden"; fail=1; else echo "Alter der jüngsten Sicherung: $age_h Stunden (in Ordnung)."; fi

if out="$("$ROOT/scripts/backup-postgres.sh" verify "$file" 2>&1)"; then echo "$out" | tail -1; log wiederherstellung OK "$(basename "$file"): $(echo "$out" | tail -1)"; else echo "PROBLEM: Wiederherstellung fehlgeschlagen: $(echo "$out" | tail -1)"; log wiederherstellung FEHLER "$(basename "$file")"; fail=1; fi

if [ -f "$BACKUP_DIR/dokumente/manifest.json" ]; then
  if doc="$( cd "$ROOT" && set -a && source .env && set +a \
      && export DATABASE_URL="${DATABASE_URL//localhost/$HOST}" DATABASE_URL_APP="${DATABASE_URL_APP//localhost/$HOST}" S3_ENDPOINT="${S3_ENDPOINT//localhost/$HOST}" \
      && cd apps/api && pnpm exec ts-node scripts/backup-documents.ts pruefen "$BACKUP_DIR/dokumente" --execute 2>&1 | grep -v -e ioredis -e '^ *at ' -e ECONN )"; then echo "$doc" | tail -1; log dokumente_pruefung OK "$(echo "$doc" | tail -1)"; else echo "$doc" | tail -4; log dokumente_pruefung FEHLER "$(echo "$doc" | tail -1 | tr -d '"')"; fail=1; fi
else
  echo "PROBLEM: keine Dokumentensicherung (kein Manifest)."; log dokumente_pruefung FEHLER "kein Manifest"; fail=1
fi

[ "$fail" = "0" ] && echo "Wiederherstellungsprüfung bestanden." || { echo "Wiederherstellungsprüfung NICHT bestanden." >&2; exit 1; }
