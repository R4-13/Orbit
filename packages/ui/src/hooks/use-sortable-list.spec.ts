import { describe, expect, it } from 'vitest';
import { nextSortState, sortItems } from './use-sortable-list';

interface Row {
  id: string;
  name: string;
  amount: number | null;
}

const rows: Row[] = [
  { id: 'a', name: 'Bravo', amount: 20 },
  { id: 'b', name: 'alpha', amount: null },
  { id: 'c', name: 'Charlie', amount: 5 },
];

const accessors = {
  name: (r: Row) => r.name,
  amount: (r: Row) => r.amount,
};

describe('sortItems', () => {
  it('returns a copy, not the original array', () => {
    const result = sortItems(rows, accessors, null);
    expect(result).not.toBe(rows);
    expect(result).toEqual(rows);
  });

  it('sorts strings case-insensitively via localeCompare', () => {
    const result = sortItems(rows, accessors, { key: 'name', direction: 'asc' });
    expect(result.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('reverses order for descending direction', () => {
    const result = sortItems(rows, accessors, { key: 'name', direction: 'desc' });
    expect(result.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts numbers numerically, nulls always last regardless of direction', () => {
    const asc = sortItems(rows, accessors, { key: 'amount', direction: 'asc' });
    expect(asc.map((r) => r.id)).toEqual(['c', 'a', 'b']);

    const desc = sortItems(rows, accessors, { key: 'amount', direction: 'desc' });
    expect(desc.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('nextSortState', () => {
  it('starts a new column at ascending', () => {
    expect(nextSortState(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSortState({ key: 'amount', direction: 'desc' }, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });

  it('cycles the same column asc -> desc -> unsorted', () => {
    expect(nextSortState({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSortState({ key: 'name', direction: 'desc' }, 'name')).toBeNull();
  });
});
