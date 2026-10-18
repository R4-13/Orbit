import { describe, expect, it } from 'vitest';
import { onboardingChecklist } from './onboarding';
import { buildSetupAssessment, type SetupInput } from './setup-assistant';

const staff = [
  { id: '1', firstName: 'Frank', lastName: 'Chef', roleKind: 'OWNER', email: 'chef@betrieb.example', phone: null, teamsAddress: null, whatsappNumber: null, preferredChannel: 'EMAIL', responsibilities: ['QUOTES', 'EMERGENCY'], active: true, deputyId: null, supervisorId: null },
] as never;
const profile = { industry: 'Heizung und Sanitär', services: ['Heizungswartung'], openingHours: [{ days: ['MON'], from: '08:00', to: '16:00' }], emergencyService: false };

const complete = (): SetupInput => ({
  onboarding: onboardingChecklist({ profile, staff, automationConfirmed: true }),
  integrations: { gmail: { connected: true, granted: ['email.read', 'email.send', 'calendar.freebusy', 'calendar.write'] }, hubspot: { connected: true } },
  capabilities: { 'email.send': true, 'calendar.book': true, 'calendar.read': true },
  modes: { 'email.send.clarification': 'AUTONOMOUS', 'email.send.information': 'REQUIRE_APPROVAL', 'meeting.create': 'REQUIRE_APPROVAL', 'lead.create': 'AUTONOMOUS', 'staff.notify': 'AUTONOMOUS' },
  staffCount: 1,
});
const task = (input: SetupInput, key: string) => buildSetupAssessment(input).tasks.find((t) => t.key === key)!;
const step = (input: SetupInput, key: string) => buildSetupAssessment(input).steps.find((s) => s.key === key)!;

describe('Einrichtungsassistent', () => {
  it('vollständig eingerichtet: alle Pflichtschritte erledigt, jede Aufgabe verfügbar, Freigaben nach den Regeln', () => {
    const result = buildSetupAssessment(complete());
    expect(result.ready).toBe(true);
    expect(result.requiredDone).toBe(result.requiredTotal);
    expect(result.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(task(complete(), 'ASK_BACK').state).toBe('AUTOMATIC');
    expect(task(complete(), 'BOOK').state).toBe('WITH_APPROVAL');
    expect(task(complete(), 'HANDOFF').detail).toContain('HubSpot');
    expect(result.tasks.every((t) => t.state !== 'UNAVAILABLE')).toBe(true);
  });

  it('ein neuer Betrieb: nichts erledigt, ORBIT nimmt ehrlich noch nichts entgegen', () => {
    const input: SetupInput = { onboarding: onboardingChecklist({ profile: null, staff: [], automationConfirmed: false }), integrations: {}, capabilities: {}, modes: {}, staffCount: 0 };
    const result = buildSetupAssessment(input);
    expect(result.ready).toBe(false);
    expect(result.requiredDone).toBe(0);
    expect(result.steps.map((s) => s.status)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OPEN', 'OPEN', 'OPEN']);
    expect(task(input, 'READ_MAIL')).toMatchObject({ state: 'UNAVAILABLE', unlock: { stepKey: 'MAIL' } });
    expect(task(input, 'ASK_BACK').state).toBe('UNAVAILABLE');
    expect(task(input, 'NOTIFY')).toMatchObject({ state: 'UNAVAILABLE', unlock: { stepKey: 'STAFF' } });
    expect(task(input, 'ANSWER').detail).toContain('erfindet nichts');
  });

  it('Kalender und CRM sind optional: ohne sie ist der Betrieb startklar, ORBIT sagt aber, was dann anders läuft', () => {
    const input = complete();
    input.integrations = { gmail: { connected: true, granted: ['email.read', 'email.send'] } };
    input.capabilities = { 'email.send': true };
    const result = buildSetupAssessment(input);
    expect(result.ready).toBe(true);
    expect(step(input, 'CALENDAR').status).toBe('OPEN');
    expect(step(input, 'CRM').status).toBe('OPEN');
    expect(task(input, 'PROPOSE_SLOTS')).toMatchObject({ state: 'BY_HAND', unlock: { stepKey: 'CALENDAR' } });
    expect(task(input, 'PROPOSE_SLOTS').detail).toContain('Terminwünsche');
    expect(task(input, 'BOOK')).toMatchObject({ state: 'BY_HAND', unlock: { stepKey: 'CALENDAR' } });
    expect(task(input, 'HANDOFF').detail).toContain('eigenen Kundenverwaltung');
    expect(task(input, 'HANDOFF').unlock?.stepKey).toBe('CRM');
  });

  it('nur Kalender lesen: Termine werden vorgeschlagen, aber noch nicht gebucht; der Schritt gilt als teilweise erledigt', () => {
    const input = complete();
    input.integrations = { gmail: { connected: true, granted: ['email.read', 'email.send', 'calendar.freebusy'] } };
    input.capabilities = { 'email.send': true, 'calendar.book': false };
    expect(step(input, 'CALENDAR').status).toBe('PARTIAL');
    expect(task(input, 'PROPOSE_SLOTS').state).toBe('AUTOMATIC');
    expect(task(input, 'BOOK').state).toBe('BY_HAND');
  });

  it('Gmail verbunden, aber ohne Senden: lesen geht, antworten nicht', () => {
    const input = complete();
    input.integrations = { gmail: { connected: true, granted: ['email.read'] } };
    input.capabilities = { 'email.send': false };
    expect(step(input, 'MAIL').status).toBe('PARTIAL');
    expect(task(input, 'READ_MAIL').state).toBe('AUTOMATIC');
    expect(task(input, 'ASK_BACK')).toMatchObject({ state: 'UNAVAILABLE', unlock: { stepKey: 'MAIL' } });
  });

  it('die Regeln bestimmen, ob ORBIT allein arbeitet, vorher fragt oder nur vorschlägt', () => {
    const input = complete();
    input.modes = { ...input.modes, 'email.send.clarification': 'REQUIRE_APPROVAL', 'lead.create': 'SUGGEST_ONLY', 'staff.notify': 'DISABLED' };
    expect(task(input, 'ASK_BACK').state).toBe('WITH_APPROVAL');
    expect(task(input, 'HANDOFF').state).toBe('BY_HAND');
    expect(task(input, 'NOTIFY').state).toBe('BY_HAND');
  });

  it('Pflichtschritte zählen, optionale nicht', () => {
    const input = complete();
    input.integrations = {};
    input.capabilities = {};
    const result = buildSetupAssessment(input);
    expect(result.requiredTotal).toBe(4);
    expect(result.requiredDone).toBe(3); // Betrieb, Mitarbeitende, Regeln – das Postfach fehlt
    expect(result.ready).toBe(false);
  });
});
