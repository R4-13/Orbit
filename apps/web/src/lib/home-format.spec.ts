import { describe, expect, it } from 'vitest';
import { describeKpi, formatDue, formatMetricValue, formatMinutes } from './home-format';

describe('KPI contract (UI v2 §7)', () => {
  it('shows an unsupported or unauthorised metric as "–", never as 0', () => {
    expect(formatMetricValue({ key: 'approvalsOpen', value: null, basis: 'CURRENT', definitionKey: 'x' })).toBe('–');
    expect(formatMetricValue(undefined)).toBe('–');
    expect(formatMetricValue({ key: 'approvalsOpen', value: 0, basis: 'CURRENT', definitionKey: 'x' })).toBe('0');
  });

  it('formats the estimated time saving in hours and minutes', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(95)).toBe('1 h 35 min');
  });

  it('labels the time basis under each value: period metrics name the period, stock metrics say "aktuell"', () => {
    expect(describeKpi('approvalsOpen', 'WEEK').basisLabel).toBe('aktuell');
    expect(describeKpi('processed', 'TODAY').basisLabel).toBe('heute');
    expect(describeKpi('processed', 'WEEK').basisLabel).toBe('diese Woche');
    expect(describeKpi('timeSaved', 'TODAY').basisLabel).toMatch(/Schätzung/);
  });

  it('links every KPI to an internal list', () => {
    for (const key of ['processed', 'automated', 'approvalsOpen', 'problems', 'timeSaved'] as const) {
      expect(describeKpi(key, 'TODAY').href).toMatch(/^\//);
    }
  });
});

describe('formatDue', () => {
  const now = new Date(2026, 9, 5, 12, 0);
  it('separates overdue, today and later', () => {
    expect(formatDue(new Date(2026, 9, 3, 9, 0), now)).toBe('überfällig seit 03.10.');
    expect(formatDue(new Date(2026, 9, 5, 16, 0), now)).toBe('heute fällig');
    expect(formatDue(new Date(2026, 9, 8, 9, 0), now)).toBe('fällig 08.10.');
  });
});
