'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useGlobalSearch, type SearchResult } from '../../lib/hooks/use-global-search';
import { statusLabel } from '../../lib/status-labels';

const TYPE_LABELS: Record<string, string> = {
  CASE: 'Vorgang',
  INVOICE: 'Rechnung',
  CONTACT: 'Kontakt',
  COMPANY: 'Unternehmen',
  TASK: 'Aufgabe',
  LEAD: 'Interessent',
  APPROVAL: 'Freigabe',
};

/**
 * UI v2 §5.3 — die globale Suche findet berechtigte Vorgänge, Rechnungen, Kontakte und Aufgaben: Typ, verständlicher Titel,
 * Status und eine direkte Route. Sie ergänzt die sichtbare Navigation, ersetzt sie nicht; Tastaturbedienung per Pfeiltasten.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { data: results, isFetching, isError } = useGlobalSearch(query);
  const hasQuery = query.trim().length >= 2;

  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  function choose(result: SearchResult) {
    setOpen(false);
    setQuery('');
    router.push(result.href);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <label htmlFor={`${listId}-input`} className="sr-only">
        In ORBIT suchen
      </label>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={open && hasQuery}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
          } else if (event.key === 'ArrowDown' && results && results.length > 0) {
            event.preventDefault();
            setActive((index) => Math.min(results.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter' && results && results[active]) {
            event.preventDefault();
            choose(results[active]);
          }
        }}
        placeholder="Vorgänge, Rechnungen, Kontakte suchen …"
        className="h-10 w-full rounded-md border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand"
      />
      {open && hasQuery ? (
        <ul id={listId} role="listbox" aria-label="Suchergebnisse" className="absolute left-0 right-0 top-11 z-50 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {isError ? (
            <li className="px-3 py-3 text-sm text-red-700">Die Suche ist gerade nicht erreichbar. Bitte versuchen Sie es erneut.</li>
          ) : isFetching && !results ? (
            <li className="px-3 py-3 text-sm text-slate-500">Suche läuft …</li>
          ) : results && results.length > 0 ? (
            results.map((result, index) => (
              <li key={`${result.type}-${result.id}`} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onClick={() => choose(result)}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${index === active ? 'bg-slate-100' : ''}`}
                >
                  <span className="w-20 shrink-0 text-xs font-medium text-slate-500">{TYPE_LABELS[result.type] ?? result.type}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{result.title}</span>
                    {result.subtitle ? <span className="block truncate text-xs text-slate-500">{result.subtitle}</span> : null}
                  </span>
                  {result.statusLabel ? <span className="shrink-0 text-xs text-slate-600">{statusLabel(result.statusLabel).label}</span> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-3 text-sm text-slate-600">Keine Treffer für „{query.trim()}“.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
