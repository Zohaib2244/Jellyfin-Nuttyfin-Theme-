/** Discover rails, genre tiles, title facts (release dates, cache) and the no-N+1 request list, against recorded Seerr 3.5.1 shapes. */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Http } from '../src/api/http';
import { downloadsOf, factsFrom, hitToItem, mapDetail, mapPage, mapRequest, pickTrailer, SeerrDesk } from '../src/api/seerr-desk';

const fx = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/seerr/${name}.json`, import.meta.url), 'utf8')) as T;
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw Seerr fixtures

function fakeHttp(routes: Record<string, unknown>): { http: Http; calls: Array<{ path: string; opts: Any }> } {
  const calls: Array<{ path: string; opts: Any }> = [];
  const http = (async (path: string, opts: Any = {}) => {
    calls.push({ path, opts });
    const key = Object.keys(routes).find(k => path === k || (k.endsWith('*') && path.startsWith(k.slice(0, -1))));
    if (!key) throw new ApiError(404, 'not-found', `no route ${path}`);
    const v = routes[key];
    if (v instanceof Error) throw v;
    return typeof v === 'function' ? (v as (o: Any) => unknown)(opts) : v;
  }) as unknown as Http;
  return { http, calls };
}
const session = () => ({ userId: 1, perms: 2 });
const yes = async (): Promise<boolean> => true;
afterEach(() => vi.unstubAllGlobals());

describe('discover shapes', () => {
  it('trending mixes films and shows, has backdrops and drops people', () => {
    const page = mapPage(fx('discover-trending'));
    expect(page.items.length).toBeGreaterThan(0);
    for (const i of page.items) { expect(['movie', 'tv']).toContain(i.mediaType); expect(i.title).toBeTruthy(); }
    expect(page.items.some(i => i.backdropPath)).toBe(true);
    expect(hitToItem({ id: 5, mediaType: 'person', name: 'Somebody' } as never)).toBeNull();
  });
  it('typed endpoints get their media type from the rail when hits have none', () => {
    const p = mapPage({ results: [{ id: 3, title: 'X' }] } as never, 'movie');
    expect(p.items[0]).toMatchObject({ mediaType: 'movie', title: 'X' });
    expect(mapPage(fx('discover-movies-upcoming'), 'movie').items.every(i => i.mediaType === 'movie')).toBe(true);
    expect(mapPage(fx('discover-tv'), 'tv').items.every(i => i.mediaType === 'tv')).toBe(true);
  });
  it('status marks come from mediaInfo', () => {
    const it2 = hitToItem({ id: 9, mediaType: 'tv', name: 'S', mediaInfo: { status: 4 } } as never);
    expect(it2).toMatchObject({ state: 'available', partial: true });
  });
  it('genre slider tiles keep one backdrop', async () => {
    const { http, calls } = fakeHttp({ '/discover/genreslider/movie': fx('genreslider-movie') });
    const tiles = await new SeerrDesk(http, session, yes).genres('movie');
    expect(tiles[0]).toMatchObject({ id: expect.any(Number), name: expect.any(String), backdrop: expect.stringMatching(/^\//) });
    expect(calls[0]?.path).toBe('/discover/genreslider/movie');
  });
  it('genre results use /discover/movies?genre=', async () => {
    const { http, calls } = fakeHttp({ '/discover/movies': fx('discover-movies-genre') });
    const p = await new SeerrDesk(http, session, yes).discoverGenre('movie', 16, 2);
    expect(calls[0]?.opts.query).toEqual({ page: 2, genre: 16 });
    expect(p.items.length).toBeGreaterThan(0);
  });
  it('rails fail soft', async () => {
    const { http } = fakeHttp({});
    expect((await new SeerrDesk(http, session, yes).discoverRail('tv-upcoming')).items).toEqual([]);
  });
});

describe('details: trailer, cast, facts', () => {
  const raw = fx<Any>('movie-detail-processing');
  it('real film in cinemas: release facts, YouTube trailer, cast', () => {
    const d = mapDetail('movie', raw.id, raw as never, 1);
    expect(d.trailer?.key).toMatch(/^[\w-]+$/);
    expect(d.cast?.length).toBeGreaterThan(0);
    expect(d.facts).toMatchObject({ mediaType: 'movie', releaseDate: '2026-11-03' });
    expect(d.mediaStatus).toBe(3);
    expect(d.downloads).toEqual([]);
  });
  it('home release = earliest digital or disc date', () => {
    const f = factsFrom('movie', 1, { releaseDate: '2026-01-01', releases: { results: [
      { release_dates: [{ type: 3, release_date: '2026-01-01T00:00:00.000Z' }, { type: 5, release_date: '2026-06-01T00:00:00.000Z' }] },
      { release_dates: [{ type: 4, release_date: '2026-04-01T00:00:00.000Z' }] },
    ] } } as never);
    expect(f.homeRelease).toBe('2026-04-01');
  });
  it('trailer preference and none', () => {
    expect(pickTrailer([{ site: 'YouTube', key: 'teaser12345', type: 'Teaser', name: 'T' }, { site: 'YouTube', key: 'trailer1234', type: 'Trailer', name: 'Official Trailer' }])?.key).toBe('trailer1234');
    expect(pickTrailer([{ site: 'Vimeo', key: 'x', type: 'Trailer' }])).toBeUndefined();
    expect(pickTrailer(undefined)).toBeUndefined();
  });
});

describe('download info', () => {
  it('percent, ETA and episode labels from the queue', () => {
    expect(downloadsOf([{ size: 1000, sizeLeft: 250, estimatedCompletionTime: '2026-11-21T14:00:00Z', episode: { seasonNumber: 1, episodeNumber: 3 } }]))
      .toEqual([{ percent: 75, eta: '2026-11-21T14:00:00Z', label: 'S1E3' }]);
    expect(downloadsOf(undefined)).toEqual([]);
  });
  it('the real approved-but-unreleased request is not downloading', () => {
    const list = fx<{ results: Any[] }>('request-approved-processing');
    const r = mapRequest(list.results[0] as never);
    expect(r).toMatchObject({ state: 'approved', requestStatus: 2, mediaStatus: 3, downloads: [] });
    const dl = structuredClone(list.results[0]) as Any;
    dl.media.downloadStatus = [{ size: 10, sizeLeft: 5 }];
    expect(mapRequest(dl as never)).toMatchObject({ state: 'downloading', progress: 50 });
  });
});

describe('request list without N+1', () => {
  const rows = (n: number, from = 0): Any[] => Array.from({ length: n }, (_, i) => ({ id: from + i + 1, status: 2, type: 'movie', createdAt: '2026-11-01T00:00:00Z', media: { tmdbId: 100 + from + i, status: 3 } }));
  it('one /request call per 100 rows and no /movie lookups', async () => {
    const { http, calls } = fakeHttp({ '/request': (o: Any) => ({ pageInfo: { results: 149 }, results: rows(o.query.skip === 0 ? 100 : 49, o.query.skip) }) });
    const res = await new SeerrDesk(http, session, yes).allRequests({ scope: 'all' });
    expect(res.items).toHaveLength(149);
    expect(calls.map(c => c.path)).toEqual(['/request', '/request']);
    expect(res.items[0]?.title).toBe('');
  });
  it('member scope asks Seerr for their own requests only', async () => {
    const { http, calls } = fakeHttp({ '/request': { pageInfo: { results: 1 }, results: rows(1) } });
    await new SeerrDesk(http, session, yes).allRequests({ scope: 'mine' });
    expect(calls[0]?.opts.query.requestedBy).toBe(1);
  });
  it('title facts: one lookup per title, shared, then from sessionStorage after a reload', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
      key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; },
    });
    const { http, calls } = fakeHttp({ '/movie/*': { title: 'Film', releaseDate: '2027-03-04', posterPath: '/p.jpg' } });
    const desk = new SeerrDesk(http, session, yes);
    const [a, b] = await Promise.all([desk.titleFacts('movie', 7), desk.titleFacts('movie', 7)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ title: 'Film', releaseDate: '2027-03-04' });
    expect(calls).toHaveLength(1);
    // a new client (page reload) reads the cache: no request
    const again = new SeerrDesk(http, session, yes);
    expect(again.cachedFacts('movie', 7)?.title).toBe('Film');
    await again.titleFacts('movie', 7);
    expect(calls).toHaveLength(1);
    // the list fills titles from the cache
    const list = fakeHttp({ '/request': { pageInfo: { results: 1 }, results: [{ id: 1, status: 2, type: 'movie', media: { tmdbId: 7, status: 3 } }] } });
    const res = await new SeerrDesk(list.http, session, yes).allRequests({ scope: 'all' });
    expect(res.items[0]?.title).toBe('Film');
  });
  it('a failed lookup is not cached', async () => {
    let fail = true;
    const { http, calls } = fakeHttp({ '/tv/*': () => { if (fail) throw new ApiError(500, 'server', 'x'); return { name: 'Show' }; } });
    const desk = new SeerrDesk(http, session, yes);
    expect(await desk.titleFacts('tv', 3)).toBeNull();
    fail = false;
    await new Promise(r => setTimeout(r, 0));
    expect((await desk.titleFacts('tv', 3))?.title).toBe('Show');
    expect(calls).toHaveLength(2);
  });
});
