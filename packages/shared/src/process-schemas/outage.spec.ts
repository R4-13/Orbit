import { describe, expect, it } from 'vitest';
import { DAY_MS, OUTAGE_RETRY_DELAYS_MS, outageLimitReached, outageRetryDelayMs, workingTimeElapsedMs } from './outage';

const TZ = 'Europe/Berlin';
// Mittwoch, 21.10.2026 12:00 (Sommerzeit endete am 25.10.2026) = 10:00 UTC
const WED_NOON = new Date('2026-10-21T10:00:00Z');
const hours = (n: number) => n * 3_600_000;

describe('Ausfall eines Systems: Wartezeiten', () => {
  it('wächst von 30 Sekunden bis 4 Stunden und bleibt dann dabei', () => {
    expect(outageRetryDelayMs(1)).toBe(30_000);
    expect(outageRetryDelayMs(2)).toBe(60_000);
    expect(outageRetryDelayMs(OUTAGE_RETRY_DELAYS_MS.length)).toBe(hours(4));
    expect(outageRetryDelayMs(50)).toBe(hours(4));
    expect(outageRetryDelayMs(0)).toBe(30_000);
  });
});

describe('Ausfall eines Systems: Arbeitstage', () => {
  it('unter der Woche zählt jede Stunde', () => {
    expect(workingTimeElapsedMs(WED_NOON, new Date(WED_NOON.getTime() + hours(5)), TZ)).toBe(hours(5));
    expect(workingTimeElapsedMs(WED_NOON, WED_NOON, TZ)).toBe(0);
  });

  it('ein Wochenende zählt nicht: Freitag 18 Uhr bis Montag 6 Uhr sind nur 6 + 6 Stunden', () => {
    const friday = new Date('2026-10-23T16:00:00Z'); // Freitag 18:00 Berlin
    const monday = new Date('2026-10-26T05:00:00Z'); // Montag 06:00 Berlin (Winterzeit: UTC+1)
    expect(workingTimeElapsedMs(friday, monday, TZ)).toBe(hours(6) + hours(6));
  });

  it('die Grenze von zwei Arbeitstagen: Mittwoch Mittag bis Freitag Mittag ist erreicht, kurz davor nicht', () => {
    const fridayNoon = new Date(WED_NOON.getTime() + 2 * DAY_MS);
    expect(outageLimitReached(WED_NOON, new Date(fridayNoon.getTime() - 60_000), TZ, 2)).toBe(false);
    expect(outageLimitReached(WED_NOON, fridayNoon, TZ, 2)).toBe(true);
  });

  it('beginnt der Ausfall am Freitag, läuft die Uhr über das Wochenende nicht: erreicht ist die Grenze erst am Dienstag', () => {
    const fridayNoon = new Date('2026-10-23T10:00:00Z');
    expect(outageLimitReached(fridayNoon, new Date('2026-10-26T10:00:00Z'), TZ, 2)).toBe(false); // Montag Mittag: 12 + 12 = 1 Tag
    expect(outageLimitReached(fridayNoon, new Date('2026-10-27T10:59:00Z'), TZ, 2)).toBe(false); // Dienstag 11:59 (Winterzeit: eine Stunde weniger am Freitag davor)
    expect(outageLimitReached(fridayNoon, new Date('2026-10-27T11:00:00Z'), TZ, 2)).toBe(true); // Dienstag Mittag Ortszeit
  });

  it('beginnt der Ausfall am Samstag, zählt erst der Montag', () => {
    const saturday = new Date('2026-10-24T10:00:00Z');
    expect(workingTimeElapsedMs(saturday, new Date('2026-10-26T10:00:00Z'), TZ)).toBe(hours(11)); // Montag 00:00 bis 11:00 Berlin (Winterzeit)
  });

  it('die Zeitzone des Betriebs entscheidet, wann ein Tag beginnt', () => {
    const lateFridayUtc = new Date('2026-10-23T23:30:00Z'); // in Berlin schon Samstag 01:30
    expect(workingTimeElapsedMs(lateFridayUtc, new Date('2026-10-24T05:30:00Z'), TZ)).toBe(0);
    expect(workingTimeElapsedMs(lateFridayUtc, new Date('2026-10-24T05:30:00Z'), 'America/Los_Angeles')).toBe(hours(6)); // dort noch Freitag
  });
});
