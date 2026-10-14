import { describe, expect, it } from 'vitest';
import { pageSlice } from './use-paged-list';

const items = Array.from({ length: 53 }, (_, i) => i + 1);

describe('pageSlice (UX-05)', () => {
  it('liefert den Ausschnitt und die Anzeige „von–bis von gesamt“', () => {
    const first = pageSlice(items, 1, 25);
    expect(first.rows).toHaveLength(25);
    expect(first.window).toEqual({ page: 1, pageCount: 3, from: 1, to: 25, total: 53 });
    const last = pageSlice(items, 3, 25);
    expect(last.rows).toEqual([51, 52, 53]);
    expect(last.window).toMatchObject({ from: 51, to: 53 });
  });
  it('begrenzt zu große oder zu kleine Seitenzahlen und behandelt leere Listen', () => {
    expect(pageSlice(items, 99, 25).window.page).toBe(3);
    expect(pageSlice(items, 0, 25).window.page).toBe(1);
    expect(pageSlice([], 1, 25).window).toEqual({ page: 1, pageCount: 1, from: 0, to: 0, total: 0 });
  });
});
