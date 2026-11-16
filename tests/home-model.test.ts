import { describe, expect, it } from 'vitest';
import type { CollectionProgress, Episode, Title } from '../src/api/types';
import { headline, lines, slotOf } from '../src/pages/home/copy';
import {
  bestFits, buildWeek, byClosestToDone, byRequestState, firstBusyDay, leftText, requestLabel, seasonProgress, startedCollections, watchRows,
} from '../src/pages/home/model';

const base = { overview: undefined, imageTags: {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 0 };
const film = (id: string, o: Partial<Title> = {}): Title => ({ ...base, kind: 'movie', id, name: id, genres: [], is4k: false, studios: [], ...o });
const ep = (id: string, o: Partial<Episode> = {}): Episode => ({
  ...base, kind: 'episode', id, name: `Ep ${id}`, seriesId: 'S', seriesName: 'Show', season: 1, episode: 1, missing: false, seriesImageTags: {}, runtimeMin: 40, ...o,
});
const prog = (percent: number, remainingMin: number) => ({ positionTicks: 1, percent, remainingMin });

describe('watchRows', () => {
  it('lists resume items first, then next-up of shows not already resumed, without duplicates', () => {
    const rows = watchRows(
      [film('a', { progress: prog(40, 60) }), ep('e1', { seriesId: 'S1', seriesName: 'One', progress: prog(10, 30) })],
      [ep('n1', { seriesId: 'S1' }), ep('n2', { seriesId: 'S2', seriesName: 'Two' }), ep('n3', { seriesId: 'S2' })],
    );
    expect(rows.map(r => r.item.id)).toEqual(['a', 'e1', 'n2']);
    expect(rows.map(r => r.kind)).toEqual(['resume', 'resume', 'next']);
    expect(rows[1]?.title).toBe('One');
    expect(rows[0]?.percent).toBe(40);
    expect(rows[2]?.percent).toBeNull();
  });
  it('says how long is left', () => {
    expect(leftText({ leftMin: 64, kind: 'resume' })).toBe('1 h 04 min left');
    expect(leftText({ leftMin: 40, kind: 'next' })).toBe('40 min');
    expect(leftText({ leftMin: null, kind: 'resume' })).toBe('');
  });
});

describe('seasonProgress', () => {
  const season = (played: number, n = 6) => Array.from({ length: n }, (_, i) => ep(`x${i}`, { episode: i + 1, played: i < played }));
  it('reports a started season and its dots', () => {
    const next = ep('x2', { episode: 3 });
    const p = seasonProgress(next, season(2));
    expect(p).toMatchObject({ seen: 2, of: 6, leftMin: 160 });
    expect(p?.dots).toEqual(['w', 'w', 'n', '', '', '']);
  });
  it('ignores seasons not started or already finished, and virtual episodes', () => {
    expect(seasonProgress(ep('a'), season(0))).toBeNull();
    expect(seasonProgress(ep('a'), season(6))).toBeNull();
    const withMissing = [...season(2, 4), ep('m', { episode: 9, missing: true })];
    expect(seasonProgress(ep('a'), withMissing)?.of).toBe(4);
  });
  it('sorts closest to done first', () => {
    const a = seasonProgress(ep('a'), season(2, 8)) as NonNullable<ReturnType<typeof seasonProgress>>;
    const b = seasonProgress(ep('b'), season(4, 6)) as NonNullable<ReturnType<typeof seasonProgress>>;
    expect([a, b].sort(byClosestToDone)[0]).toBe(b);
  });
});

describe('collections', () => {
  const c = (id: string, seen: number, total: number): CollectionProgress => ({ id, name: id, imageTags: {}, total, seen, items: [] });
  it('keeps started, unfinished sets, closest to done first', () => {
    expect(startedCollections([c('none', 0, 4), c('done', 3, 3), c('far', 1, 6), c('near', 3, 4)]).map(x => x.id)).toEqual(['near', 'far']);
  });
});

describe('bestFits', () => {
  it('drops what does not fit and prefers filling the time', () => {
    const r = bestFits([
      { item: film('short', { runtimeMin: 30 }), minutes: 30, note: '' },
      { item: film('fits', { runtimeMin: 85 }), minutes: 85, note: '' },
      { item: film('long', { runtimeMin: 140 }), minutes: 140, note: '' },
    ], 90);
    expect(r.map(x => (x.item as Title).id)).toEqual(['fits', 'short']);
  });
  it('lets finishing something beat starting something of similar length', () => {
    const r = bestFits([
      { item: film('new', { runtimeMin: 80, rating: 7 }), minutes: 80, note: '' },
      { item: film('half', { runtimeMin: 150, rating: 7 }), minutes: 78, note: 'finish' },
    ], 90);
    expect((r[0]?.item as Title).id).toBe('half');
  });
});

describe('On TV this week', () => {
  const now = new Date('2026-11-16T15:00:00').getTime();
  const at = (d: number, h = 20): string => new Date(new Date('2026-11-16T00:00:00').getTime() + d * 864e5 + h * 3600e3).toISOString();
  it('uses upcoming episodes, today first, when there are any', () => {
    const w = buildWeek([ep('a', { premiered: at(0) }), ep('b', { premiered: at(3) }), ep('late', { premiered: at(12) })], [ep('r', { added: at(-1) })], now);
    expect(w.mode).toBe('upcoming');
    expect(w.total).toBe(2);
    expect(w.days).toHaveLength(7);
    expect(w.days[0]?.episodes.map(e => e.id)).toEqual(['a']);
    expect(w.days[3]?.episodes.map(e => e.id)).toEqual(['b']);
  });
  it('falls back to "aired this week" from recently added episodes so the tile is never empty', () => {
    const w = buildWeek([], [ep('r1', { added: at(-1) }), ep('r2', { added: at(-5) }), ep('old', { added: at(-30) })], now);
    expect(w.mode).toBe('aired');
    expect(w.total).toBe(2);
    expect(w.days[6]?.day).toBe(new Date('2026-11-16T00:00:00').getTime());
    expect(w.days[5]?.episodes[0]?.id).toBe('r1');
  });
  it('opens on a day that has something', () => {
    const up = buildWeek([ep('b', { premiered: at(2) })], [], now);
    expect(firstBusyDay(up, now)).toBe(2);
    const aired = buildWeek([], [ep('r', { added: at(-2) })], now);
    expect(firstBusyDay(aired, now)).toBe(4);
    expect(firstBusyDay(buildWeek([], [], now), now)).toBe(6);
  });
});

describe('requests', () => {
  it('orders by how interesting the state is, newest first', () => {
    const r = (id: number, state: 'requested' | 'approved' | 'downloading' | 'available' | 'declined', createdAt: string) =>
      ({ id, tmdbId: id, mediaType: 'movie' as const, title: String(id), state, requestedBy: '', createdAt });
    const sorted = [r(1, 'available', '2026-01-01'), r(2, 'requested', '2026-01-01'), r(3, 'downloading', '2026-01-01'), r(4, 'requested', '2026-02-01')].sort(byRequestState);
    expect(sorted.map(x => x.id)).toEqual([3, 4, 2, 1]);
    expect(requestLabel('downloading').short).toBe('Processing');
    expect(requestLabel('requested').short).toBe('Requested');
    expect(requestLabel('available').short).toBe('Available');
  });
});

describe('greeting copy', () => {
  it('picks the moment from the clock', () => {
    expect(slotOf(new Date('2026-11-16T08:00:00'))).toBe('breakfast'); // Monday
    expect(slotOf(new Date('2026-11-21T09:00:00'))).toBe('weekend'); // Saturday
    expect(slotOf(new Date('2026-11-16T20:30:00'))).toBe('evening');
    expect(slotOf(new Date('2026-11-20T20:30:00'))).toBe('friday');
    expect(slotOf(new Date('2026-11-16T01:30:00'))).toBe('midnight');
  });
  it('skips lines whose facts are missing, and never runs dry', () => {
    const none = lines('evening', { name: 'Sam' });
    expect(none.length).toBeGreaterThan(0);
    expect(none.every(l => !l.includes('{'))).toBe(true);
    const some = lines('evening', { name: 'Sam', keep: 'Silo', left: '40 min', done: '9:40 pm' });
    expect(some.some(l => l.includes('Silo'))).toBe(true);
    expect(headline('evening', { name: 'Sam' }, 0)).toMatch(/Sam|Feet up/);
    expect(headline('evening', {}, 0)).toBeTruthy();
  });
});
