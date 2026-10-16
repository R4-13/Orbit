/**
 * Passwortregeln jenseits der Mindestlänge (PLT-07): Ablauf nach einer festen Zahl von Tagen und eine Liste früher benutzter Passwörter, die nicht wieder
 * vergeben werden dürfen. Reine Funktionen; die Prüfung gegen die gespeicherten Hashes (argon2) macht der Aufrufer.
 */

/** Wie viele frühere Passwörter höchstens gemerkt werden (Obergrenze, egal was konfiguriert ist). */
export const PASSWORD_HISTORY_MAX = 24;

/**
 * Ist das Passwort abgelaufen? `maxAgeDays <= 0` schaltet den Ablauf aus. Maßgeblich ist der Zeitpunkt der letzten Änderung; wurde das Passwort noch nie geändert,
 * zählt die Anlage des Kontos.
 */
export function passwordExpired(changedAt: Date | null | undefined, createdAt: Date, maxAgeDays: number, now: Date = new Date()): boolean {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return false;
  const since = changedAt ?? createdAt;
  return now.getTime() - since.getTime() > maxAgeDays * 24 * 3_600_000;
}

/** Die neue Liste früherer Passwörter: das abgelöste Passwort kommt hinten dazu, die Liste wird auf `count` Einträge gekürzt (`count <= 0` merkt nichts). */
export function nextPasswordHistory(history: readonly string[], replacedHash: string, count: number): string[] {
  const limit = Math.min(Math.max(Math.trunc(count), 0), PASSWORD_HISTORY_MAX);
  if (limit === 0) return [];
  return [...history, replacedHash].slice(-limit);
}
