'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { EntityRef } from '@orbit/shared';

interface PreviewStore {
  preview: EntityRef | null;
  openPreview: (entity: EntityRef) => void;
  closePreview: () => void;
}

const PreviewContext = createContext<PreviewStore>({ preview: null, openPreview: () => undefined, closePreview: () => undefined });

/**
 * Genau ein Vorschaukontext (UI v2 §9.3): ein neuer ersetzt den alten nachvollziehbar – keine Drawer-in-Drawer-Kaskaden.
 */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<EntityRef | null>(null);
  const openPreview = useCallback((entity: EntityRef) => setPreview(entity), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const store = useMemo(() => ({ preview, openPreview, closePreview }), [preview, openPreview, closePreview]);
  return <PreviewContext.Provider value={store}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewStore {
  return useContext(PreviewContext);
}
