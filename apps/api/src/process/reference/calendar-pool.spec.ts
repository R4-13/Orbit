import { absenceIntervals, buildCalendarPool, effectiveBusy, pickCalendar } from './calendar-pool';

const staff = (id: string, calendarId: string | null, extra: Record<string, unknown> = {}) => ({ id, firstName: id, lastName: 'Monteur', calendarId, active: true, ...extra });
const at = (iso: string) => new Date(iso);

describe('Kalender-Pool', () => {
  it('Betriebskalender plus die Kalender aktiver Personen, ohne Doppelte, Obergrenze 20', () => {
    const pool = buildCalendarPool(['primary', 'ben@x'], [staff('ben', 'ben@x'), staff('ida', 'ida@x'), staff('weg', 'weg@x', { active: false }), staff('ohne', null)]);
    expect(pool.map((c) => c.calendarId)).toEqual(['primary', 'ben@x', 'ida@x']);
    expect(pool[0]?.staff).toBeUndefined();
    expect(pool[1]?.staff?.name).toBe('ben Monteur'); // der Kalender aus der Einstellung gehört trotzdem der Person
    expect(buildCalendarPool(Array.from({ length: 30 }, (_, i) => `c${i}`), [])).toHaveLength(20);
  });

  it('Abwesenheit sperrt ganze Ortstage, auch über Monatsgrenzen', () => {
    const blocks = absenceIntervals([{ from: '2026-10-30', until: '2026-11-02' }, { from: 'kaputt', until: 1 }], at('2026-10-20T00:00:00Z'), at('2026-11-30T00:00:00Z'), 'Europe/Berlin');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.start.toISOString()).toBe('2026-10-29T23:00:00.000Z'); // 30.10. 00:00 Ortszeit (MESZ)
    expect(blocks[0]?.end.toISOString()).toBe('2026-11-02T23:00:00.000Z'); // 03.11. 00:00 Ortszeit (MEZ)
    expect(absenceIntervals([{ from: '2026-01-01', until: '2026-01-05' }], at('2026-10-20T00:00:00Z'), at('2026-11-30T00:00:00Z'), 'Europe/Berlin')).toEqual([]);
  });

  it('ein Kalender einer Person geht vor dem Betriebskalender; abwesende oder belegte Personen werden übersprungen', () => {
    const start = at('2026-10-21T08:00:00Z');
    const end = at('2026-10-21T09:30:00Z');
    const pool = buildCalendarPool(['primary'], [staff('anton', 'anton@x', { absences: [{ from: '2026-10-21', until: '2026-10-21' }] }), staff('ben', 'ben@x'), staff('carl', 'carl@x')]);
    const busy = (id: string) => (id === 'ben@x' ? [{ start, end }] : []);
    const picked = pickCalendar(pool, busy, start, end, 'Europe/Berlin');
    expect(picked?.calendarId).toBe('carl@x'); // anton abwesend, ben belegt
    expect(effectiveBusy(pool[1] as never, [], start, end, 'Europe/Berlin')).toHaveLength(1);
    // Niemand außer dem Betriebskalender frei → Betriebskalender, ohne zuständige Person.
    const onlyCompany = pickCalendar(pool, (id) => (id === 'primary' ? [] : [{ start, end }]), start, end, 'Europe/Berlin');
    expect(onlyCompany?.calendarId).toBe('primary');
    expect(onlyCompany?.staff).toBeUndefined();
    // Alles belegt → kein Kalender.
    expect(pickCalendar(pool, () => [{ start, end }], start, end, 'Europe/Berlin')).toBeUndefined();
  });
});
