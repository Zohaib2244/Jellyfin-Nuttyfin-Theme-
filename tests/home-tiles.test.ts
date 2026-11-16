import { describe, expect, it } from 'vitest';
import { moveTile, resolveLayout } from '../src/pages/home/arrange';
import type { TileDef } from '../src/pages/home/tile';
import { TABS, TILES, assertUniqueTiles, tilesOf } from '../src/pages/home/tiles';

describe('tile registry', () => {
  it('every tile belongs to exactly one tab and ids are unique', () => {
    expect(() => assertUniqueTiles()).not.toThrow();
    expect(new Set(TILES.map(t => t.id)).size).toBe(TILES.length);
  });
  it('refuses a tile that would appear in two tabs', () => {
    const dup: TileDef = { ...(TILES[0] as TileDef), tab: 'explore' };
    expect(() => assertUniqueTiles([...TILES, dup])).toThrow(/exactly one tab/);
  });
  it('has the five tabs and the tiles the brief asks for, in the right tabs', () => {
    expect(TABS.map(t => t.label)).toEqual(['Home', 'Continue Watching', 'Explore', 'Newly Added', 'Requests']);
    const ids = (tab: Parameters<typeof tilesOf>[0]) => tilesOf(tab).map(t => t.id).sort();
    expect(ids('home')).toEqual(['cwmini', 'keep', 'new', 'next', 'nutbot']);
    expect(ids('continue')).toEqual(['finish', 'leaving', 'onthego', 'sets']);
    expect(ids('explore')).toEqual(['because', 'genres', 'mood', 'recs', 'short', 'tv']);
    expect(ids('new')).toEqual(['coming', 'newfilms', 'newhero', 'newshows']);
    expect(ids('requests')).toEqual(['reqask', 'reqflow', 'reqmine']);
  });
  it('tiles of a tab do not overlap on the 12-column grid', () => {
    for (const tab of TABS) {
      const cells = new Set<string>();
      for (const t of tilesOf(tab.id)) {
        const [c, r, w, h] = t.place;
        expect(c + w - 1).toBeLessThanOrEqual(12);
        for (let x = c; x < c + w; x++) for (let y = r; y < r + h; y++) {
          const k = `${x},${y}`;
          expect(cells.has(k), `${tab.id}: ${t.id} overlaps at ${k}`).toBe(false);
          cells.add(k);
        }
      }
    }
  });
});

describe('arrange layout', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('defaults to the designed order', () => {
    expect(resolveLayout(ids, undefined)).toEqual({ order: ids, hidden: [] });
  });
  it('merges a saved layout with tiles that changed since', () => {
    const r = resolveLayout(ids, { order: ['c', 'gone', 'a', 'c'], hidden: ['b', 'gone'] });
    expect(r).toEqual({ order: ['c', 'a', 'b', 'd'], hidden: ['b'] });
  });
  it('moves a tile among the visible ones, skipping hidden', () => {
    expect(moveTile(ids, [], 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveTile(ids, ['b'], 'c', -1)).toEqual(['c', 'b', 'a', 'd']);
    expect(moveTile(ids, [], 'a', -1)).toEqual(ids);
    expect(moveTile(ids, [], 'd', 1)).toEqual(ids);
  });
});
