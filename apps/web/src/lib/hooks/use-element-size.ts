'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Misst den tatsächlich verfügbaren Platz eines Elements (UI v2 SHELL-04: gemessene Breite statt nur Viewport-Breakpoints).
 * Liefert `{0,0}` vor dem ersten Layout; der Aufrufer behandelt das als „noch unbekannt“ (kein Flackern durch Fehlentscheidung).
 */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, ElementSize] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const ref = useCallback((value: T | null) => setNode(value), []);

  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const style = window.getComputedStyle(node);
      const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      setSize((previous) => {
        const next = { width: Math.round(node.clientWidth - horizontal), height: Math.round(node.clientHeight - vertical) };
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [ref, size];
}

/** Viewport-Breite in CSS-Pixeln (0 vor dem Mount), reagiert auf Resize und Zoom. */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}
