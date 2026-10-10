import { describe, expect, it } from 'vitest';
import { DEFAULT_ESCALATION_POLICY, composeStaffNotice, escalationChain, formatWaiting, responsibilityForCase, escalationPhase, planDelivery, recipientsForPhase, resolveEscalationPolicy, responsiblesFor, type DeliveryChannel, type RoutableStaff } from './staff-routing';

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


describe('Zuständigkeit für einen Vorgang', () => {
  it('Notfälle gehen an die Notfallzuständigen, sonst entscheidet die Kategorie, ersatzweise die Art des Vorgangs', () => {
    expect(responsibilityForCase({ category: 'REQUEST_FOR_QUOTE', emergency: true })).toBe('EMERGENCY');
    expect(responsibilityForCase({ category: 'INVOICE_RECEIVED' })).toBe('INVOICES');
    expect(responsibilityForCase({ category: 'COMPLAINT_OR_SERVICE' })).toBe('COMPLAINTS');
    expect(responsibilityForCase({ category: 'UNKNOWN', caseType: 'FINANCE' })).toBe('INVOICES');
    expect(responsibilityForCase({ caseType: 'SALES' })).toBe('QUOTES');
    expect(responsibilityForCase({})).toBe('GENERAL');
  });
});

describe('Text der Meldungen', () => {
  const base = { kind: 'WAITING_FOR_APPROVAL' as const, recipientFirstName: 'Bea', caseTitle: 'Neue Anfrage: Dach', reason: 'Eine Freigabe ist offen.', waitingMinutes: 300, link: 'https://orbit.example/cases/1', appName: 'ORBIT' };
  it('erste Meldung: Grund, Link und der Hinweis, dass ORBIT nicht untätig wartet', () => {
    const { subject, text } = composeStaffNotice({ ...base, phase: 'INITIAL', role: 'RESPONSIBLE' });
    expect(subject).toBe('Neu: Neue Anfrage: Dach');
    expect(text).toContain('wartet auf eine Freigabe');
    expect(text).toContain('Grund: Eine Freigabe ist offen.');
    expect(text).toContain('https://orbit.example/cases/1');
    expect(text).toContain('wartet nicht untätig');
  });
  it('Erinnerung an die Vertretung nennt, für wen sie einspringt; die Eskalation nennt, wer nicht reagiert hat', () => {
    const deputy = composeStaffNotice({ ...base, phase: 'REMINDER', role: 'DEPUTY', responsibleName: 'Anna Beispiel' });
    expect(deputy.subject).toBe('Erinnerung: Neue Anfrage: Dach');
    expect(deputy.text).toContain('Vertretung eingetragen für Anna Beispiel');
    expect(deputy.text).toContain('seit 5 Stunden');
    const boss = composeStaffNotice({ ...base, phase: 'ESCALATED', role: 'SUPERVISOR', responsibleName: 'Anna Beispiel', waitingMinutes: 1500 });
    expect(boss.subject.startsWith('Eskalation:')).toBe(true);
    expect(boss.text).toContain('Anna Beispiel hat seit 25 Stunden nicht reagiert');
  });
  it('Notfälle sind schon im Betreff unübersehbar', () => {
    const { subject, text } = composeStaffNotice({ ...base, kind: 'EMERGENCY', phase: 'INITIAL', role: 'RESPONSIBLE' });
    expect(subject.startsWith('NOTFALL:')).toBe(true);
    expect(text).toContain('einen Notfall erkannt');
  });
  it('Wartezeiten werden lesbar angegeben', () => {
    expect([formatWaiting(0), formatWaiting(45), formatWaiting(180), formatWaiting(3 * 1440)]).toEqual(['1 Minuten', '45 Minuten', '3 Stunden', '3 Tagen']);
  });
});
