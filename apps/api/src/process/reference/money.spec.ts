import { computeTotals, formatEuro, fromCents, lineFor, toCents, unitPriceCentsFor } from './money';

describe('money (integer cents)', () => {
  it('converts without floating point drift', () => {
    expect(toCents('19.99')).toBe(1999);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('1234')).toBe(123400);
    expect(fromCents(1999)).toBe('19.99');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(-250)).toBe('-2.50');
    expect(() => toCents('12.345')).toThrow();
    expect(() => toCents('abc')).toThrow();
  });

  it('formats German euro amounts', () => {
    expect(formatEuro(123456789)).toBe('1.234.567,89 €');
    expect(formatEuro(5)).toBe('0,05 €');
  });

  it('picks the highest matching price tier', () => {
    const tiers = [
      { minQuantity: 10, unitPrice: '95.00' },
      { minQuantity: 50, unitPrice: '90.00' },
    ];
    expect(unitPriceCentsFor('100.00', tiers, 3)).toBe(10000);
    expect(unitPriceCentsFor('100.00', tiers, 10)).toBe(9500);
    expect(unitPriceCentsFor('100.00', tiers, 75)).toBe(9000);
    expect(unitPriceCentsFor('100.00', null, 75)).toBe(10000);
  });

  it('computes net, tax and gross deterministically per tax rate', () => {
    const lines = [lineFor({ sku: 'A', name: 'A', unit: 'Stk', unitPrice: '33.33', taxRate: 19 }, 3), lineFor({ sku: 'B', name: 'B', unit: 'h', unitPrice: '10.00', taxRate: 7 }, 1.5)];
    expect(lines[0]!.netCents).toBe(9999);
    expect(lines[1]!.netCents).toBe(1500);
    expect(computeTotals(lines)).toEqual({ netCents: 11499, taxCents: Math.round(9999 * 0.19) + Math.round(1500 * 0.07), grossCents: 11499 + Math.round(9999 * 0.19) + Math.round(1500 * 0.07) });
  });
});
