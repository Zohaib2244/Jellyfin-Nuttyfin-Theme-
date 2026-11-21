import { describe, expect, it } from 'vitest';
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
  it('has the four tabs and the tiles the brief asks for, in the right tabs', () => {
    expect(TABS.map(t => t.label)).toEqual(['Home', 'Continue Watching', 'Explore', 'Newly Added']);
    const ids = (tab: Parameters<typeof tilesOf>[0]) => tilesOf(tab).map(t => t.id).sort();
    expect(ids('home')).toEqual(['cwmini', 'keep', 'new', 'next']);
    expect(ids('continue')).toEqual(['finish', 'leaving', 'onthego', 'sets']);
    expect(ids('explore')).toEqual(['because', 'genres', 'mood', 'recs', 'short', 'tv']);
    expect(ids('new')).toEqual(['coming', 'newfilms', 'newhero', 'newshows']);
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

describe('Home layout', () => {
  it('Keep watching is the only full-width tile on top', () => {
    const top = tilesOf('home').filter(t => t.place[1] === 1);
    expect(top.map(t => t.id)).toEqual(['keep']);
    expect(top[0]?.place[2]).toBe(12);
  });
});
