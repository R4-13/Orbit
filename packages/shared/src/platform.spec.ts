import { describe, expect, it } from 'vitest';
import { ROLES } from './permissions';
import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_SCOPES,
  PLATFORM_SCOPES,
  isPlatformRole,
  isReservedRoleName,
  normalizeEnvironment,
  scopesForRoles,
} from './platform';

describe('Plattform-Rollenmatrix (Amendment 03 §2)', () => {
  it('jede Plattformrolle hat den reservierten Präfix und keine Mandantenrolle trägt ihn', () => {
    for (const role of Object.values(PLATFORM_ROLES)) expect(isReservedRoleName(role)).toBe(true);
    for (const role of Object.values(ROLES)) expect(isReservedRoleName(role)).toBe(false);
    expect(isReservedRoleName('  platform_owner ')).toBe(true);
  });

  it('nur der Owner verwaltet Identitäten', () => {
    const holders = Object.entries(PLATFORM_ROLE_SCOPES).filter(([, scopes]) => scopes.includes(PLATFORM_SCOPES.IDENTITY_MANAGE));
    expect(holders.map(([role]) => role)).toEqual(['PLATFORM_OWNER']);
  });

  it('Mandantennutzdaten werden nie über eine Rolle gelesen: der Payload-Scope ist keiner Rolle zugeordnet, auch nicht dem Owner', () => {
    for (const scopes of Object.values(PLATFORM_ROLE_SCOPES)) expect(scopes).not.toContain(PLATFORM_SCOPES.DIAGNOSTICS_PAYLOAD_READ);
  });

  it('Plattform-Secrets setzen dürfen nur Owner und Operator', () => {
    const holders = Object.entries(PLATFORM_ROLE_SCOPES).filter(([, scopes]) => scopes.includes(PLATFORM_SCOPES.AI_SECRETS_WRITE)).map(([role]) => role);
    expect(holders.sort()).toEqual(['PLATFORM_OPERATOR', 'PLATFORM_OWNER']);
  });

  it('Support kann weder konfigurieren noch Features ändern noch Secrets setzen', () => {
    const support = PLATFORM_ROLE_SCOPES.PLATFORM_SUPPORT;
    for (const scope of [PLATFORM_SCOPES.CONFIG_WRITE, PLATFORM_SCOPES.FEATURES_WRITE, PLATFORM_SCOPES.AI_SECRETS_WRITE, PLATFORM_SCOPES.AI_WRITE, PLATFORM_SCOPES.KILLSWITCH_WRITE, PLATFORM_SCOPES.AUDIT_READ]) {
      expect(support).not.toContain(scope);
    }
  });

  it('Kill Switch: Owner, Security und Release Manager – Operator und Support nicht', () => {
    const holders = Object.entries(PLATFORM_ROLE_SCOPES).filter(([, scopes]) => scopes.includes(PLATFORM_SCOPES.KILLSWITCH_WRITE)).map(([role]) => role);
    expect(holders.sort()).toEqual(['PLATFORM_OWNER', 'PLATFORM_RELEASE_MANAGER', 'PLATFORM_SECURITY']);
  });

  it('scopesForRoles vereinigt Rollen, ignoriert unbekannte Namen (auch Mandantenrollen) und ist deterministisch sortiert', () => {
    const scopes = scopesForRoles(['PLATFORM_FINOPS', 'TENANT_ADMIN', 'SYSTEM_ADMIN', 'PLATFORM_AUDITOR', 'nonsense']);
    expect(scopes).toContain(PLATFORM_SCOPES.AI_COST_READ);
    expect(scopes).not.toContain(PLATFORM_SCOPES.IDENTITY_MANAGE);
    expect([...scopes]).toEqual([...scopes].sort());
    expect(scopesForRoles(['TENANT_ADMIN', 'SYSTEM_ADMIN'])).toEqual([]);
  });

  it('isPlatformRole erkennt nur echte Plattformrollen', () => {
    expect(isPlatformRole('PLATFORM_OWNER')).toBe(true);
    expect(isPlatformRole('SYSTEM_ADMIN')).toBe(false);
  });

  it('unbekannte Umgebung wird als development behandelt, nie als production', () => {
    expect(normalizeEnvironment('production')).toBe('production');
    expect(normalizeEnvironment('prod')).toBe('development');
    expect(normalizeEnvironment(undefined)).toBe('development');
  });
});
