/**
 * Ausfall eines angebundenen Systems (Netz, Dienst nicht erreichbar, Drosselung): der Vorgang wird dadurch nie abgebrochen. ORBIT wiederholt den Schritt selbstständig mit
 * wachsenden Abständen, bis er gelingt. Erst wenn das System über die Grenze `maxOutageWorkingDays` (Arbeitstage) hinweg nicht erreichbar war, wird ein Mensch eingeschaltet.
 * Reine Funktionen, deterministisch.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;

/** Wartezeiten vor dem 1., 2., … Wiederholungsversuch; danach gilt der letzte Wert (alle vier Stunden), bis die Grenze erreicht ist. */
export const OUTAGE_RETRY_DELAYS_MS: readonly number[] = [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 4 * HOUR];

/** Wartezeit nach dem n-ten fehlgeschlagenen Versuch (n ≥ 1). */
export function outageRetryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(Math.floor(attempt), 1), OUTAGE_RETRY_DELAYS_MS.length) - 1;
  return OUTAGE_RETRY_DELAYS_MS[index] as number;
}

interface LocalParts {
  /** 0 = Sonntag … 6 = Samstag */
  weekday: number;
  /** Millisekunden seit Mitternacht (Ortszeit) */
  msOfDay: number;
}

function localParts(instant: number, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, msOfDay: (Number(get('hour')) * 3600 + Number(get('minute')) * 60 + Number(get('second'))) * SECOND + (instant % SECOND + SECOND) % SECOND };
}

const isWorkingDay = (weekday: number): boolean => weekday >= 1 && weekday <= 5;

/**
 * Wie viel Zeit zwischen `from` und `to` auf Arbeitstage (Montag bis Freitag, in der Zeitzone des Betriebs) fällt. Wochenenden zählen nicht; Feiertage werden nicht
 * berücksichtigt (zugunsten der Kundschaft: lieber früher ein Mensch als später).
 */
export function workingTimeElapsedMs(from: Date, to: Date, timeZone: string): number {
  let cursor = from.getTime();
  const end = to.getTime();
  let total = 0;
  // Höchstens ein Schritt je Kalendertag (plus Reserve für Zeitumstellungen); Grenze gegen Endlosschleifen bei ungültigen Eingaben.
  for (let guard = 0; cursor < end && guard < 4000; guard += 1) {
    const { weekday, msOfDay } = localParts(cursor, timeZone);
    const untilMidnight = Math.max(DAY_MS - msOfDay, SECOND);
    const step = Math.min(untilMidnight, end - cursor);
    if (isWorkingDay(weekday)) total += step;
    cursor += step;
  }
  return total;
}

/** Ist die Grenze (in Arbeitstagen) seit `since` erreicht? */
export function outageLimitReached(since: Date, now: Date, timeZone: string, maxWorkingDays: number): boolean {
  return workingTimeElapsedMs(since, now, timeZone) >= maxWorkingDays * DAY_MS;
}
