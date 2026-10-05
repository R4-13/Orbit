import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, UI_PREFERENCES_VERSION, parsePreferences, preferencesKey, serializePreferences } from './ui-preferences-model';

describe('ui preferences', () => {
  it('scopes the storage key by tenant and user so a tenant switch never inherits foreign settings (AC-18)', () => {
    expect(preferencesKey('t1', 'u1')).not.toBe(preferencesKey('t2', 'u1'));
    expect(preferencesKey('t1', 'u1')).not.toBe(preferencesKey('t1', 'u2'));
  });

  it('falls back to the defaults for empty, broken, foreign or outdated data', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{not json')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('[]')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(JSON.stringify({ layoutVersion: UI_PREFERENCES_VERSION + 1, navMode: 'rail' }))).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid settings and repairs invalid parts individually', () => {
    const parsed = parsePreferences(
      JSON.stringify({
        layoutVersion: UI_PREFERENCES_VERSION,
        navMode: 'rail',
        sondeOpen: false,
        sondeWidth: 9999,
        home: { period: 'WEEK', view: 'EVERYONE', domainOrder: ['sales', 'finance'], hidden: ['tasks', 'nonsense', 'tasks'] },
      }),
    );
    expect(parsed.navMode).toBe('rail');
    expect(parsed.sondeOpen).toBe(false);
    expect(parsed.sondeWidth).toBe(480);
    expect(parsed.home).toEqual({ period: 'WEEK', view: 'MINE', domainOrder: ['sales', 'finance'], hidden: ['tasks'] });
  });

  it('round-trips', () => {
    const custom = { ...DEFAULT_PREFERENCES, navMode: 'rail' as const, sondeOpen: true, home: { ...DEFAULT_PREFERENCES.home, hidden: ['sales' as const] } };
    expect(parsePreferences(serializePreferences(custom))).toEqual(custom);
  });
});
