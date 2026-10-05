/**
 * UI v2 §20.1: Filter, Sortierung und Auswahl einer Liste als benannte persönliche Ansicht. Reine Funktionen für Lesen, Schreiben und
 * Validierung – gespeichert wird je Mandant, Nutzer und Liste; ungültige Einträge werden beim Laden verworfen (§20.3).
 */

export interface SavedView<T> {
  id: string;
  name: string;
  state: T;
}

export const MAX_SAVED_VIEWS = 10;
export const MAX_VIEW_NAME_LENGTH = 40;

export function savedViewsKey(tenantId: string, userId: string, listKey: string): string {
  return `orbit.views.v1.${tenantId}.${userId}.${listKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSavedViews<T>(raw: string | null): Array<SavedView<T>> {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const views: Array<SavedView<T>> = [];
    for (const entry of value) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string' || !isRecord(entry.state)) continue;
      views.push({ id: entry.id, name: entry.name.slice(0, MAX_VIEW_NAME_LENGTH), state: entry.state as T });
    }
    return views.slice(0, MAX_SAVED_VIEWS);
  } catch {
    return [];
  }
}

/** Fügt eine Ansicht hinzu oder ersetzt eine gleichnamige (Groß-/Kleinschreibung egal); leere Namen sind ungültig. */
export function upsertView<T>(views: Array<SavedView<T>>, name: string, state: T, newId: () => string): Array<SavedView<T>> {
  const trimmed = name.trim().slice(0, MAX_VIEW_NAME_LENGTH);
  if (!trimmed) return views;
  const existing = views.find((view) => view.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return views.map((view) => (view.id === existing.id ? { ...view, name: trimmed, state } : view));
  return [...views, { id: newId(), name: trimmed, state }].slice(-MAX_SAVED_VIEWS);
}

export function removeView<T>(views: Array<SavedView<T>>, id: string): Array<SavedView<T>> {
  return views.filter((view) => view.id !== id);
}
