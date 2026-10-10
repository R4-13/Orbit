import { describe, expect, it } from 'vitest';
import { directoryGaps, onboardingChecklist } from './onboarding';
import type { RoutableStaff } from './staff-routing';

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

describe('Lücken im Verzeichnis', () => {
  it('ein leeres Verzeichnis ist die erste Lücke', () => {
    expect(directoryGaps([])).toEqual(['Es ist noch keine Person erfasst.']);
  });

  it('ohne Leitung, mit unerreichbarem Kanal und ohne Notfallzuständigen meldet es jede Lücke einzeln', () => {
    const staff = [person('anna', { preferredChannel: 'WHATSAPP', email: null }), person('ben', { roleKind: 'TECHNICIAN', email: null, phone: '+49 171 1' , preferredChannel: 'PHONE' })];
    const gaps = directoryGaps(staff, { emergencyService: true });
    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Inhaber oder Leitung'),
        expect.stringContaining('anna Test: Für den Kanal WhatsApp fehlt die Nummer.'),
        expect.stringContaining('ben Test hat keine E-Mail-Adresse'),
        expect.stringContaining('Notdienst'),
      ]),
    );
  });

  it('eine zuständige Person ohne Vertretung und Vorgesetzten wird als Risiko genannt, der Inhaber nicht', () => {
    const chef = person('chef', { roleKind: 'OWNER', responsibilities: ['QUOTES'] });
    const alone = person('lena', { responsibilities: ['INVOICES'] });
    const gaps = directoryGaps([chef, alone]);
    expect(gaps.some((g) => g.startsWith('lena Test ist zuständig'))).toBe(true);
    expect(gaps.some((g) => g.startsWith('chef Test ist zuständig'))).toBe(false);
  });
});

describe('Einrichtungs-Checkliste', () => {
  it('ein neuer Betrieb hat nichts erledigt; ein vollständig eingerichteter ist komplett', () => {
    const empty = onboardingChecklist({ profile: null, staff: [], automationConfirmed: false });
    expect(empty.doneCount).toBe(1); // Notfallzuständigkeit entfällt ohne Notdienst
    expect(empty.complete).toBe(false);

    const chef = person('chef', { roleKind: 'OWNER', responsibilities: ['EMERGENCY', 'QUOTES'] });
    const done = onboardingChecklist({
      profile: { industry: 'Dachdecker', services: ['Dachsanierung'], openingHours: [{ days: ['MON'], from: '07:00', to: '16:00' }], emergencyService: true },
      staff: [chef],
      automationConfirmed: true,
    });
    expect(done.steps.filter((s) => !s.done)).toEqual([]);
    expect(done.complete).toBe(true);
  });
});
