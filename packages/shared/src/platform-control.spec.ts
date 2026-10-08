import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_SEND_POLICY_ACTIONS,
  KILL_SWITCHES,
  KILL_SWITCH_DESCRIPTIONS,
  confirmationTokenFor,
  describeTenantTarget,
  evaluateFlag,
  isKillSwitchKey,
  isReservedFlagKey,
  tenantGateOf,
  type FlagDefinition,
} from './platform-control';
import { POLICY_ACTIONS } from './policy';

describe('Kill Switches', () => {
  it('jeder Schalter hat eine verständliche Wirkungsbeschreibung', () => {
    for (const key of Object.values(KILL_SWITCHES)) {
      expect(isKillSwitchKey(key)).toBe(true);
      expect(KILL_SWITCH_DESCRIPTIONS[key].effect.length).toBeGreaterThan(20);
    }
    expect(isKillSwitchKey('anything.else')).toBe(false);
  });

  it('die externen Sendeaktionen existieren wirklich als Policy-Aktionen', () => {
    const known = new Set(Object.values(POLICY_ACTIONS) as string[]);
    for (const action of EXTERNAL_SEND_POLICY_ACTIONS) expect(known.has(action)).toBe(true);
  });
});

describe('tenantGateOf (Amendment 03 §6.2)', () => {
  it('ein aktiver Mandant ohne Sperre darf alles', () => {
    expect(tenantGateOf('ACTIVE', [])).toMatchObject({ loginAllowed: true, automationAllowed: true, connectorsAllowed: true });
  });

  it('die Sperrarten sind unterschieden: LOGIN, AUTOMATION, CONNECTORS, BILLING, SECURITY_QUARANTINE', () => {
    expect(tenantGateOf('ACTIVE', ['LOGIN'])).toMatchObject({ loginAllowed: false, automationAllowed: true, connectorsAllowed: true });
    expect(tenantGateOf('ACTIVE', ['AUTOMATION'])).toMatchObject({ loginAllowed: true, automationAllowed: false, connectorsAllowed: true });
    expect(tenantGateOf('ACTIVE', ['CONNECTORS'])).toMatchObject({ loginAllowed: true, automationAllowed: true, connectorsAllowed: false });
    expect(tenantGateOf('ACTIVE', ['BILLING'])).toMatchObject({ loginAllowed: true, automationAllowed: false, connectorsAllowed: true });
    expect(tenantGateOf('ACTIVE', ['SECURITY_QUARANTINE'])).toMatchObject({ loginAllowed: false, automationAllowed: false, connectorsAllowed: false });
  });

  it('jeder nicht aktive Lebenszyklus sperrt alles', () => {
    for (const status of ['PROVISIONING', 'SUSPENDED', 'OFFBOARDING', 'CLOSED']) expect(tenantGateOf(status, [])).toMatchObject({ loginAllowed: false, automationAllowed: false, connectorsAllowed: false });
  });

  it('die Wirkungsbeschreibung nennt konkret, was passiert, und das Bestätigungs-Token ist an genau diesen Zustand gebunden', () => {
    const target = { status: 'ACTIVE', scopes: ['CONNECTORS'], cohorts: [] as string[] };
    const effects = describeTenantTarget(target, 7);
    expect(effects.join(' ')).toContain('Verbindungsaktivität');
    const token = confirmationTokenFor('t1', target, effects);
    expect(token).toHaveLength(24);
    expect(confirmationTokenFor('t1', target, effects)).toBe(token);
    expect(confirmationTokenFor('t2', target, effects)).not.toBe(token);
    expect(confirmationTokenFor('t1', { ...target, scopes: ['LOGIN'] }, describeTenantTarget({ ...target, scopes: ['LOGIN'] }, 7))).not.toBe(token);
    expect(describeTenantTarget({ status: 'ACTIVE', scopes: [], cohorts: ['pilot'] }, 3).join(' ')).toContain('uneingeschränkt');
  });
});

describe('evaluateFlag (OCF-03/04)', () => {
  const flag = (overrides: Partial<FlagDefinition> = {}): FlagDefinition => ({
    key: 'feature.pilot',
    lifecycle: 'ACTIVE',
    defaultValue: false,
    environmentOverrides: [],
    cohortOverrides: [],
    tenantOverrides: [],
    ...overrides,
  });
  const ctx = (tenantId: string, cohorts: string[] = [], environment = 'production') => ({ tenantId, cohorts, environment });

  it('Standardwert ohne Override', () => {
    expect(evaluateFlag(flag(), ctx('t1'))).toEqual({ value: false, source: 'DEFAULT' });
  });

  it('OCF-03: Pilot-Kohorte – nur Zielmandanten sind aktiv', () => {
    const f = flag({ cohortOverrides: [{ cohort: 'pilot', value: true }] });
    expect(evaluateFlag(f, ctx('t1', ['pilot']))).toEqual({ value: true, source: 'COHORT' });
    expect(evaluateFlag(f, ctx('t2', []))).toEqual({ value: false, source: 'DEFAULT' });
    expect(evaluateFlag(f, ctx('t3', ['other']))).toEqual({ value: false, source: 'DEFAULT' });
  });

  it('OCF-04: Mandantenwechsel – ein Tenant-Override gilt nur für diesen Mandanten', () => {
    const f = flag({ tenantOverrides: [{ tenantId: 't1', value: true }] });
    expect(evaluateFlag(f, ctx('t1')).value).toBe(true);
    expect(evaluateFlag(f, ctx('t2')).value).toBe(false);
  });

  it('Rangfolge: Mandant > Kohorte > Umgebung > Standard', () => {
    const f = flag({ defaultValue: 'a', environmentOverrides: [{ environment: 'production', value: 'env' }], cohortOverrides: [{ cohort: 'pilot', value: 'cohort' }], tenantOverrides: [{ tenantId: 't1', value: 'tenant' }] });
    expect(evaluateFlag(f, ctx('t1', ['pilot']))).toEqual({ value: 'tenant', source: 'TENANT' });
    expect(evaluateFlag(f, ctx('t2', ['pilot']))).toEqual({ value: 'cohort', source: 'COHORT' });
    expect(evaluateFlag(f, ctx('t3'))).toEqual({ value: 'env', source: 'ENVIRONMENT' });
    expect(evaluateFlag(f, ctx('t3', [], 'staging'))).toEqual({ value: 'a', source: 'DEFAULT' });
  });

  it('prozentualer Rollout ist je Mandant stabil und verteilt sich über die Kohorte', () => {
    const f = flag({ cohortOverrides: [{ cohort: 'all', value: true, percent: 30 }] });
    const results = Array.from({ length: 300 }, (_, i) => evaluateFlag(f, ctx(`tenant-${i}`, ['all'])).value);
    const on = results.filter(Boolean).length;
    expect(on).toBeGreaterThan(50);
    expect(on).toBeLessThan(130);
    expect(evaluateFlag(f, ctx('tenant-7', ['all'])).value).toBe(evaluateFlag(f, ctx('tenant-7', ['all'])).value);
  });

  it('Änderung während des Rollouts (§29.5): wer bei 30 % aktiv war, bleibt es bei 60 % und 100 %; ein Rollout wächst nur, nichts flackert', () => {
    const tenantIds = Array.from({ length: 400 }, (_, i) => `tenant-${i}`);
    const activeAt = (percent: number) => new Set(tenantIds.filter((id) => evaluateFlag(flag({ cohortOverrides: [{ cohort: 'all', value: true, percent }] }), ctx(id, ['all'])).value === true));
    const [a30, a60, a100] = [activeAt(30), activeAt(60), activeAt(100)];
    for (const id of a30) expect(a60.has(id)).toBe(true);
    for (const id of a60) expect(a100.has(id)).toBe(true);
    expect(a30.size).toBeLessThan(a60.size);
    expect(a100.size).toBe(tenantIds.length);
    // Eine Änderung an anderer Stelle (Tenant-Override für einen einzigen Mandanten, neuer Standardwert) verändert niemand anderen.
    const changed = flag({ cohortOverrides: [{ cohort: 'all', value: true, percent: 30 }], tenantOverrides: [{ tenantId: 'tenant-1', value: true }] });
    for (const id of tenantIds.filter((t) => t !== 'tenant-1')) expect(evaluateFlag(changed, ctx(id, ['all'])).value).toBe(a30.has(id));
    // Ein Rückbau (60 % → 30 %) nimmt nur die zuletzt hinzugekommenen weg, die ursprünglichen 30 % bleiben unverändert.
    expect([...a30].every((id) => activeAt(30).has(id))).toBe(true);
  });

  it('abgelaufene, zurückgezogene und Entwurfs-Flags wirken nie weiter', () => {
    const overrides = { tenantOverrides: [{ tenantId: 't1', value: true }] };
    expect(evaluateFlag(flag({ ...overrides, expiresAt: new Date(Date.now() - 1000) }), ctx('t1'))).toEqual({ value: false, source: 'EXPIRED' });
    expect(evaluateFlag(flag({ ...overrides, lifecycle: 'EXPIRED' }), ctx('t1')).source).toBe('EXPIRED');
    expect(evaluateFlag(flag({ ...overrides, lifecycle: 'RETIRED' }), ctx('t1')).source).toBe('RETIRED');
    expect(evaluateFlag(flag({ ...overrides, lifecycle: 'DRAFT' }), ctx('t1')).source).toBe('DRAFT');
  });

  it('Sicherheitskontrollen sind als Flag-Schlüssel reserviert (Amendment 03 §14.3)', () => {
    expect(isReservedFlagKey('security.tenant_isolation')).toBe(true);
    expect(isReservedFlagKey('auth.mfa')).toBe(true);
    expect(isReservedFlagKey('feature.new_inbox')).toBe(false);
  });
});
