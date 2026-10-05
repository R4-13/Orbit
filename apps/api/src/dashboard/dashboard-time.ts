import type { DashboardPeriod } from '@orbit/shared';

/** True, wenn der Name eine gültige IANA-Zeitzone ist (Nutzereingabe wird nie ungeprüft übernommen). */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function partsInZone(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) values[part.type] = part.value;
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: weekdays.indexOf(values.weekday ?? ""),
  };
}

/** UTC-Zeitpunkt, zu dem es in `timezone` genau `year-month-day 00:00` ist (Sommerzeit-sicher durch Nachkorrektur). */
function zonedMidnight(year: number, month: number, day: number, timezone: string): Date {
  let guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const p = partsInZone(new Date(guess), timezone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = asUtc - guess;
    const corrected = Date.UTC(year, month - 1, day, 0, 0, 0) - offset;
    if (corrected === guess) break;
    guess = corrected;
  }
  return new Date(guess);
}

export interface PeriodRange {
  /** Beginn des heutigen Kalendertages in der Zeitzone – Grenze zwischen „überfällig“ und „heute fällig“. */
  startOfToday: Date;
  start: Date;
  end: Date;
  /** Beginn des folgenden Kalendertages in der Zeitzone – Grenze für „heute fällig“. */
  endOfToday: Date;
}

/** Zeitraum in der Zeitzone des Nutzers (§7: Scope enthält Zeitraum/Zeitzone). Ende ist `now`. */
export function periodRange(period: DashboardPeriod, now: Date, timezone: string): PeriodRange {
  const p = partsInZone(now, timezone);
  const startOfToday = zonedMidnight(p.year, p.month, p.day, timezone);
  const nextDay = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const endOfToday = zonedMidnight(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), timezone);

  let start = startOfToday;
  if (period === 'WEEK') {
    const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday));
    start = zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timezone);
  } else if (period === 'MONTH') {
    start = zonedMidnight(p.year, p.month, 1, timezone);
  }
  return { startOfToday, start, end: now, endOfToday };
}
