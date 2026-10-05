'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { MAX_SAVED_VIEWS, MAX_VIEW_NAME_LENGTH, parseSavedViews, removeView, savedViewsKey, upsertView, type SavedView } from '../../lib/saved-views';

/**
 * „Ansichten“ einer Liste (UI v2 §20.1): den aktuellen Filter/Suchbegriff unter einem Namen merken, später anwenden oder löschen –
 * und jederzeit „Standard wiederherstellen“. Gespeichert wird je Mandant, Nutzer und Liste im Browser des Geräts.
 */
export function SavedViewsMenu<T extends object>({ listKey, current, onApply, onReset }: { listKey: string; current: T; onApply: (state: T) => void; onReset: () => void }) {
  const { user } = useAuth();
  const key = user ? savedViewsKey(user.tenantId, user.id, listKey) : null;
  const [views, setViews] = useState<Array<SavedView<T>>>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [alignRight, setAlignRight] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameId = useId();

  useEffect(() => {
    if (!key) return;
    try {
      setViews(parseSavedViews<T>(window.localStorage.getItem(key)));
    } catch {
      setViews([]);
    }
  }, [key]);

  const persist = useCallback(
    (next: Array<SavedView<T>>) => {
      setViews(next);
      if (!key) return;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ohne Speicher gilt die Ansicht nur bis zum Neuladen */
      }
    },
    [key],
  );

  // Das Menü öffnet zur Seite mit Platz: sitzt der Knopf links in der Werkzeugzeile, würde ein rechtsbündiges Menü unter die Navigation ragen.
  // Gemessen wird nach dem Rendern am Menü selbst, nicht beim Klick – das Layout kann sich dazwischen noch ändern.
  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    const mainLeft = document.querySelector('[data-shell-main]')?.getBoundingClientRect().left ?? 0;
    const rect = popoverRef.current.getBoundingClientRect();
    if (alignRight && rect.left < mainLeft + 8) setAlignRight(false);
    else if (!alignRight && rect.right > window.innerWidth - 8) setAlignRight(true);
  }, [open, alignRight]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open} aria-haspopup="dialog" className="flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
        <Bookmark size={14} aria-hidden="true" /> Ansichten{views.length > 0 ? ` (${views.length})` : ''}
      </button>
      {open ? (
        <div ref={popoverRef} role="dialog" aria-label="Persönliche Ansichten" className={`absolute top-10 z-30 w-72 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg ${alignRight ? 'right-0' : 'left-0'}`}>
          {views.length > 0 ? (
            <ul className="mb-3 space-y-1">
              {views.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(view.state);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left font-medium text-slate-900 hover:bg-slate-100"
                  >
                    {view.name}
                  </button>
                  <button type="button" onClick={() => persist(removeView(views, view.id))} aria-label={`Ansicht „${view.name}“ löschen`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-red-50 hover:text-red-700">
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-slate-700">Noch keine gespeicherte Ansicht.</p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              persist(upsertView(views, name, current, () => crypto.randomUUID()));
              setName('');
            }}
            className="space-y-2 border-t border-slate-100 pt-3"
          >
            <label htmlFor={nameId} className="block font-medium text-slate-900">
              Aktuelle Ansicht speichern als
            </label>
            <input id={nameId} value={name} maxLength={MAX_VIEW_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="z. B. Dringende Rechnungen" className="h-9 w-full rounded-md border border-slate-300 px-2 text-slate-900 placeholder:text-slate-600" />
            <div className="flex items-center justify-between">
              <button type="submit" disabled={!name.trim() || (views.length >= MAX_SAVED_VIEWS && !views.some((view) => view.name.toLowerCase() === name.trim().toLowerCase()))} className="h-9 rounded-md bg-brand px-3 font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50">
                Speichern
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className="text-sm font-medium text-brand hover:underline"
              >
                Standard wiederherstellen
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
