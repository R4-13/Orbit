import { describe, expect, it } from 'vitest';
import { PASSWORD_HISTORY_MAX, nextPasswordHistory, passwordExpired } from './password-policy';

const day = 24 * 3_600_000;
const now = new Date('2026-10-16T12:00:00Z');

describe('Passwortablauf', () => {
  it('ist ausgeschaltet bei 0 oder weniger Tagen', () => {
    expect(passwordExpired(new Date(now.getTime() - 1000 * day), new Date(0), 0, now)).toBe(false);
    expect(passwordExpired(null, new Date(0), -5, now)).toBe(false);
  });
  it('läuft nach der festgelegten Zahl von Tagen ab, gerechnet ab der letzten Änderung', () => {
    expect(passwordExpired(new Date(now.getTime() - 89 * day), new Date(0), 90, now)).toBe(false);
    expect(passwordExpired(new Date(now.getTime() - 91 * day), new Date(0), 90, now)).toBe(true);
  });
  it('zählt ab der Anlage, wenn das Passwort nie geändert wurde', () => {
    expect(passwordExpired(null, new Date(now.getTime() - 10 * day), 90, now)).toBe(false);
    expect(passwordExpired(null, new Date(now.getTime() - 200 * day), 90, now)).toBe(true);
  });
});

describe('Passwortverlauf', () => {
  it('merkt die letzten N Passwörter, das älteste fällt zuerst heraus', () => {
    expect(nextPasswordHistory([], 'a', 3)).toEqual(['a']);
    expect(nextPasswordHistory(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
  it('merkt nichts bei 0 und nie mehr als die Obergrenze', () => {
    expect(nextPasswordHistory(['a'], 'b', 0)).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => `h${i}`);
    expect(nextPasswordHistory(many, 'neu', 100)).toHaveLength(PASSWORD_HISTORY_MAX);
  });
});
