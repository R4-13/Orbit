import { describe, expect, it } from 'vitest';
import { AUTOMATION_PRESET_KEYS, detectAutomationLevel, presetModeFor } from './automation-presets';
import { DEFAULT_POLICY_CONFIG, POLICY_ACTIONS, type PolicyActionKey, type PolicyMode } from './policy';

const modesFor = (preset: (typeof AUTOMATION_PRESET_KEYS)[number]) =>
  Object.fromEntries((Object.values(POLICY_ACTIONS) as PolicyActionKey[]).map((action) => [action, presetModeFor(preset, action)])) as Record<string, PolicyMode>;

describe('Automatisierungsgrad', () => {
  it('„Vorsichtig“ entspricht exakt den Grundeinstellungen', () => {
    for (const action of Object.values(POLICY_ACTIONS)) expect(presetModeFor('CAUTIOUS', action)).toBe(DEFAULT_POLICY_CONFIG[action].mode);
  });

  it('keine Stufe lockert eine gesperrte Aktion über ihre feste Obergrenze', () => {
    for (const key of AUTOMATION_PRESET_KEYS) {
      for (const action of Object.values(POLICY_ACTIONS)) {
        const base = DEFAULT_POLICY_CONFIG[action];
        if (base.locked) expect(presetModeFor(key, action)).toBe(base.mode);
      }
    }
    expect(presetModeFor('HIGH', POLICY_ACTIONS.PAYMENT_EXECUTE)).toBe('DISABLED');
    expect(presetModeFor('HIGH', POLICY_ACTIONS.SUPPLIER_CREATE)).toBe('REQUIRE_APPROVAL');
  });

  it('die Stufen sind aufsteigend: jede lässt mindestens so viel selbstständig laufen wie die vorige', () => {
    const rank = (m: PolicyMode) => ['DISABLED', 'SUGGEST_ONLY', 'REQUIRE_APPROVAL', 'AUTONOMOUS'].indexOf(m);
    for (const action of Object.values(POLICY_ACTIONS)) {
      expect(rank(presetModeFor('BALANCED', action))).toBeGreaterThanOrEqual(rank(presetModeFor('CAUTIOUS', action)));
      expect(rank(presetModeFor('HIGH', action))).toBeGreaterThanOrEqual(rank(presetModeFor('BALANCED', action)));
    }
  });

  it('erkennt die Stufe aus den aktuellen Regeln; eine abweichende Regel ergibt „Individuell“', () => {
    for (const key of AUTOMATION_PRESET_KEYS) expect(detectAutomationLevel(modesFor(key))).toBe(key);
    expect(detectAutomationLevel({ ...modesFor('BALANCED'), [POLICY_ACTIONS.MEETING_CREATE]: 'DISABLED' })).toBe('CUSTOM');
  });

  it('unbekannte oder fehlende Regeln bleiben außen vor (ältere Mandanten ohne neue Aktionen)', () => {
    const partial = { ...modesFor('CAUTIOUS') };
    delete partial[POLICY_ACTIONS.PROCESS_PLAN];
    expect(detectAutomationLevel(partial)).toBe('CAUTIOUS');
    expect(detectAutomationLevel({ 'something.unknown': 'AUTONOMOUS', ...modesFor('CAUTIOUS') })).toBe('CAUTIOUS');
  });
});
