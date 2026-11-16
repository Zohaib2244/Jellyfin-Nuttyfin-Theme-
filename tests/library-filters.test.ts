import { describe, expect, it } from 'vitest';
import type { Title } from '../src/api/types';
import {
  activeKeys, groupsFor, laneOf, letterOf, MOVIE_GROUPS, parseState, passes, SHOW_GROUPS, stateToQuery, toQuery, type LibState,
} from '../src/pages/library/filters';

const title = (o: Partial<Title> = {}): Title => ({
  kind: 'movie', id: 'x', name: 'X', imageTags: {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 100, genres: [], is4k: false, studios: [], ...o,
});
const sel = (o: Record<string, string[]>): LibState['sel'] => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new Set(v)]));
const state = (o: Record<string, string[]> = {}, order: LibState['order'] = 'added', view: LibState['view'] = 'posters'): LibState => ({ sel: sel(o), order, view });

describe('URL <-> state', () => {
  it('reads switches, order and view; drops unknown keys', () => {
    const st = parseState('movies', new URLSearchParams('who=all,bogus&len=90,120&order=az&view=wall&nope=1'), MOVIE_GROUPS);
    expect([...(st.sel.who ?? [])]).toEqual(['all']);
    expect([...(st.sel.len ?? [])]).toEqual(['90']); // "pick one" keeps the first
    expect(st.order).toBe('az');
    expect(st.view).toBe('wall');
  });
  it('falls back to defaults for junk', () => {
    const st = parseState('shows', new URLSearchParams('order=zzz&view=shelves'), SHOW_GROUPS);
    expect(st.order).toBe('added');
    expect(st.view).toBe('progress'); // shelves only exist for movies
  });
  it('writes defaults as removed keys so the URL stays short', () => {
    const q = stateToQuery('movies', state({ who: ['teen'] }), MOVIE_GROUPS);
    expect(q.who).toBe('teen');
    expect(q.order).toBeNull();
    expect(q.view).toBeNull();
    expect(q.mood).toBeNull();
  });
  it('round-trips', () => {
    const st = state({ mood: ['laugh', 'adv'], era: ['10'] }, 'rating', 'list');
    const q = stateToQuery('movies', st, MOVIE_GROUPS);
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null) as [string, string][]);
    const back = parseState('movies', params, MOVIE_GROUPS);
    expect([...(back.sel.mood ?? [])]).toEqual(['laugh', 'adv']);
    expect(back.order).toBe('rating');
    expect(back.view).toBe('list');
  });
  it('keeps a genre from a link before the genre list has loaded', () => {
    const st = parseState('movies', new URLSearchParams('genre=Drama'), MOVIE_GROUPS);
    expect([...(st.sel.genre ?? [])]).toEqual(['Drama']);
    expect(toQuery('movies', st, MOVIE_GROUPS).genres).toEqual(['Drama']);
  });
});

describe('selection -> Jellyfin query', () => {
  it('maps every switch kind', () => {
    const q = toQuery('movies', state({ who: ['all'], len: ['120'], seen: ['not'], mood: ['laugh'], era: ['90'], xtra: ['4k'] }, 'short'), MOVIE_GROUPS);
    expect(q).toMatchObject({ kind: 'movie', sort: 'runtime', descending: false, maxRuntimeMin: 120, played: false, is4k: true });
    expect(q.ratings).toContain('PG');
    expect(q.genres).toEqual(['Comedy']);
    expect(q.years).toHaveLength(10);
    expect(q.years?.[0]).toBe(1990);
  });
  it('mood and genre add together (one bucket)', () => {
    const groups = groupsFor('movies', [{ name: 'Drama', count: 3 }]);
    const q = toQuery('movies', state({ mood: ['laugh'], genre: ['Drama'] }), groups);
    expect(q.genres?.sort()).toEqual(['Comedy', 'Drama']);
  });
  it('long films open the other end of the runtime window', () => {
    const q = toQuery('movies', state({ len: ['long'] }), MOVIE_GROUPS);
    expect(q.minRuntimeMin).toBe(121);
    expect(q.maxRuntimeMin).toBeUndefined();
  });
  it('orders', () => {
    expect(toQuery('movies', state({}, 'added'), MOVIE_GROUPS)).toMatchObject({ sort: 'added', descending: true });
    expect(toQuery('movies', state({}, 'az'), MOVIE_GROUPS)).toMatchObject({ sort: 'name', descending: false });
  });
  it('lists the active switches in desk order', () => {
    const keys = activeKeys(sel({ era: ['10'], who: ['all'] }), MOVIE_GROUPS).map(a => a.key.k);
    expect(keys).toEqual(['all', '10']);
  });
});

describe('predicate (shelves, show lanes)', () => {
  it('ORs inside a group and ANDs across groups', () => {
    const st = state({ who: ['all', 'teen'], len: ['90'] });
    expect(passes(title({ certification: 'PG', runtimeMin: 80 }), st, MOVIE_GROUPS)).toBe(true);
    expect(passes(title({ certification: 'PG-13', runtimeMin: 80 }), st, MOVIE_GROUPS)).toBe(true);
    expect(passes(title({ certification: 'R', runtimeMin: 80 }), st, MOVIE_GROUPS)).toBe(false);
    expect(passes(title({ certification: 'PG', runtimeMin: 100 }), st, MOVIE_GROUPS)).toBe(false);
  });
  it('can leave one group out', () => {
    const st = state({ who: ['all'], len: ['90'] });
    expect(passes(title({ certification: 'PG', runtimeMin: 100 }), st, MOVIE_GROUPS, {}, 'len')).toBe(true);
  });
  it('seen / started / not seen', () => {
    expect(passes(title({ played: true }), state({ seen: ['seen'] }), MOVIE_GROUPS)).toBe(true);
    expect(passes(title({ progress: { positionTicks: 1, percent: 10, remainingMin: 90 } }), state({ seen: ['part'] }), MOVIE_GROUPS)).toBe(true);
    expect(passes(title({ played: true }), state({ seen: ['not'] }), MOVIE_GROUPS)).toBe(false);
  });
  it('uses the lane for "Where you are"', () => {
    const show = title({ kind: 'series' });
    expect(passes(show, state({ where: ['new'] }), SHOW_GROUPS, { lane: () => 'new' })).toBe(true);
    expect(passes(show, state({ where: ['new'] }), SHOW_GROUPS, { lane: () => 'done' })).toBe(false);
  });
});

describe('show lanes', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const show = (o: Partial<Title>): Title => title({ kind: 'series', episodeCount: 10, unplayedCount: 4, status: 'Ended', ...o });
  it('finished, not started, watching', () => {
    expect(laneOf(show({ unplayedCount: 0 }), now)).toBe('done');
    expect(laneOf(show({ unplayedCount: 10 }), now)).toBe('not');
    expect(laneOf(show({}), now)).toBe('watching');
  });
  it('new episodes: still airing, started, something added in the last two weeks', () => {
    expect(laneOf(show({ status: 'Continuing', lastEpisodeAdded: '2026-11-10T00:00:00.0000000Z' }), now)).toBe('new');
    expect(laneOf(show({ status: 'Continuing', lastEpisodeAdded: '2026-09-01T00:00:00Z' }), now)).toBe('watching');
    expect(laneOf(show({ status: 'Ended', lastEpisodeAdded: '2026-11-10T00:00:00Z' }), now)).toBe('watching');
  });
});

describe('letterOf', () => {
  it('ignores leading articles like the server sort name', () => {
    expect(letterOf('The Matrix')).toBe('M');
    expect(letterOf('A Quiet Place')).toBe('Q');
    expect(letterOf('1917')).toBe('#');
    expect(letterOf('Alien')).toBe('A');
  });
});
