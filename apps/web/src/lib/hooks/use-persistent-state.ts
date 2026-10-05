'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth-context';

/**
 * Zustand einer Liste (Filter, Suche, Sortierung, Seite, Auswahl), der den Weg in ein Detail und zurück übersteht (UI v2 §9.4,
 * AC-12). Er liegt in der sessionStorage, ist je Mandant und Nutzer getrennt und fällt bei defektem Speicher auf den Anfangswert
 * zurück. Bewusst keine URL-Parameter: ein kopierter Link soll keine persönliche Filterung transportieren (§9.4).
 */
export function usePersistentState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void, () => void] {
  const { user } = useAuth();
  const storageKey = user ? `orbit.list.${user.tenantId}.${user.id}.${key}` : null;
  const initialRef = useRef(initial);
  const [value, setValue] = useState<T>(initial);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!storageKey || loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) setValue({ ...(initialRef.current as object), ...(JSON.parse(raw) as object) } as T);
    } catch {
      /* defekter oder nicht verfügbarer Speicher: Standardwerte */
    }
  }, [storageKey]);

  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
        if (storageKey) {
          try {
            window.sessionStorage.setItem(storageKey, JSON.stringify(resolved));
          } catch {
            /* ohne Speicher gilt der Zustand nur im Arbeitsspeicher */
          }
        }
        return resolved;
      });
    },
    [storageKey],
  );

  const reset = useCallback(() => update(initialRef.current), [update]);
  return [value, update, reset];
}
