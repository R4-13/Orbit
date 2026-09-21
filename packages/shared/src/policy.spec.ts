import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_CONFIG, POLICY_ACTIONS } from './policy';

describe('DEFAULT_POLICY_CONFIG', () => {
  it('hard-disables PAYMENT_EXECUTE and locks it against relaxation (MVP non-goal)', () => {
    const config = DEFAULT_POLICY_CONFIG[POLICY_ACTIONS.PAYMENT_EXECUTE];
    expect(config.mode).toBe('DISABLED');
    expect(config.locked).toBe(true);
  });

  it('locks supplier bank-detail changes and supplier creation to REQUIRE_APPROVAL', () => {
    expect(DEFAULT_POLICY_CONFIG[POLICY_ACTIONS.SUPPLIER_BANK_DETAILS_CHANGE]).toEqual({
      mode: 'REQUIRE_APPROVAL',
      locked: true,
    });
    expect(DEFAULT_POLICY_CONFIG[POLICY_ACTIONS.SUPPLIER_CREATE]).toEqual({
      mode: 'REQUIRE_APPROVAL',
      locked: true,
    });
  });

  it('has exactly one default entry per declared policy action', () => {
    const actionKeys = Object.values(POLICY_ACTIONS);
    expect(Object.keys(DEFAULT_POLICY_CONFIG)).toHaveLength(actionKeys.length);
    for (const action of actionKeys) {
      expect(DEFAULT_POLICY_CONFIG[action]).toBeDefined();
    }
  });
});
