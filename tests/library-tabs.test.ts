import { describe, expect, it } from 'vitest';
import { MOVIE_GROUPS, SHOW_GROUPS, parseState, stateToQuery } from '../src/pages/library/filters';
import { LIB_TABS, libTabList, libTabOf, type LibTab } from '../src/pages/library/tabs';
import { matchRoute, splitHash } from '../src/router';
import { routes } from '../src/routes';

/** The tab a deep link lands on, worked out the way the Library page does it. */
function tabFor(hash: string): LibTab {
  const m = matchRoute(routes, hash);
  if (!m) throw new Error(`no route for ${hash}`);
  const kind = m.name === 'shows' ? 'shows' : 'movies';
  const groups = kind === 'movies' ? MOVIE_GROUPS : SHOW_GROUPS;
  return libTabOf(kind, parseState(kind, m.query, groups), groups);
}

describe('library tabs live in the URL', () => {
  it('every tab path opens that same tab (deep links, Back/forward)', () => {
    for (const id of Object.keys(LIB_TABS) as LibTab[]) expect(tabFor(`#${LIB_TABS[id].path}`), id).toBe(id);
  });
  it('tab paths are real routes', () => {
    for (const t of Object.values(LIB_TABS)) expect(matchRoute(routes, `#${t.path}`)?.route.nav).toBe('library');
  });
  it('filters keep you on Movies; only In 4K alone is the 4K tab', () => {
    expect(tabFor('#/movies?genre=Action&order=az')).toBe('movies');
    expect(tabFor('#/movies?xtra=4k')).toBe('4k');
    expect(tabFor('#/movies?xtra=4k&seen=not')).toBe('movies');
    expect(tabFor('#/movies?view=shelves&xtra=4k')).toBe('sets');
    expect(tabFor('#/shows?view=shelves')).toBe('shows'); // shelves only exist for movies
  });
  it('the in-page state writes the very query the tab path uses', () => {
    const m = splitHash(LIB_TABS['4k'].path);
    const st = parseState('movies', m.query, MOVIE_GROUPS);
    const q = stateToQuery('movies', st, MOVIE_GROUPS);
    expect(q.xtra).toBe('4k');
    expect(q.view).toBeNull();
  });
});

describe('libTabList', () => {
  it('shows counts in the tabs and hides 4K Movies when the server has none', () => {
    const t = libTabList({ movies: 159, shows: 16, fourK: 0 }, 'movies');
    expect(t.map(x => x.id)).toEqual(['movies', 'shows', 'sets']);
    expect(t[0]).toEqual({ id: 'movies', label: 'Movies', count: 159 });
    expect(t.find(x => x.id === 'sets')?.count).toBeUndefined();
  });
  it('lists 4K Movies with its count when it exists, in the order Movies, Shows, 4K Movies, Collections', () => {
    const t = libTabList({ movies: 159, shows: 16, fourK: 1 }, 'movies');
    expect(t.map(x => `${x.label}${x.count != null ? ` ${x.count}` : ''}`)).toEqual(['Movies 159', 'Shows 16', '4K Movies 1', 'Collections']);
  });
  it('keeps the 4K tab while you are on it, even before the counts arrive', () => {
    expect(libTabList({}, '4k').map(x => x.id)).toEqual(['movies', 'shows', '4k', 'sets']);
    expect(libTabList({}, 'movies').map(x => x.id)).toEqual(['movies', 'shows', 'sets']);
  });
});
