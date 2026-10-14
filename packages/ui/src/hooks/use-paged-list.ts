import { useEffect, useState } from 'react';

export interface PageWindow {
  page: number;
  pageCount: number;
  /** Erste angezeigte Zeile (1-basiert); 0 bei leerer Liste. */
  from: number;
  /** Letzte angezeigte Zeile. */
  to: number;
  total: number;
}

/** Reiner Kern von `usePagedList`: der Ausschnitt einer Liste für eine Seite. Eine zu große Seitenzahl wird auf die letzte Seite zurückgesetzt. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): { rows: T[]; window: PageWindow } {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  const rows = items.slice(start, start + pageSize);
  return { rows, window: { page: current, pageCount, from: total === 0 ? 0 : start + 1, to: start + rows.length, total } };
}

/**
 * Seitenwechsel für eine Liste im Browser (UX-05): lange Listen werden seitenweise gezeigt statt als eine Tabelle mit Hunderten Zeilen. Sortierung und Filter
 * bleiben davor (`useSortableList`); ändert sich die Liste (Filter, neue Daten), beginnt die Anzeige wieder auf Seite 1.
 */
export function usePagedList<T>(items: T[] | undefined, pageSize = 25): { rows: T[] | undefined; window: PageWindow; setPage: (page: number) => void } {
  const [page, setPage] = useState(1);
  const length = items?.length ?? 0;
  const first = items?.[0];
  // Bei geänderter Liste (andere Länge oder anderer erster Eintrag, z. B. nach Sortierung oder Filter) zurück auf Seite 1.
  useEffect(() => setPage(1), [length, first, pageSize]);
  const sliced = pageSlice(items ?? [], page, pageSize);
  return { rows: items ? sliced.rows : undefined, window: sliced.window, setPage };
}
