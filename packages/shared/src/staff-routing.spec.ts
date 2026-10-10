import { describe, expect, it } from 'vitest';
import { DEFAULT_ESCALATION_POLICY, escalationChain, escalationPhase, planDelivery, recipientsForPhase, resolveEscalationPolicy, responsiblesFor, type DeliveryChannel, type RoutableStaff } from './staff-routing';

const person = (id: string, over: Partial<RoutableStaff> = {}): RoutableStaff => ({
  id,
  firstName: id,
  lastName: 'Test',
  roleKind: 'OFFICE',
  responsibilities: [],
  active: true,
  preferredChannel: 'EMAIL',
  email: `${id}@betrieb.example`,
  ...over,
});

const chef = person('chef', { roleKind: 'OWNER', responsibilities: ['EMERGENCY'] });
const leiter = person('leiter', { roleKind: 'MANAGER', supervisorId: 'chef' });
const buchhalterin = person('buchhalterin', { roleKind: 'ACCOUNTING', responsibilities: ['INVOICES'], supervisorId: 'leiter', deputyId: 'vertretung' });
const vertretung = person('vertretung', { responsibilities: ['INVOICES'], supervisorId: 'leiter' });
const directory = [chef, leiter, buchhalterin, vertretung];

describe('Zuständigkeit', () => {
  it('nennt die Personen mit der Zuständigkeit, sonst „Allgemein“, sonst die Leitung – nie niemanden, solange es eine aktive Leitung gibt', () => {
    expect(responsiblesFor(directory, 'INVOICES').map((s) => s.id)).toEqual(['buchhalterin', 'vertretung']);
    expect(responsiblesFor(directory, 'QUOTES').map((s) => s.id)).toEqual(['chef', 'leiter']); // Inhaber vor Leitung
    const withGeneral = [...directory, person('empfang', { responsibilities: ['GENERAL'] })];
    expect(responsiblesFor(withGeneral, 'QUOTES').map((s) => s.id)).toEqual(['empfang']);
  });
  it('ausgeschiedene Personen zählen nicht; ohne aktive Leitung ist die Liste leer (Lücke im Verzeichnis)', () => {
    const left = directory.map((s) => (s.id === 'buchhalterin' ? { ...s, active: false } : s));
    expect(responsiblesFor(left, 'INVOICES').map((s) => s.id)).toEqual(['vertretung']);
    expect(responsiblesFor([person('a', { active: false })], 'INVOICES')).toEqual([]);
  });
});

describe('Eskalationskette', () => {
  it('zuständig → Vertretung → Vorgesetzter → Leitung, jede Person nur einmal', () => {
    const chain = escalationChain(directory, 'buchhalterin');
    expect(chain.map((s) => [s.role, s.staff.id])).toEqual([['RESPONSIBLE', 'buchhalterin'], ['DEPUTY', 'vertretung'], ['SUPERVISOR', 'leiter'], ['LEADERSHIP', 'chef']]);
  });
  it('ist die Vertretung krank oder ausgeschieden, wird sie übersprungen – die Kette bricht nicht ab', () => {
    const left = directory.map((s) => (s.id === 'vertretung' ? { ...s, active: false } : s));
    expect(escalationChain(left, 'buchhalterin').map((s) => s.staff.id)).toEqual(['buchhalterin', 'leiter', 'chef']);
  });
  it('ist die zuständige Person selbst die Leitung, gibt es keine weitere Stufe über ihr', () => {
    expect(escalationChain(directory, 'chef').map((s) => s.staff.id)).toEqual(['chef', 'leiter']);
  });
});

describe('Eskalationsphasen', () => {
  const policy = DEFAULT_ESCALATION_POLICY;
  it('Standardfälle: Erinnerung nach 4 Stunden, Eskalation nach 24; Notfälle nach 15 bzw. 45 Minuten', () => {
    expect(escalationPhase(10, policy, false)).toBe('INITIAL');
    expect(escalationPhase(240, policy, false)).toBe('REMINDER');
    expect(escalationPhase(1440, policy, false)).toBe('ESCALATED');
    expect(escalationPhase(10, policy, true)).toBe('INITIAL');
    expect(escalationPhase(15, policy, true)).toBe('REMINDER');
    expect(escalationPhase(45, policy, true)).toBe('ESCALATED');
  });
  it('wer in welcher Phase informiert wird: erst nur die zuständige Person, dann die Vertretung, zuletzt alle', () => {
    const chain = escalationChain(directory, 'buchhalterin');
    expect(recipientsForPhase(chain, 'INITIAL').map((s) => s.staff.id)).toEqual(['buchhalterin']);
    expect(recipientsForPhase(chain, 'REMINDER').map((s) => s.staff.id)).toEqual(['buchhalterin', 'vertretung']);
    expect(recipientsForPhase(chain, 'ESCALATED').map((s) => s.staff.id)).toEqual(['buchhalterin', 'vertretung', 'leiter', 'chef']);
  });
  it('gespeicherte Werte überschreiben die Standards; unsinnige Werte fallen auf die Standards zurück', () => {
    expect(resolveEscalationPolicy({ reminderAfterMinutes: 60 })).toMatchObject({ reminderAfterMinutes: 60, escalateAfterMinutes: 1440 });
    expect(resolveEscalationPolicy({ reminderAfterMinutes: 5000, escalateAfterMinutes: 100 })).toEqual(DEFAULT_ESCALATION_POLICY);
    expect(resolveEscalationPolicy(null)).toEqual(DEFAULT_ESCALATION_POLICY);
  });
});

describe('Zustellung', () => {
  const emailOnly = new Set<DeliveryChannel>(['EMAIL']);
  it('bevorzugter Kanal, wenn angebunden; sonst ehrlich per E-Mail mit Hinweis auf den Wunsch', () => {
    expect(planDelivery(person('a'), emailOnly)).toEqual({ via: 'EMAIL', address: 'a@betrieb.example' });
    const wa = person('b', { preferredChannel: 'WHATSAPP', whatsappNumber: '+49 171 123456' });
    expect(planDelivery(wa, emailOnly)).toMatchObject({ via: 'EMAIL', wanted: 'WHATSAPP', note: expect.stringContaining('noch nicht angebunden') });
    expect(planDelivery(wa, new Set<DeliveryChannel>(['EMAIL', 'WHATSAPP']))).toEqual({ via: 'WHATSAPP', address: '+49 171 123456' });
  });
  it('ohne erreichbaren Kanal gibt es keinen Plan – eine Lücke, die gemeldet wird', () => {
    expect(planDelivery(person('c', { email: null, preferredChannel: 'PHONE', phone: '+49 30 1234567' }), emailOnly)).toBeUndefined();
  });
});
