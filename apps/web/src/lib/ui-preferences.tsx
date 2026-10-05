'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import {
  DEFAULT_HOME_PREFERENCES,
  DEFAULT_PREFERENCES,
  parsePreferences,
  preferencesKey,
  serializePreferences,
  type HomePreferences,
  type UiPreferences,
} from './ui-preferences-model';

interface PreferencesStore {
  preferences: UiPreferences;
  /** True, sobald die gespeicherten Einstellungen gelesen wurden (vorher gilt der Standard, ohne etwas zu persistieren). */
  loaded: boolean;
  update: (patch: Partial<Omit<UiPreferences, 'home' | 'layoutVersion'>>) => void;
  updateHome: (patch: Partial<HomePreferences>) => void;
  resetHome: () => void;
}

const noop = () => undefined;
const PreferencesContext = createContext<PreferencesStore>({ preferences: DEFAULT_PREFERENCES, loaded: false, update: noop, updateHome: noop, resetHome: noop });

/**
 * Persönliche Ansichtseinstellungen (UI v2 §20): je Mandant und Nutzer in einem eigenen Schlüssel. Gerätebezogene Dock- und
 * Breitenwahl liegen lokal; ein Mandantenwechsel liest einen anderen Schlüssel und übernimmt nie fremde Einstellungen.
 * Der Speicher kann fehlen (privates Fenster, gesperrt) – dann gilt der Standard, ohne dass die Seite bricht.
 */
export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const key = user ? preferencesKey(user.tenantId, user.id) : null;
  const [preferences, setPreferences] = useState<UiPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!key) {
      setPreferences(DEFAULT_PREFERENCES);
      setLoaded(false);
      return;
    }
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = null;
    }
    setPreferences(parsePreferences(raw));
    setLoaded(true);
  }, [key]);

  const persist = useCallback(
    (next: UiPreferences) => {
      setPreferences(next);
      if (!key) return;
      try {
        window.localStorage.setItem(key, serializePreferences(next));
      } catch {
        /* Speicher nicht verfügbar: Einstellung gilt nur für diese Sitzung. */
      }
    },
    [key],
  );

  const update = useCallback<PreferencesStore['update']>((patch) => persist({ ...preferences, ...patch }), [persist, preferences]);
  const updateHome = useCallback<PreferencesStore['updateHome']>((patch) => persist({ ...preferences, home: { ...preferences.home, ...patch } }), [persist, preferences]);
  const resetHome = useCallback(() => persist({ ...preferences, home: DEFAULT_HOME_PREFERENCES }), [persist, preferences]);

  const store = useMemo(() => ({ preferences, loaded, update, updateHome, resetHome }), [preferences, loaded, update, updateHome, resetHome]);
  return <PreferencesContext.Provider value={store}>{children}</PreferencesContext.Provider>;
}

export function useUiPreferences(): PreferencesStore {
  return useContext(PreferencesContext);
}
