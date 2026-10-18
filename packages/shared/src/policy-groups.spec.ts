import { describe, expect, it } from 'vitest';
import { AUTOMATION_PRESET_KEYS, presetModeFor } from './automation-presets';
import { DEFAULT_POLICY_CONFIG, POLICY_ACTIONS, type PolicyActionKey, type PolicyMode } from './policy';
import {
  POLICY_GROUPS,
  POLICY_GROUP_KEYS,
  UNGROUPED_DEFAULT_MODE,
  actionClassOf,
  applyGroupMode,
  checkNeverLooser,
  groupModeOf,
  placementOf,
} from './policy-groups';

const ALL = Object.values(POLICY_ACTIONS) as PolicyActionKey[];

describe('Regel-Gruppen: nur Darstellung über den Policy-Aktionen', () => {
  it('jede bekannte Policy-Aktion ist bewusst zugeordnet (Gruppe, Technik oder Autonomiegrad) und höchstens in einer Gruppe', () => {
    const seen = new Map<string, number>();
    for (const key of POLICY_GROUP_KEYS) for (const action of POLICY_GROUPS[key].actions) seen.set(action, (seen.get(action) ?? 0) + 1);
    for (const [action, count] of seen) expect({ action, count }).toEqual({ action, count: 1 });
    // Eine neue Aktion darf nicht stillschweigend „ohne Platz“ bleiben: dieser Test zwingt zur bewussten Einordnung.
    expect(ALL.filter((a) => placementOf(a).kind === 'UNGROUPED')).toEqual([]);
  });

  it('eine unbekannte (neue) Fähigkeit fällt auf die sichtbare Standardregel „Freigabe“, nie auf „erlaubt“', () => {
    expect(placementOf('invoice.archive.new_capability')).toEqual({ kind: 'UNGROUPED' });
    expect(UNGROUPED_DEFAULT_MODE).toBe('REQUIRE_APPROVAL');
  });

  it('die Gruppe zeigt den strengsten Modus; abweichende Einzelregeln bleiben sichtbar', () => {
    const modes: Record<string, PolicyMode> = {
      [POLICY_ACTIONS.MEETING_PROPOSE]: 'AUTONOMOUS',
      [POLICY_ACTIONS.MEETING_CREATE]: 'REQUIRE_APPROVAL',
      [POLICY_ACTIONS.BOOKING_PROPOSAL_CREATE]: 'AUTONOMOUS',
    };
    const result = groupModeOf('APPOINTMENTS', modes);
    expect(result.mode).toBe('REQUIRE_APPROVAL');
    expect(result.uniform).toBe(false);
    expect(result.deviations.map((d) => d.action).sort()).toEqual([POLICY_ACTIONS.BOOKING_PROPOSAL_CREATE, POLICY_ACTIONS.MEETING_PROPOSE].sort());
  });

  it('Lieferanten bleiben unabhängig vom Autonomiegrad bei einem Menschen: feste Obergrenze', () => {
    for (const preset of AUTOMATION_PRESET_KEYS) {
      for (const action of POLICY_GROUPS.SUPPLIERS.actions) expect(presetModeFor(preset, action)).toBe('REQUIRE_APPROVAL');
    }
    const forced = applyGroupMode('SUPPLIERS', 'AUTONOMOUS', {});
    expect(forced[POLICY_ACTIONS.SUPPLIER_CREATE]).toBe('REQUIRE_APPROVAL');
    expect(forced[POLICY_ACTIONS.SUPPLIER_BANK_DETAILS_CHANGE]).toBe('REQUIRE_APPROVAL');
  });
});

describe('Aktionsklassen (gesperrt · nach Freigabe · autonom)', () => {
  it('Zahlung ausführen ist gesperrt – auch wenn jemand AUTONOMOUS oder REQUIRE_APPROVAL einträgt', () => {
    expect(actionClassOf(POLICY_ACTIONS.PAYMENT_EXECUTE, 'DISABLED')).toBe('BLOCKED');
    expect(actionClassOf(POLICY_ACTIONS.PAYMENT_EXECUTE, 'REQUIRE_APPROVAL')).toBe('BLOCKED');
    expect(actionClassOf(POLICY_ACTIONS.PAYMENT_EXECUTE, 'AUTONOMOUS')).toBe('BLOCKED');
  });

  it('Freigabe- und Vorschlag-Modi sind „nach Freigabe“, AUTONOMOUS ist „autonom“, DISABLED ist gesperrt', () => {
    expect(actionClassOf(POLICY_ACTIONS.EMAIL_SEND_INFORMATION, 'REQUIRE_APPROVAL')).toBe('AFTER_APPROVAL');
    expect(actionClassOf(POLICY_ACTIONS.EMAIL_SEND_INFORMATION, 'SUGGEST_ONLY')).toBe('AFTER_APPROVAL');
    expect(actionClassOf(POLICY_ACTIONS.EMAIL_SEND_INFORMATION, 'AUTONOMOUS')).toBe('AUTONOMOUS');
    expect(actionClassOf(POLICY_ACTIONS.EMAIL_SEND_INFORMATION, 'DISABLED')).toBe('BLOCKED');
  });

  it('eine unbekannte (neue) Aktion bricht die Einordnung nicht ab und wird nach ihrem Modus eingeordnet', () => {
    expect(actionClassOf('neue.faehigkeit.test', 'AUTONOMOUS')).toBe('AUTONOMOUS');
    expect(actionClassOf('neue.faehigkeit.test', 'REQUIRE_APPROVAL')).toBe('AFTER_APPROVAL');
    expect(actionClassOf('neue.faehigkeit.test', 'DISABLED')).toBe('BLOCKED');
  });

  it('geänderte Bankverbindung ist nach Freigabe ausführbar, nie autonom (feste Obergrenze)', () => {
    expect(DEFAULT_POLICY_CONFIG[POLICY_ACTIONS.SUPPLIER_BANK_DETAILS_CHANGE].locked).toBe(true);
    expect(actionClassOf(POLICY_ACTIONS.SUPPLIER_BANK_DETAILS_CHANGE, 'REQUIRE_APPROVAL')).toBe('AFTER_APPROVAL');
  });
});

describe('Migration der Einzelregeln: nie lockerer als der Bestand (AD-01)', () => {
  const baseline = (): Record<string, PolicyMode> => Object.fromEntries(ALL.map((a) => [a, DEFAULT_POLICY_CONFIG[a].mode]));

  it('die Darstellung als Gruppenwert und zurück macht keine Aktion lockerer, auch bei gemischten Einzelregeln', () => {
    for (const preset of AUTOMATION_PRESET_KEYS) {
      const before = Object.fromEntries(ALL.map((a) => [a, presetModeFor(preset, a)])) as Record<string, PolicyMode>;
      // Individuelle Abweichung: eine Aktion einer Gruppe ist strenger als die übrigen.
      before[POLICY_ACTIONS.MEETING_CREATE] = 'REQUIRE_APPROVAL';
      let after = { ...before };
      for (const group of POLICY_GROUP_KEYS) after = applyGroupMode(group, groupModeOf(group, before).mode, after);
      expect(checkNeverLooser(before, after)).toEqual({ neverLooser: true, loosened: [] });
    }
  });

  it('erkennt eine Lockerung', () => {
    const before = baseline();
    const after = { ...before, [POLICY_ACTIONS.EMAIL_SEND_INFORMATION]: 'AUTONOMOUS' as PolicyMode };
    const check = checkNeverLooser(before, after);
    expect(check.neverLooser).toBe(false);
    expect(check.loosened).toEqual([{ action: POLICY_ACTIONS.EMAIL_SEND_INFORMATION, before: 'REQUIRE_APPROVAL', after: 'AUTONOMOUS' }]);
  });
});
