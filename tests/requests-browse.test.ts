/** Discover's Browse view: URL parsing/serialising, type switching, chips and titles, and the Seerr query it sends. */
import { describe, expect, it } from 'vitest';
import { ApiError, type Http } from '../src/api/http';
import { browseParams, SeerrDesk } from '../src/api/seerr-desk';
import {
  activeFilters, browseTitle, clearFilters, countText, emptyBrowse, logoUrl, NETWORKS, parseBrowse, serialiseBrowse, STUDIOS, switchType, yearProblem, type BrowseState,
} from '../src/pages/requests/browse-model';

const q = (s: string): URLSearchParams => new URLSearchParams(s);
const names = new Map([[28, 'Action'], [12, 'Adventure'], [35, 'Comedy'], [10759, 'Action & Adventure']]);

describe('browse URL', () => {
  it('no type = not browsing (Discover front page)', () => {
    expect(parseBrowse(q(''))).toBeNull();
    expect(parseBrowse(q('q=dune'))).toBeNull();
    expect(parseBrowse(q('type=both'))).toBeNull();
  });

  it('reads the owner example', () => {
    expect(parseBrowse(q('type=movie&genre=28,12&sort=popularity.desc'))).toEqual({ mediaType: 'movie', genres: [28, 12], sort: 'popularity.desc', hide: false });
  });

  it('reads everything and round-trips', () => {
    const s = parseBrowse(q('type=tv&genre=35&sort=vote_average.desc&from=1990&to=1999&network=213&hide=1'), 2026) as BrowseState;
    expect(s).toEqual({ mediaType: 'tv', genres: [35], sort: 'vote_average.desc', fromYear: 1990, toYear: 1999, network: 213, hide: true });
    expect(serialiseBrowse(s)).toBe('type=tv&genre=35&sort=vote_average.desc&from=1990&to=1999&network=213&hide=1');
    expect(parseBrowse(q(serialiseBrowse(s)), 2026)).toEqual(s);
  });

  it('keeps the URL short: default sort and empty filters are left out, commas stay readable', () => {
    expect(serialiseBrowse(emptyBrowse('movie'))).toBe('type=movie');
    expect(serialiseBrowse({ ...emptyBrowse('movie'), genres: [28, 12] })).toBe('type=movie&genre=28,12');
  });

  it('ignores junk instead of breaking', () => {
    const s = parseBrowse(q('type=movie&genre=28,abc,,28,-4&sort=nope&from=12&to=99999&hide=yes'), 2026) as BrowseState;
    expect(s).toEqual({ mediaType: 'movie', genres: [28], sort: 'popularity.desc', hide: false });
  });

  it('swaps a reversed year range', () => {
    expect(parseBrowse(q('type=movie&from=2000&to=1990'), 2026)).toMatchObject({ fromYear: 1990, toYear: 2000 });
  });

  it('a network only goes with shows and a studio only with films', () => {
    expect(parseBrowse(q('type=movie&network=213'))).not.toHaveProperty('network');
    expect(parseBrowse(q('type=tv&studio=2'))).not.toHaveProperty('studio');
    expect(serialiseBrowse({ ...emptyBrowse('movie'), network: 213 })).toBe('type=movie');
  });

  it('old genre links open Browse on that genre', () => {
    expect(parseBrowse(q('genre=16&gtype=tv&gname=Animation'))).toMatchObject({ mediaType: 'tv', genres: [16] });
  });
});

describe('switching between films and shows', () => {
  it('maps the genres that differ and drops a network or studio', () => {
    const s: BrowseState = { mediaType: 'movie', genres: [28, 12, 35], sort: 'release.desc', fromYear: 2000, studio: 2, hide: true };
    const tv = switchType(s, 'tv');
    expect(tv).toEqual({ mediaType: 'tv', genres: [10759, 35], sort: 'release.desc', fromYear: 2000, hide: true });
    expect(switchType({ ...emptyBrowse('tv'), genres: [10759], network: 213 }, 'movie')).toEqual({ ...emptyBrowse('movie'), genres: [28] });
  });
  it('drops genres the other type does not have, when the list is known', () => {
    expect(switchType({ ...emptyBrowse('movie'), genres: [27, 35] }, 'tv', [{ id: 35, name: 'Comedy' }]).genres).toEqual([35]);
  });
  it('same type is a no-op', () => {
    const s = emptyBrowse('tv');
    expect(switchType(s, 'tv')).toBe(s);
  });
});

describe('titles and chips', () => {
  it('says what is shown', () => {
    expect(browseTitle(emptyBrowse('movie'), names)).toBe('Films');
    expect(browseTitle({ ...emptyBrowse('movie'), genres: [28, 12] }, names)).toBe('Action and Adventure films');
    expect(browseTitle({ ...emptyBrowse('movie'), genres: [28, 12, 35] }, names)).toBe('Action, Adventure and Comedy films');
    expect(browseTitle({ ...emptyBrowse('tv'), network: 213 }, names)).toBe('Netflix shows');
    expect(browseTitle({ ...emptyBrowse('tv'), network: 213, genres: [35] }, names)).toBe('Comedy shows on Netflix');
    expect(browseTitle({ ...emptyBrowse('movie'), studio: 41077 }, names)).toBe('A24 films');
  });
  it('one removable chip per filter, each removing only itself', () => {
    const s: BrowseState = { mediaType: 'tv', genres: [35], sort: 'popularity.desc', fromYear: 1990, toYear: 1999, network: 213, hide: true };
    const chips = activeFilters(s, names);
    expect(chips.map(c => c.label)).toEqual(['Netflix', 'Comedy', '1990 to 1999', 'Not in the library']);
    expect(chips[1]?.next.genres).toEqual([]);
    expect(chips[0]?.next.network).toBeUndefined();
    expect(chips[2]?.next).toMatchObject({ fromYear: undefined, toYear: undefined, network: 213 });
    expect(activeFilters({ ...emptyBrowse('movie'), fromYear: 2001 }, names)[0]?.label).toBe('From 2001');
  });
  it('clear all keeps the type and sort only', () => {
    expect(clearFilters({ mediaType: 'tv', genres: [35], sort: 'release.asc', network: 213, hide: true })).toEqual({ ...emptyBrowse('tv'), sort: 'release.asc' });
  });
  it('logo tiles: unique ids and white TMDB logos', () => {
    for (const list of [NETWORKS, STUDIOS]) expect(new Set(list.map(b => b.id)).size).toBe(list.length);
    expect(logoUrl('/x.png')).toBe('https://image.tmdb.org/t/p/w780_filter(duotone,ffffff,bababa)/x.png');
  });
});

describe('Seerr browse query (verified params only)', () => {
  const T = '2026-11-21';
  it('popular films with genres (all of them)', () => {
    expect(browseParams({ ...emptyBrowse('movie'), genres: [28, 12] }, 1, T)).toEqual({ page: 1, sortBy: 'popularity.desc', genre: '28,12' });
  });
  it('release sort uses the right field per type; newest stops at today', () => {
    expect(browseParams({ ...emptyBrowse('movie'), sort: 'release.desc' }, 2, T)).toEqual({ page: 2, sortBy: 'primary_release_date.desc', primaryReleaseDateLte: T, voteCountGte: 20 });
    expect(browseParams({ ...emptyBrowse('tv'), sort: 'release.asc' }, 1, T)).toEqual({ page: 1, sortBy: 'first_air_date.asc', voteCountGte: 100 });
  });
  it('years become date bounds; an earlier "to" year is kept for newest', () => {
    expect(browseParams({ ...emptyBrowse('tv'), fromYear: 2000, toYear: 2001, sort: 'release.desc' }, 1, T))
      .toMatchObject({ firstAirDateGte: '2000-01-01', firstAirDateLte: '2001-12-31' });
  });
  it('top rated asks for a vote floor, lower inside a network or studio', () => {
    expect(browseParams({ ...emptyBrowse('movie'), sort: 'vote_average.desc' }, 1, T).voteCountGte).toBe(1000);
    expect(browseParams({ ...emptyBrowse('tv'), sort: 'vote_average.desc', network: 213 }, 1, T)).toMatchObject({ network: 213, voteCountGte: 50 });
    expect(browseParams({ ...emptyBrowse('movie'), studio: 41077 }, 1, T)).toEqual({ page: 1, sortBy: 'popularity.desc', studio: 41077 });
  });
  it('never sends a studio with shows or a network with films', () => {
    expect(browseParams({ ...emptyBrowse('tv'), studio: 2 }, 1, T)).not.toHaveProperty('studio');
    expect(browseParams({ ...emptyBrowse('movie'), network: 2 }, 1, T)).not.toHaveProperty('network');
  });

  it('browse() calls /discover/movies|tv and keeps the total; genreList() reads /genres; browse throws when Seerr fails', async () => {
    const calls: Array<{ path: string; query?: Record<string, unknown> }> = [];
    const http = (async (path: string, o: { query?: Record<string, unknown> } = {}) => {
      calls.push({ path, query: o.query });
      if (path === '/genres/tv') return [{ id: 35, name: 'Comedy' }, { id: 1 }];
      if (path === '/discover/tv') return { page: 1, totalPages: 3, totalResults: 58, results: [{ id: 7, name: 'Show', firstAirDate: '2020-01-01' }] };
      throw new ApiError(500, 'server', 'boom');
    }) as unknown as Http;
    const desk = new SeerrDesk(http, () => ({ userId: 1, perms: 2 }), async () => true);
    const page = await desk.browse({ ...emptyBrowse('tv'), network: 213 }, 1);
    expect(page).toMatchObject({ page: 1, totalPages: 3, total: 58, items: [{ tmdbId: 7, mediaType: 'tv', title: 'Show', year: 2020 }] });
    expect(calls[0]).toMatchObject({ path: '/discover/tv', query: { network: 213, sortBy: 'popularity.desc', page: 1 } });
    expect(await desk.genreList('tv')).toEqual([{ id: 35, name: 'Comedy' }]);
    await expect(desk.browse(emptyBrowse('movie'))).rejects.toBeInstanceOf(ApiError);
  });
});

describe('year range check', () => {
  it('explains an end year before the start year instead of guessing', () => {
    expect(yearProblem(2025, 2020)).toMatch(/end year is before the start year/);
    expect(yearProblem(2020, 2025)).toBeNull();
    expect(yearProblem(2020, 2020)).toBeNull();
    expect(yearProblem(2025, undefined)).toBeNull();
    expect(yearProblem(undefined, 2020)).toBeNull();
  });
});

describe('result count wording', () => {
  const films = { one: 'film', many: 'films' };
  it('heading and button forms', () => {
    expect(countText(undefined, films)).toBe('');
    expect(countText(0, films)).toBe('No films');
    expect(countText(1, films)).toBe('1 film');
    expect(countText(1234, films)).toBe('1,234 films');
    expect(countText(20_000, films)).toBe('Over 10,000 films');
    expect(countText(20_000, films, true)).toBe('10,000+ films');
  });
});
