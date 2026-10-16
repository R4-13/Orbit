import { zonedTimeToUtc, type BusyInterval } from './appointment-slots';

/**
 * Die Kalender, aus denen Termine vorgeschlagen und gebucht werden (BPF-08): die im Anschluss eingestellten Kalender des Betriebs **und** die Kalender der aktiven
 * Mitarbeitenden mit hinterlegter Kalender-ID (Monteure). So steht zu jedem gebuchten Termin fest, wer ihn übernimmt, und Urlaub/Krankheit aus dem Verzeichnis sperrt
 * die Person, auch wenn ihr Kalender sie als frei zeigt. Reine Funktionen, ohne Datenbank und ohne Netz.
 */
export interface PoolStaff {
  id: string;
  firstName: string;
  lastName: string;
  calendarId?: string | null;
  active: boolean;
  absences?: unknown;
}

export interface PoolCalendar {
  calendarId: string;
  /** Die Person, der dieser Kalender gehört (fehlt bei einem allgemeinen Betriebskalender). */
  staff?: { id: string; name: string; absences?: unknown };
}

const MAX_CALENDARS = 20;

export function buildCalendarPool(configuredIds: readonly string[], directory: readonly PoolStaff[]): PoolCalendar[] {
  const owners = new Map<string, PoolStaff>();
  for (const s of directory) if (s.active && s.calendarId?.trim()) owners.set(s.calendarId.trim(), s);
  const ids = [...new Set([...configuredIds, ...owners.keys()])].slice(0, MAX_CALENDARS);
  return ids.map((calendarId) => {
    const owner = owners.get(calendarId);
    return owner ? { calendarId, staff: { id: owner.id, name: `${owner.firstName} ${owner.lastName}`.trim(), absences: owner.absences } } : { calendarId };
  });
}

/** Abwesenheitstage der Person als belegte Zeiträume (ganze Ortstage) im Suchzeitraum. */
export function absenceIntervals(absences: unknown, from: Date, to: Date, timeZone: string): BusyInterval[] {
  if (!Array.isArray(absences)) return [];
  const out: BusyInterval[] = [];
  for (const raw of absences) {
    const entry = raw as { from?: unknown; until?: unknown };
    if (typeof entry.from !== 'string' || typeof entry.until !== 'string') continue;
    const [fy, fm, fd] = entry.from.split('-').map(Number);
    const [uy, um, ud] = entry.until.split('-').map(Number);
    if (![fy, fm, fd, uy, um, ud].every((n) => Number.isFinite(n))) continue;
    const start = zonedTimeToUtc({ year: fy as number, month: fm as number, day: fd as number }, 0, 0, timeZone);
    // Ende: Beginn des Tages nach dem letzten Abwesenheitstag (über Monatsgrenzen mit UTC-Rechnung).
    const next = new Date(Date.UTC(uy as number, (um as number) - 1, (ud as number) + 1));
    const end = zonedTimeToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, 0, 0, timeZone);
    if (end > from && start < to) out.push({ start, end });
  }
  return out;
}

/** Belegung eines Kalenders: gemeldete Belegung plus Abwesenheit der Person. */
export function effectiveBusy(calendar: PoolCalendar, reported: readonly BusyInterval[], from: Date, to: Date, timeZone: string): BusyInterval[] {
  return [...reported, ...absenceIntervals(calendar.staff?.absences, from, to, timeZone)];
}

/** Ist im Zeitraum frei? (kein belegter Zeitraum überschneidet sich) */
export function isFree(busy: readonly BusyInterval[], start: Date, end: Date): boolean {
  return !busy.some((b) => b.start < end && b.end > start);
}

/**
 * Welcher Kalender übernimmt den Termin? Ein freier Kalender einer Person geht vor einem allgemeinen Betriebskalender (der Termin hat dann eine zuständige Person);
 * unter mehreren Personen entscheidet die Reihenfolge der Liste.
 */
export function pickCalendar(pool: readonly PoolCalendar[], busyOf: (calendarId: string) => readonly BusyInterval[], start: Date, end: Date, timeZone: string): PoolCalendar | undefined {
  const free = pool.filter((c) => isFree(effectiveBusy(c, busyOf(c.calendarId), start, end, timeZone), start, end));
  return free.find((c) => c.staff) ?? free[0];
}

