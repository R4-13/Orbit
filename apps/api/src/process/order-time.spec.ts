import { ValidationFailedError } from '@orbit/shared';
import { formatOrderTime, parseOrderTime } from './order-time';

describe('Zeitangaben eines Auftrags', () => {
  it('liest die Ortszeit des Betriebs samt Sommer- und Winterzeit', () => {
    expect(parseOrderTime('2026-10-20T08:00', 'Europe/Berlin', 'Zeit').toISOString()).toBe('2026-10-20T06:00:00.000Z'); // MESZ, UTC+2
    expect(parseOrderTime('2026-12-01T08:00', 'Europe/Berlin', 'Zeit').toISOString()).toBe('2026-12-01T07:00:00.000Z'); // MEZ, UTC+1
    expect(parseOrderTime('2026-10-20T08:00', 'America/New_York', 'Zeit').toISOString()).toBe('2026-10-20T12:00:00.000Z');
  });

  it('übernimmt einen ausdrücklichen Zeitzonenversatz unverändert', () => {
    expect(parseOrderTime('2026-10-20T08:00:00+02:00', 'Europe/Berlin', 'Zeit').toISOString()).toBe('2026-10-20T06:00:00.000Z');
    expect(parseOrderTime('2026-10-20T06:00:00Z', 'Europe/Berlin', 'Zeit').toISOString()).toBe('2026-10-20T06:00:00.000Z');
  });

  it('lehnt unklare Angaben ab, statt zu raten', () => {
    for (const bad of ['morgen früh', '20.10.2026 08:00', '2026-13-40T25:99', '']) expect(() => parseOrderTime(bad, 'Europe/Berlin', 'Der Zeitpunkt')).toThrow(ValidationFailedError);
  });

  it('formatiert die Ortszeit lesbar', () => {
    expect(formatOrderTime(new Date('2026-10-20T06:00:00Z'), 'Europe/Berlin')).toMatch(/20\.10\.2026.*08:00 Uhr/);
  });
});
