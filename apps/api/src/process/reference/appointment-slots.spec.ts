import { proposeSlots, zonedTimeToUtc } from './appointment-slots';

const BERLIN = 'Europe/Berlin';
/** Mittwoch, 14.10.2026, 10:00 Uhr Ortszeit (Sommerzeit, UTC+2). */
const NOW = new Date('2026-10-14T08:00:00Z');

describe('Zeitzonen-Umrechnung', () => {
  it('Ortszeit → UTC mit Sommer- und Winterzeit', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 23 }, 9, 0, BERLIN).toISOString()).toBe('2026-10-23T07:00:00.000Z'); // Sommerzeit
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 26 }, 9, 0, BERLIN).toISOString()).toBe('2026-10-26T08:00:00.000Z'); // nach der Umstellung am 25.10.
    expect(zonedTimeToUtc({ year: 2026, month: 12, day: 1 }, 14, 30, 'UTC').toISOString()).toBe('2026-12-01T14:30:00.000Z');
  });
});

describe('Terminvorschläge', () => {
  it('drei Vorschläge an verschiedenen Werktagen, frühestens am nächsten Tag, über den Tag verteilt', () => {
    const slots = proposeSlots({ kind: 'SITE_VISIT', now: NOW, timeZone: BERLIN, calendars: [] });
    expect(slots.map((s) => s.label)).toEqual([
      'Donnerstag, 15.10.2026, 09:00–10:30 Uhr',
      'Freitag, 16.10.2026, 14:00–15:30 Uhr',
      'Montag, 19.10.2026, 11:00–12:30 Uhr', // das Wochenende wird übersprungen
    ]);
    expect(slots[0]!.end.getTime() - slots[0]!.start.getTime()).toBe(90 * 60_000);
  });

  it('ein Telefontermin dauert 20 Minuten', () => {
    const slots = proposeSlots({ kind: 'PHONE_CALL', now: NOW, timeZone: BERLIN, calendars: [] });
    expect(slots).toHaveLength(3);
    expect(slots[0]!.end.getTime() - slots[0]!.start.getTime()).toBe(20 * 60_000);
  });

  it('belegte Zeiten werden ausgespart; bei einem Vor-Ort-Termin bleibt ein Puffer für die Anfahrt', () => {
    // Donnerstag 10:30–11:00 belegt: 09:00–10:30 grenzt an → der Puffer (30 min) verbietet diesen Beginn, 14:00 bleibt frei.
    const busy = [{ start: new Date('2026-10-15T08:30:00Z'), end: new Date('2026-10-15T09:00:00Z') }];
    const slots = proposeSlots({ kind: 'SITE_VISIT', now: NOW, timeZone: BERLIN, calendars: [busy] });
    expect(slots[0]!.label).toBe('Donnerstag, 15.10.2026, 14:00–15:30 Uhr');
    // Ohne Puffer (Telefon) wäre 09:30 frei gewesen – hier nicht belegt, also Standard.
    expect(proposeSlots({ kind: 'PHONE_CALL', now: NOW, timeZone: BERLIN, calendars: [busy] })[0]!.label).toBe('Donnerstag, 15.10.2026, 09:30–09:50 Uhr');
  });

  it('ein vollständig belegter Tag wird ausgelassen; ist alles belegt, gibt es keine Vorschläge (nie erfundene Zeiten)', () => {
    const wholeDay = (iso: string) => ({ start: new Date(`${iso}T05:00:00Z`), end: new Date(`${iso}T17:00:00Z`) });
    const busy = ['2026-10-15', '2026-10-16'].map(wholeDay);
    expect(proposeSlots({ kind: 'SITE_VISIT', now: NOW, timeZone: BERLIN, calendars: [busy] })[0]!.label).toContain('Montag, 19.10.2026');
    const everything = [{ start: new Date('2026-10-14T00:00:00Z'), end: new Date('2026-12-31T00:00:00Z') }];
    expect(proposeSlots({ kind: 'SITE_VISIT', now: NOW, timeZone: BERLIN, calendars: [everything] })).toEqual([]);
  });

  it('mehrere Kalender sind ein Pool: ein Termin ist möglich, sobald mindestens ein Kalender frei ist', () => {
    const monteurA = [{ start: new Date('2026-10-15T07:00:00Z'), end: new Date('2026-10-15T08:30:00Z') }]; // Do 09:00–10:30 belegt
    const monteurB: Array<{ start: Date; end: Date }> = [];
    expect(proposeSlots({ kind: 'SITE_VISIT', now: NOW, timeZone: BERLIN, calendars: [monteurA, monteurB] })[0]!.label).toBe('Donnerstag, 15.10.2026, 09:00–10:30 Uhr');
    // Sind beide belegt, entfällt dieser Zeitraum.
    expect(proposeSlots({ kind: 'SITE_VISIT', now: NOW, timeZone: BERLIN, calendars: [monteurA, monteurA] })[0]!.label).toBe('Donnerstag, 15.10.2026, 14:00–15:30 Uhr');
  });

  it('die Zeitzone des Mandanten bestimmt die Geschäftszeit', () => {
    const slots = proposeSlots({ kind: 'PHONE_CALL', now: NOW, timeZone: 'America/New_York', calendars: [], count: 1 });
    expect(slots[0]!.label).toMatch(/09:30–09:50 Uhr$/);
    expect(slots[0]!.start.toISOString()).toBe('2026-10-15T13:30:00.000Z'); // 09:30 New York (UTC−4)
  });
});
