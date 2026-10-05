import { describe, expect, it } from 'vitest';
import { MAX_SAVED_VIEWS, parseSavedViews, removeView, savedViewsKey, upsertView } from './saved-views';

let counter = 0;
const id = () => `v${++counter}`;

describe('saved views', () => {
  it('keys the storage by tenant, user and list so views never leak between tenants (AC-18)', () => {
    expect(savedViewsKey('t1', 'u1', 'inbox')).not.toBe(savedViewsKey('t2', 'u1', 'inbox'));
    expect(savedViewsKey('t1', 'u1', 'inbox')).not.toBe(savedViewsKey('t1', 'u1', 'cases'));
  });

  it('discards broken or foreign data when loading', () => {
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews('{oops')).toEqual([]);
    expect(parseSavedViews('{"a":1}')).toEqual([]);
    expect(parseSavedViews(JSON.stringify([{ id: 'a', name: 'Gut', state: { filter: 'NEW' } }, { id: 1, name: 'kaputt', state: {} }, 'x']))).toEqual([{ id: 'a', name: 'Gut', state: { filter: 'NEW' } }]);
  });

  it('saves a named view, replaces a view with the same name, and rejects empty names', () => {
    let views = upsertView([], 'Meine offenen', { filter: 'OPEN' }, id);
    expect(views).toHaveLength(1);
    views = upsertView(views, 'meine OFFENEN', { filter: 'DONE' }, id);
    expect(views).toHaveLength(1);
    expect(views[0]?.state).toEqual({ filter: 'DONE' });
    expect(upsertView(views, '   ', { filter: 'X' }, id)).toEqual(views);
  });

  it('keeps at most ten views and can remove one', () => {
    let views: ReturnType<typeof upsertView<{ n: number }>> = [];
    for (let i = 0; i < MAX_SAVED_VIEWS + 3; i += 1) views = upsertView(views, `Ansicht ${i}`, { n: i }, id);
    expect(views).toHaveLength(MAX_SAVED_VIEWS);
    const first = views[0] as NonNullable<(typeof views)[number]>;
    expect(removeView(views, first.id)).toHaveLength(MAX_SAVED_VIEWS - 1);
  });
});
