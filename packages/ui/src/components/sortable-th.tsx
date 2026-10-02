import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';
import type { SortDirection, SortState } from '../hooks/use-sortable-list';

// `ComponentPropsWithoutRef<'th'>` (JSX-intrinsic-element inference) instead
// of `ThHTMLAttributes<HTMLTableCellElement>`: this package's tsconfig has no
// "DOM" lib (packages/ui/tsconfig.json -> tsconfig.base.json), so the bare
// global `HTMLTableCellElement` name doesn't resolve there, even though
// other components here reference similarly-named globals that happen to
// ship as part of @types/react's own ambient declarations.
export interface SortableThProps<K extends string> extends Omit<ComponentPropsWithoutRef<'th'>, 'onClick'> {
  label: string;
  sortKey: K;
  sort: SortState<K> | null;
  onSort: (key: K) => void;
}

function SortIcon({ direction }: { direction: SortDirection | null }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="shrink-0" aria-hidden="true">
      <path
        d="M5 0L9 4.5H1L5 0Z"
        className={direction === 'asc' ? 'fill-slate-600' : 'fill-slate-300'}
      />
      <path
        d="M5 12L1 7.5H9L5 12Z"
        className={direction === 'desc' ? 'fill-slate-600' : 'fill-slate-300'}
      />
    </svg>
  );
}

/** A `<th>` that's also a sort toggle — three-state per column (asc → desc → unsorted) via `useSortableList`. */
export function SortableTh<K extends string>({ label, sortKey, sort, onSort, className, ...props }: SortableThProps<K>) {
  const direction = sort?.key === sortKey ? sort.direction : null;
  return (
    <th className={cn('px-4 py-3 font-medium', className)} {...props}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-slate-700"
        aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      >
        {label}
        <SortIcon direction={direction} />
      </button>
    </th>
  );
}
