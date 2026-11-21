import { describe, expect, it } from 'vitest';
import type { Episode } from '../src/api/types';
import { groupByShow } from '../src/pages/home/model';

const base = { overview: undefined, imageTags: {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 40 };
const ep = (n: number, o: Partial<Episode> = {}): Episode => ({
  ...base, kind: 'episode', id: `e${n}`, name: `Ep ${n}`, seriesId: 'T', seriesName: 'Turtles', season: 4, episode: n, missing: false, seriesImageTags: {}, ...o,
});

describe('groupByShow (Explore: one row per show, not one per episode)', () => {
  it('26 episodes of one show are one row with a range and one Play on the first unwatched one', () => {
    const list = Array.from({ length: 26 }, (_, i) => ep(26 - i, { played: 26 - i <= 2 })); // arrives out of order
    const g = groupByShow(list);
    expect(g).toHaveLength(1);
    expect(g[0]?.episodes).toHaveLength(26);
    expect(g[0]?.range).toBe('S4 E1 to E26');
    expect(g[0]?.playable?.episode).toBe(3); // E1 and E2 are watched
    expect(g[0]?.allMissing).toBe(false);
  });
  it('keeps shows apart, in the order they first appear, and a single episode keeps its own label', () => {
    const g = groupByShow([ep(1, { seriesId: 'A', seriesName: 'A', season: 1 }), ep(2, { seriesId: 'B', seriesName: 'B', season: 2, episode: 7 }), ep(2, { seriesId: 'A', seriesName: 'A', season: 1 })]);
    expect(g.map(x => x.seriesId)).toEqual(['A', 'B']);
    expect(g[1]?.range).toBe('S2 E7');
    expect(g[0]?.range).toBe('S1 E1 to E2');
  });
  it('plays the first episode that is actually in the library; none when all are still to come', () => {
    expect(groupByShow([ep(1, { missing: true }), ep(2)])[0]?.playable?.episode).toBe(2);
    const later = groupByShow([ep(1, { missing: true }), ep(2, { missing: true })])[0];
    expect(later?.playable).toBeUndefined();
    expect(later?.allMissing).toBe(true);
  });
  it('everything watched: Play starts the first one again', () => {
    expect(groupByShow([ep(1, { played: true }), ep(2, { played: true })])[0]?.playable?.episode).toBe(1);
  });
  it('a span across seasons names both ends', () => {
    expect(groupByShow([ep(9, { season: 1 }), ep(1, { season: 2 })])[0]?.range).toBe('S1 E9 to S2 E1');
  });
});
