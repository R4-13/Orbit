/**
 * Terminvorschläge aus den belegten Zeiten eines Kalenders (reine Funktion, ohne Datenbank und ohne Netz).
 *
 * Mehrere Kalender (z. B. mehrere Monteure) gelten als Pool: ein Termin ist möglich, wenn **mindestens ein** Kalender frei ist.
 *
 * Regeln: nur Werktage (Mo–Fr) in der Zeitzone des Mandanten, innerhalb der Geschäftszeit, frühestens am nächsten Werktag, höchstens ein Vorschlag je Tag
 * und über verschiedene Tage und Tageszeiten verteilt. Ein Vor-Ort-Termin lässt einen Puffer vor und nach belegten Zeiten (Anfahrt). Gesetzliche Feiertage
 * kennt die Funktion nicht – ein Feiertag, der im Kalender als belegt eingetragen ist, wird dadurch trotzdem ausgespart.
 */
export type AppointmentKind = 'SITE_VISIT' | 'PHONE_CALL';

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface ProposedSlot {
  start: Date;
  end: Date;
  /** Für die Nachricht an die Kundschaft: „Donnerstag, 15.10.2026, 14:00–15:30 Uhr“. */
  label: string;
}

export interface SlotOptions {
  kind: AppointmentKind;
  now: Date;
  timeZone: string;
  /** Belegte Zeiten je Kalender; ein Zeitraum ist frei, sobald mindestens ein Kalender dort frei ist. Leer = ein Kalender ohne Belegung. */
  calendars: ReadonlyArray<readonly BusyInterval[]>;
  /** Standard: 3. */
  count?: number;
  /** Geschäftszeit in Ortszeit; Standard 08:00–17:00. */
  workStartHour?: number;
  workEndHour?: number;
  /** Wie viele Werktage nach vorn gesucht wird; Standard 10. */
  horizonWorkdays?: number;
}

const DURATION_MINUTES: Record<AppointmentKind, number> = { SITE_VISIT: 90, PHONE_CALL: 20 };
const BUFFER_MINUTES: Record<AppointmentKind, number> = { SITE_VISIT: 30, PHONE_CALL: 0 };
/** Gewünschte Startzeiten in Ortszeit (Stunde, Minute): vormittags und nachmittags im Wechsel. */
const START_TIMES: Record<AppointmentKind, Array<[number, number]>> = {
  SITE_VISIT: [[9, 0], [14, 0], [11, 0], [15, 30]],
  PHONE_CALL: [[9, 30], [14, 0], [11, 0], [15, 30]],
};

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function partsIn(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour: Number(get('hour')), minute: Number(get('minute')), second: Number(get('second')), weekday: weekdays.indexOf(get('weekday')) };
}

/** Ortszeit in `timeZone` → UTC-Zeitpunkt (inklusive Sommerzeit). */
export function zonedTimeToUtc(local: LocalDate, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, hour, minute, 0);
  const shown = partsIn(new Date(guess), timeZone);
  const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
  const offset = shownAsUtc - guess;
  let result = guess - offset;
  // Rund um die Zeitumstellung kann sich der Versatz am Ergebnis unterscheiden: einmal nachziehen.
  const check = partsIn(new Date(result), timeZone);
  const checkAsUtc = Date.UTC(check.year, check.month - 1, check.day, check.hour, check.minute, check.second);
  if (checkAsUtc !== Date.UTC(local.year, local.month - 1, local.day, hour, minute, 0)) result = guess - (checkAsUtc - result);
  return new Date(result);
}

export function formatSlotLabel(start: Date, end: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${day}, ${time(start)}–${time(end)} Uhr`;
}

const overlaps = (aStart: number, aEnd: number, b: BusyInterval, bufferMs: number) => aStart < b.end.getTime() + bufferMs && aEnd > b.start.getTime() - bufferMs;

export function proposeSlots(options: SlotOptions): ProposedSlot[] {
  const { kind, now, timeZone } = options;
  const calendars = options.calendars.length > 0 ? options.calendars : [[]];
  const count = options.count ?? 3;
  const workStart = options.workStartHour ?? 8;
  const workEnd = options.workEndHour ?? 17;
  const horizon = options.horizonWorkdays ?? 10;
  const durationMs = DURATION_MINUTES[kind] * 60_000;
  const bufferMs = BUFFER_MINUTES[kind] * 60_000;
  const wanted = START_TIMES[kind];

  const today = partsIn(now, timeZone);
  const days: LocalDate[] = [];
  // Ortsdatum fortschreiben (UTC-Kalender als Hilfsmittel für reine Datumsarithmetik).
  for (let offset = 1; days.length < horizon && offset < horizon * 3; offset += 1) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = d.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    days.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }

  const slots: ProposedSlot[] = [];
  let rotation = 0;
  for (const day of days) {
    if (slots.length >= count) break;
    // An jedem Tag zuerst die „an der Reihe“ befindliche Tageszeit versuchen, dann die übrigen: so verteilen sich die Vorschläge.
    const order = [...wanted.slice(rotation % wanted.length), ...wanted.slice(0, rotation % wanted.length)];
    for (const [hour, minute] of order) {
      const startMinutes = hour * 60 + minute;
      if (startMinutes < workStart * 60 || startMinutes + DURATION_MINUTES[kind] > workEnd * 60) continue;
      const start = zonedTimeToUtc(day, hour, minute, timeZone);
      const end = new Date(start.getTime() + durationMs);
      const someoneFree = calendars.some((busy) => !busy.some((b) => overlaps(start.getTime(), end.getTime(), b, bufferMs)));
      if (!someoneFree) continue;
      slots.push({ start, end, label: formatSlotLabel(start, end, timeZone) });
      rotation += 1;
      break;
    }
  }
  return slots;
}

export const APPOINTMENT_LABELS: Record<AppointmentKind, string> = { SITE_VISIT: 'Vor-Ort-Termin', PHONE_CALL: 'Telefontermin' };
export const APPOINTMENT_DURATION_MINUTES = DURATION_MINUTES;
