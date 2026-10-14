import { describe, expect, it } from 'vitest';
import { DEFAULT_ESCALATION_POLICY, DIGEST_MIN_ITEMS, composeStaffDigest, composeStaffNotice, escalationChain, isAbsent, formatWaiting, responsibilityForCase, escalationPhase, planDelivery, recipientsForPhase, resolveEscalationPolicy, responsiblesFor, type DeliveryChannel, type RoutableStaff } from './staff-routing';

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

describe('Betreff bei Notfällen', () => {
  it('doppelt das Präfix des Vorgangstitels nicht', () => {
    const { subject } = composeStaffNotice({ phase: 'INITIAL', kind: 'EMERGENCY', role: 'RESPONSIBLE', recipientFirstName: 'Ben', caseTitle: 'Notfall: Rohrbruch', waitingMinutes: 1, link: 'x', appName: 'ORBIT' });
    expect(subject).toBe('NOTFALL: Rohrbruch');
  });
});

describe('Abwesenheit (AUT-05)', () => {
  const holiday = [{ from: '2026-10-12', until: '2026-10-16', note: 'Urlaub' }];
  const away = (list: RoutableStaff[], id: string) => list.map((s) => (s.id === id ? { ...s, absences: holiday } : s));
  const during = new Date('2026-10-14T10:00:00Z');
  const after = new Date('2026-10-20T10:00:00Z');

  it('erkennt Abwesenheit tageweise mit beiden Grenzen und ignoriert Unbrauchbares', () => {
    expect(isAbsent({ absences: holiday }, during)).toBe(true);
    expect(isAbsent({ absences: holiday }, new Date('2026-10-12T00:30:00+02:00'))).toBe(true); // erster Tag, Zeitzone des Betriebs
    expect(isAbsent({ absences: holiday }, new Date('2026-10-16T22:30:00Z'))).toBe(false); // schon der 17. in Berlin
    expect(isAbsent({ absences: holiday }, after)).toBe(false);
    expect(isAbsent({ absences: 'kaputt' }, during)).toBe(false);
    expect(isAbsent({}, during)).toBe(false);
  });

  it('ist die zuständige Person abwesend, meldet schon die erste Meldung der Vertretung – nicht der abwesenden Person', () => {
    const chain = escalationChain(away(directory, 'buchhalterin'), 'buchhalterin', during);
    const initial = recipientsForPhase(chain, 'INITIAL');
    expect(initial.map((s) => s.staff.id)).toEqual(['vertretung']);
    expect(initial[0]).toMatchObject({ standIn: true, role: 'DEPUTY' });
    expect(recipientsForPhase(chain, 'REMINDER').map((s) => s.staff.id)).toEqual(['vertretung']);
    expect(recipientsForPhase(chain, 'ESCALATED').map((s) => s.staff.id)).toEqual(['vertretung', 'leiter', 'chef']);
  });

  it('ist auch die Vertretung abwesend, übernimmt die nächste erreichbare Stufe', () => {
    const both = away(away(directory, 'buchhalterin'), 'vertretung');
    const initial = recipientsForPhase(escalationChain(both, 'buchhalterin', during), 'INITIAL');
    expect(initial.map((s) => s.staff.id)).toEqual(['leiter']);
    expect(initial[0]).toMatchObject({ standIn: true });
  });

  it('niemand erreichbar: es wird trotzdem gemeldet (ein Eingang bleibt nie ohne Adressat)', () => {
    const everyone = directory.map((s) => ({ ...s, absences: holiday }));
    expect(recipientsForPhase(escalationChain(everyone, 'buchhalterin', during), 'INITIAL').map((s) => s.staff.id)).toEqual(['buchhalterin']);
  });

  it('ohne Zeitpunkt oder nach der Abwesenheit gilt die normale Kette', () => {
    const list = away(directory, 'buchhalterin');
    expect(recipientsForPhase(escalationChain(list, 'buchhalterin'), 'INITIAL').map((s) => s.staff.id)).toEqual(['buchhalterin']);
    expect(recipientsForPhase(escalationChain(list, 'buchhalterin', after), 'INITIAL').map((s) => s.staff.id)).toEqual(['buchhalterin']);
  });

  it('die Meldung nennt, für wen die Vertretung einspringt', () => {
    const notice = composeStaffNotice({ phase: 'INITIAL', kind: 'MANUAL_REVIEW', role: 'DEPUTY', recipientFirstName: 'Vera', caseTitle: 'Rechnung', waitingMinutes: 1, responsibleName: 'Bea Buchhaltung', standInFor: 'Bea Buchhaltung', link: 'https://x', appName: 'ORBIT' });
    expect(notice.text).toContain('Bea Buchhaltung ist heute abwesend');
  });
});

describe('Zusammenfassung mehrerer Meldungen (AUT-05)', () => {
  it('eine Mail nennt jeden Vorgang mit Anlass und Link', () => {
    const digest = composeStaffDigest({
      recipientFirstName: 'Bea',
      appName: 'ORBIT',
      entries: [
        { kind: 'WAITING_FOR_APPROVAL', caseTitle: 'Rechnung 1', reason: 'Eine Freigabe ist offen.', link: 'https://x/cases/1' },
        { kind: 'MANUAL_REVIEW', caseTitle: 'Anfrage 2', link: 'https://x/cases/2' },
        { kind: 'FAILED', caseTitle: 'Bestellung 3', link: 'https://x/cases/3' },
      ],
    });
    expect(digest.subject).toBe('3 neue Vorgänge brauchen Ihre Aufmerksamkeit');
    expect(digest.text).toContain('„Rechnung 1“ wartet auf eine Freigabe. Grund: Eine Freigabe ist offen.');
    expect(digest.text).toContain('https://x/cases/3');
    expect(DIGEST_MIN_ITEMS).toBe(3);
  });
});
