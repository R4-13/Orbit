import { ProfileContextService } from './profile-context.service';

describe('ProfileContextService', () => {
  const build = (profile: unknown) => new ProfileContextService({ forTenantId: () => ({ tenantProfile: { findUnique: jest.fn().mockResolvedValue(profile) } }) } as never);

  it('ohne Profil gibt es keinen Abschnitt (die KI arbeitet allgemein, wie bisher)', async () => {
    expect(await build(null).promptFor('t1')).toBe('');
  });

  it('mit Profil entsteht ein benannter Abschnitt aus Branche, Leistungen, Notdienst und Tonalität', async () => {
    const text = await build({ industry: 'Dachdecker', description: null, services: ['Dachsanierung'], exclusions: [], serviceArea: null, openingHours: null, emergencyService: true, emergencyNote: 'rund um die Uhr', tone: 'FRIENDLY', languages: ['de'], faqs: null }).promptFor('t1');
    expect(text.startsWith('Betriebsprofil (vom Betrieb gepflegt):')).toBe(true);
    expect(text).toContain('Branche: Dachdecker.');
    expect(text).toContain('Leistungen: Dachsanierung.');
    expect(text).toContain('Notdienst: ja (rund um die Uhr).');
  });
});
