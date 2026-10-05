import { isValidTimezone, periodRange } from './dashboard-time';

describe('periodRange', () => {
  it('starts "today" at local midnight in Berlin (CEST, UTC+2)', () => {
    const now = new Date('2026-10-05T10:30:00.000Z'); // 12:30 in Berlin
    const range = periodRange('TODAY', now, 'Europe/Berlin');
    expect(range.start.toISOString()).toBe('2026-10-04T22:00:00.000Z');
    expect(range.startOfToday.toISOString()).toBe('2026-10-04T22:00:00.000Z');
    expect(range.endOfToday.toISOString()).toBe('2026-10-05T22:00:00.000Z');
  });

  it('uses the zone of the user, not the server: just after midnight in Berlin is still the previous day in UTC', () => {
    const now = new Date('2026-10-05T22:30:00.000Z'); // 00:30 on the 6th in Berlin
    const berlin = periodRange('TODAY', now, 'Europe/Berlin');
    const utc = periodRange('TODAY', now, 'UTC');
    expect(berlin.start.toISOString()).toBe('2026-10-05T22:00:00.000Z');
    expect(utc.start.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('is DST-safe: the day the clocks go back has 25 hours', () => {
    const now = new Date('2026-10-25T12:00:00.000Z'); // CET already (UTC+1)
    const range = periodRange('TODAY', now, 'Europe/Berlin');
    expect(range.start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(range.endOfToday.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('starts the week on Monday and the month on the 1st', () => {
    const now = new Date('2026-10-08T09:00:00.000Z'); // Thursday
    expect(periodRange('WEEK', now, 'Europe/Berlin').start.toISOString()).toBe('2026-10-04T22:00:00.000Z'); // Mon 5 Oct 00:00 CEST
    expect(periodRange('MONTH', now, 'Europe/Berlin').start.toISOString()).toBe('2026-09-30T22:00:00.000Z'); // 1 Oct 00:00 CEST
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});
