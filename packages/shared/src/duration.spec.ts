import { describe, expect, it } from 'vitest';
import { parseDurationToMs } from './duration';

describe('parseDurationToMs', () => {
  it.each([
    ['15m', 15 * 60 * 1000],
    ['7d', 7 * 24 * 60 * 60 * 1000],
    ['30s', 30 * 1000],
    ['500ms', 500],
    ['1h', 60 * 60 * 1000],
  ])('parses "%s" as %i ms', (input, expected) => {
    expect(parseDurationToMs(input)).toBe(expected);
  });

  it('is case-insensitive on the unit and tolerates surrounding whitespace', () => {
    expect(parseDurationToMs(' 2H ')).toBe(2 * 60 * 60 * 1000);
  });

  it('rejects strings without a recognized unit', () => {
    expect(() => parseDurationToMs('15')).toThrow(/Invalid duration/);
    expect(() => parseDurationToMs('15 weeks')).toThrow(/Invalid duration/);
    expect(() => parseDurationToMs('')).toThrow(/Invalid duration/);
  });
});
