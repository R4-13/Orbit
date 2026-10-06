import { ConflictException } from '@nestjs/common';
import { PLATFORM_ROLES, PlatformNotConfiguredError, ValidationFailedError, type PlatformPrincipal } from '@orbit/shared';
import { PlatformAuthService } from '../auth/platform-auth.service';
import { PlatformIdentityService } from './platform-identity.service';

const actor: PlatformPrincipal = {
  userId: 'actor',
  email: 'actor@example.test',
  displayName: 'Actor',
  platformRoles: ['PLATFORM_OWNER'],
  platformScopes: [],
  authenticationAssurance: 'PASSWORD_STEP_UP',
  sessionId: 's1',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date().toISOString(),
  environment: 'test',
};

function build(options: { otherActiveOwners: number; targetRoles: string[] }) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const revoke = jest.fn().mockResolvedValue(1);
  const user = { id: 'target', email: 't@example.test', displayName: 'T', status: 'ACTIVE' as const, lastLoginAt: null, createdAt: new Date(), roleAssignments: options.targetRoles.map((role) => ({ role })) };
  const tx = {
    platformUser: { findUnique: jest.fn().mockResolvedValue(user), findUniqueOrThrow: jest.fn().mockResolvedValue(user), update: jest.fn() },
    platformRoleAssignment: { count: jest.fn().mockResolvedValue(options.otherActiveOwners), updateMany: jest.fn(), create: jest.fn() },
  };
  const prisma = { withPlatformScope: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const service = new PlatformIdentityService(prisma as never, audit as never, { revokeAllSessions: revoke } as unknown as PlatformAuthService);
  return { service, tx, audit, revoke };
}

describe('PlatformIdentityService – Schutz des letzten Owners (Amendment 03 §2.4)', () => {
  it('entzieht die Owner-Rolle nicht, wenn kein anderer aktiver Owner existiert', async () => {
    const { service, tx, revoke } = build({ otherActiveOwners: 0, targetRoles: [PLATFORM_ROLES.PLATFORM_OWNER] });
    await expect(service.setRoles(actor, 'target', { roles: [PLATFORM_ROLES.PLATFORM_AUDITOR], reason: 'Test Entzug' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.platformRoleAssignment.updateMany).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('erlaubt den Entzug, wenn ein weiterer aktiver Owner existiert, und beendet die Sitzungen', async () => {
    const { service, tx, revoke, audit } = build({ otherActiveOwners: 1, targetRoles: [PLATFORM_ROLES.PLATFORM_OWNER] });
    await service.setRoles(actor, 'target', { roles: [PLATFORM_ROLES.PLATFORM_AUDITOR], reason: 'Test Entzug' });
    expect(tx.platformRoleAssignment.updateMany).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PLATFORM_ROLE_REVOKED', reason: 'Test Entzug' }), tx);
    expect(revoke).toHaveBeenCalledWith('target', 'ROLES_CHANGED');
  });

  it('deaktiviert den letzten aktiven Owner nicht', async () => {
    const { service, tx } = build({ otherActiveOwners: 0, targetRoles: [PLATFORM_ROLES.PLATFORM_OWNER] });
    await expect(service.disable(actor, 'target', 'Test Deaktivierung')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.platformUser.update).not.toHaveBeenCalled();
  });

  it('beendet bei unveränderten Rollen keine Sitzungen', async () => {
    const { service, revoke } = build({ otherActiveOwners: 1, targetRoles: [PLATFORM_ROLES.PLATFORM_AUDITOR] });
    await service.setRoles(actor, 'target', { roles: [PLATFORM_ROLES.PLATFORM_AUDITOR], reason: 'Keine Änderung' });
    expect(revoke).not.toHaveBeenCalled();
  });

  it('lehnt leere und unbekannte Rollenlisten sowie schwache Passwörter ab', async () => {
    const { service } = build({ otherActiveOwners: 1, targetRoles: [] });
    await expect(service.setRoles(actor, 'target', { roles: [], reason: 'Test leer' })).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(service.setRoles(actor, 'target', { roles: ['TENANT_ADMIN'], reason: 'Test fremd' })).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(service.create(actor, { email: 'x@example.test', displayName: 'X', password: 'kurz', roles: [PLATFORM_ROLES.PLATFORM_AUDITOR] })).rejects.toBeInstanceOf(ValidationFailedError);
  });
});

describe('PlatformAuthService – ohne PLATFORM_JWT_SECRET ist die Domäne aus', () => {
  it('assertEnabled wirft PlatformNotConfiguredError (kein Standard-Secret)', () => {
    const service = new PlatformAuthService({} as never, {} as never, {} as never, { PLATFORM_JWT_SECRET: undefined } as never);
    expect(service.enabled).toBe(false);
    expect(() => service.assertEnabled()).toThrow(PlatformNotConfiguredError);
  });

  it('login/refresh scheitern vor jedem Datenbankzugriff', async () => {
    const prisma = { withPlatformScope: jest.fn() };
    const service = new PlatformAuthService(prisma as never, {} as never, {} as never, { PLATFORM_JWT_SECRET: undefined } as never);
    await expect(service.login('a@b.example', 'x')).rejects.toBeInstanceOf(PlatformNotConfiguredError);
    await expect(service.refresh('x'.repeat(20))).rejects.toBeInstanceOf(PlatformNotConfiguredError);
    await expect(service.authenticate('token')).rejects.toBeInstanceOf(PlatformNotConfiguredError);
    expect(prisma.withPlatformScope).not.toHaveBeenCalled();
  });
});
