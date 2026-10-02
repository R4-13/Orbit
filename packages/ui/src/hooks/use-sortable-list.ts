import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export type SortAccessor<T> = (item: T) => string | number | null | undefined;

/** Only ever called with two non-null values — null-ordering is handled separately in `sortItems` so it stays direction-independent (see there). */
function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'de', { numeric: true });
}

/**
 * Pure sort step behind `useSortableList` — split out so it's testable
 * without a React/DOM environment (packages/ui has no jsdom setup, and
 * adding one just for this one hook would be disproportionate). `accessors`
 * maps each sortable column key to a function that extracts a plain,
 * already-normalized `string | number` from a row — e.g. `Number(invoice.amountGross)`
 * for a Prisma Decimal (serialized as a JSON string over HTTP), or an ISO
 * date string (sorts correctly as plain text, no Date parsing needed).
 * `null`/`undefined` values always sort last, regardless of direction.
 */
export function sortItems<T, K extends string>(
  items: readonly T[],
  accessors: Record<K, SortAccessor<T>>,
  sort: SortState<K> | null,
): T[] {
  if (!sort) return [...items];
  const accessor = accessors[sort.key];
  const copy = [...items];
  copy.sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    // Null-ordering decided before the direction flip below, so nulls land
    // last in BOTH ascending and descending order, not first when descending.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = compareValues(av, bv);
    return sort.direction === 'asc' ? cmp : -cmp;
  });
  return copy;
}

/** The next sort state after clicking a column header — three-state per column (asc → desc → unsorted). */
export function nextSortState<K extends string>(current: SortState<K> | null, key: K): SortState<K> | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

/** Click-to-sort for a plain client-side array, paired with `SortableTh`. See `sortItems`/`nextSortState` for the underlying pure logic. */
export function useSortableList<T, K extends string>(
  items: T[] | undefined,
  accessors: Record<K, SortAccessor<T>>,
): { sorted: T[] | undefined; sort: SortState<K> | null; requestSort: (key: K) => void } {
  const [sort, setSort] = useState<SortState<K> | null>(null);

  const sorted = useMemo(
    () => (items ? sortItems(items, accessors, sort) : items),
    // `accessors` deliberately excluded: call sites pass a fresh object literal
    // every render, so including it would re-sort on every render instead of
    // only when the data or the requested sort actually changes.
    [items, sort],
  );

  function requestSort(key: K): void {
    setSort((prev) => nextSortState(prev, key));
  }

  return { sorted, sort, requestSort };
}
