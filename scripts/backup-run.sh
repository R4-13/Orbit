#!/usr/bin/env bash
# Tägliche Sicherung (Datenbank + Dokumentenspeicher) mit Protokoll – Pilotbetrieb, Teil W4. ERST ANZEIGEN, DANN ÄNDERN: ohne --execute zeigt das Skript nur, was es täte.
#
#   scripts/backup-run.sh              zeigt Plan und Konfiguration (schreibt nichts)
#   scripts/backup-run.sh --execute    sichert: pg_dump (+ Prüfung, dass die Datei lesbar ist), Dokumente, bereinigt alte Tagessicherungen, kopiert an den externen Ort, wenn konfiguriert
#
# Konfiguration (Umgebung oder .env.backup.local, nicht im Repository):
#   BACKUP_DIR            lokaler Ordner der Sicherungen (Standard: <Repo>/backups)
#   BACKUP_EXTERNAL_DIR   ORT AUSSERHALB DIESES RECHNERS (z. B. gemountetes Netzlaufwerk, USB-Datenträger, Pfad einer Cloud-Synchronisation). Leer = nicht konfiguriert: die Sicherung liegt dann nur
#                         lokal und schützt NICHT vor Verlust des Rechners – das Protokoll vermerkt das jedes Mal. Der Ort wird erst benannt, wenn der Betreiber ihn festlegt (E6).
#   BACKUP_RETENTION_DAYS Tage, die Tagessicherungen der Datenbank aufbewahrt werden (Standard 14); die jüngste Sicherung bleibt immer.
#   ORBIT_HOST            Host für die Verbindung zu Datenbank/MinIO (Standard 127.0.0.1; `localhost` löst bei Docker Desktop zeitweise auf ::1 auf und hängt)
# Protokoll: <BACKUP_DIR>/backup-protokoll.jsonl (eine Zeile je Lauf und Schritt). Zugangsdaten werden nie ausgegeben.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env.backup.local" ] && { set -a; source "$ROOT/.env.backup.local"; set +a; }
EXECUTE=0; [ "${1:-}" = "--execute" ] && EXECUTE=1
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
EXTERNAL="${BACKUP_EXTERNAL_DIR:-}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
LOG="$BACKUP_DIR/backup-protokoll.jsonl"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { mkdir -p "$BACKUP_DIR"; printf '{"zeit":"%s","schritt":"%s","ergebnis":"%s","hinweis":"%s"}\n' "$(now)" "$1" "$2" "${3:-}" >> "$LOG"; }

MODE="nur Anzeige"; [ "$EXECUTE" = "1" ] && MODE="Ausführung"
echo "Sicherungsplan ($MODE):"
echo "  1. Datenbank:  pg_dump nach $BACKUP_DIR (Custom-Format), danach Lesbarkeitsprüfung der Datei"
echo "  2. Dokumente:  Bucket in $BACKUP_DIR/dokumente (Manifest mit SHA-256), unveränderte Objekte werden übersprungen"
echo "  3. Aufbewahrung: Tagessicherungen der Datenbank älter als $RETENTION Tage entfernen (die jüngste bleibt)"
if [ -n "$EXTERNAL" ]; then echo "  4. Externer Ort: Kopie nach $EXTERNAL"; else echo "  4. Externer Ort: NICHT KONFIGURIERT (BACKUP_EXTERNAL_DIR leer) – Sicherung bleibt nur lokal; Betreiber nennt den Ort (E6)"; fi
[ "$EXECUTE" = "1" ] || { echo "Nur angezeigt. Zum Sichern --execute angeben."; exit 0; }

HOST="${ORBIT_HOST:-127.0.0.1}"
fail=0

# 1. Datenbank
if "$ROOT/scripts/backup-postgres.sh" backup "$BACKUP_DIR" >/tmp/orbit-backup-db.$$ 2>&1; then
  latest="$(ls -1t "$BACKUP_DIR"/orbit-*.dump | head -1)"
  # Lesbarkeitsprüfung ohne Wiederherstellung: das Inhaltsverzeichnis der Sicherung muss sich lesen lassen und Tabellen enthalten.
  if entries="$(docker exec -i "${POSTGRES_CONTAINER:-orbit-postgres}" pg_restore --list < "$latest" | grep -c ' TABLE ')" && [ "$entries" -gt 50 ]; then log datenbank OK "$(basename "$latest"), $entries Tabellen im Inhaltsverzeichnis"; else log datenbank FEHLER "Sicherung nicht lesbar oder unvollständig"; fail=1; fi
else
  log datenbank FEHLER "$(tail -1 /tmp/orbit-backup-db.$$ | tr -d '"')"; fail=1
fi
rm -f /tmp/orbit-backup-db.$$

# 2. Dokumente
if ( cd "$ROOT" && set -a && source .env && set +a \
     && export DATABASE_URL="${DATABASE_URL//localhost/$HOST}" DATABASE_URL_APP="${DATABASE_URL_APP//localhost/$HOST}" S3_ENDPOINT="${S3_ENDPOINT//localhost/$HOST}" \
     && cd apps/api && pnpm exec ts-node scripts/backup-documents.ts sichern "$BACKUP_DIR/dokumente" --execute ) >/tmp/orbit-backup-doc.$$ 2>&1; then
  log dokumente OK "$(grep -E '^Gesichert' /tmp/orbit-backup-doc.$$ | tail -1)"
else
  log dokumente FEHLER "$(grep -v ioredis /tmp/orbit-backup-doc.$$ | tail -1 | tr -d '"')"; fail=1
fi
rm -f /tmp/orbit-backup-doc.$$

# 3. Aufbewahrung (nur Tagessicherungen der Datenbank; die jüngste bleibt immer)
latest_db="$(ls -1t "$BACKUP_DIR"/orbit-*.dump 2>/dev/null | head -1 || true)"
removed=0
while IFS= read -r old; do [ -n "$old" ] && [ "$old" != "$latest_db" ] && { rm -f "$old"; removed=$((removed + 1)); }; done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'orbit-*.dump' -mtime "+$RETENTION" 2>/dev/null)
log aufbewahrung OK "$removed alte Sicherung(en) entfernt"

# 4. Externer Ort
if [ -n "$EXTERNAL" ]; then
  if mkdir -p "$EXTERNAL" && cp -u "$latest_db" "$EXTERNAL"/ && cp -ru "$BACKUP_DIR/dokumente" "$EXTERNAL"/ && cp -f "$LOG" "$EXTERNAL"/backup-protokoll.jsonl; then log extern OK "$EXTERNAL"; else log extern FEHLER "Kopie nach $EXTERNAL fehlgeschlagen"; fail=1; fi
else
  log extern NICHT_KONFIGURIERT "Sicherung nur lokal – schützt nicht vor Verlust des Rechners"
fi

[ "$fail" = "0" ] && echo "Sicherung abgeschlossen (siehe $LOG)." || { echo "Sicherung mit Fehlern (siehe $LOG)." >&2; exit 1; }
