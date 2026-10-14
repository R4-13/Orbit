import type { PageWindow } from '../hooks/use-paged-list';
import { Button } from './button';

/** Seitenwechsel unter einer Tabelle (UX-05). Bei nur einer Seite ist nichts zu sehen, damit kurze Listen unverändert bleiben. */
export function Pager({
  window,
  onPage,
  onShowAll,
  label = 'Einträge',
}: {
  window: PageWindow;
  onPage: (page: number) => void;
  onShowAll?: (showAll: boolean) => void;
  label?: string;
}) {
  if (window.pageCount <= 1 && !window.showingAll) return null;
  return (
    <nav
      className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-sm text-slate-600"
      aria-label={`Seiten der ${label}`}
    >
      <span aria-live="polite">
        {window.from}–{window.to} von {window.total} {label}
      </span>
      <span className="flex items-center gap-2">
        {onShowAll ? (
          <Button variant="ghost" onClick={() => onShowAll(!window.showingAll)}>
            {window.showingAll ? 'Seitenweise anzeigen' : `Alle ${window.total} anzeigen`}
          </Button>
        ) : null}
        {window.showingAll ? null : (
          <>
            <Button
              variant="secondary"
              disabled={window.page <= 1}
              onClick={() => onPage(window.page - 1)}
            >
              Zurück
            </Button>
            <span aria-hidden="true">
              Seite {window.page} / {window.pageCount}
            </span>
            <Button
              variant="secondary"
              disabled={window.page >= window.pageCount}
              onClick={() => onPage(window.page + 1)}
            >
              Weiter
            </Button>
          </>
        )}
      </span>
    </nav>
  );
}
